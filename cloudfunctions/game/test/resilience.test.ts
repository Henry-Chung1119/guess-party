import { describe, expect, it } from 'vitest'
import { createGameService } from '../src/handlers'
import { createFakeDb } from './fakeDb'
import { ask, createTable, expectGameError, oid, perfectGuess, room, round, voteAll } from './helpers'

describe('斷線與重新進入', () => {
  it('重連後 syncState 能還原「我投過票了」等私有狀態與目前階段', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(1))
    await t.svc.setPresence({ roomId: t.roomId, online: false }, oid(1))
    expect(t.db.dump('players').find((p) => p._id === t.pids[1])!.online).toBe(false)

    const s = await t.svc.syncState({ roomId: t.roomId }, oid(1))
    expect(s.room.phase).toBe('voting')
    expect(s.me.hasVoted).toBe(true)
    expect(s.me.pid).toBe(t.pids[1])
    expect(s.players.map((p) => p.nickname).sort()).toEqual(['玩家0', '玩家1', '玩家2'])
    // syncState 會把玩家標回在線
    expect(t.db.dump('players').find((p) => p._id === t.pids[1])!.online).toBe(true)
    // 重連後再投一次仍被擋下
    await expectGameError(t.svc.submitVote({ roomId: t.roomId, roundId, answer: false }, oid(1)), 'ALREADY_VOTED')
  })

  it('投票階段有人離開：剩餘的人都投完就自動進入猜測', async () => {
    const t = await createTable(4, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(0))
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: false }, oid(1))
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(2))
    expect(room(t).phase).toBe('voting')

    await t.svc.leaveRoom({ roomId: t.roomId }, oid(3))
    expect(room(t).phase).toBe('guessing')
    expect(round(t).participants).toEqual(t.pids.slice(0, 3))
    expect(round(t).votedCount).toBe(3)
  })

  it('投過票的人離開：計數會以剩餘參與者重新計算，不會誤判完成', async () => {
    const t = await createTable(4, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(0))
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(1))
    await t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[1]! }, oid(0))
    expect(room(t).phase).toBe('voting')
    expect(round(t).votedCount).toBe(1)
    expect(round(t).participants).toEqual([t.pids[0], t.pids[2], t.pids[3]])
  })

  it('猜測階段有人離開：舊名單的提交會被拒絕，新名單提交後可正常結算', async () => {
    const t = await createTable(4, { start: true })
    await ask(t)
    const answers = [true, false, true, false]
    await voteAll(t, answers)
    const roundId = round(t).id as string
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(3))

    await expectGameError(
      t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, 0, answers) }, oid(0)),
      'INVALID_INPUT',
    )
    const remaining = t.pids.slice(0, 3)
    for (let i = 0; i < 3; i++) {
      const g: Record<string, boolean> = {}
      remaining.forEach((p, j) => {
        if (j !== i) g[p] = answers[j]!
      })
      const r = await t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: g }, oid(i))
      expect(r.allCorrect).toBe(true)
    }
    expect(room(t).phase).toBe('result')
  })

  it('出題者在出題階段離開：由下一位接手出題', async () => {
    const t = await createTable(3, { start: true })
    expect(round(t).askerPid).toBe(t.pids[0])
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(0))
    expect(room(t).phase).toBe('question')
    expect(round(t).askerPid).toBe(t.pids[1])
    expect(room(t).hostPid).toBe(t.pids[1])
    await expectGameError(t.svc.submitQuestion({ roomId: t.roomId, question: 'q' }, oid(2)), 'NOT_ASKER')
    await t.svc.submitQuestion({ roomId: t.roomId, question: '接手出題' }, oid(1))
    expect(room(t).phase).toBe('voting')
  })

  it('結算階段有人離開：剩餘的人都確認後就進入下一回合', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    const answers = [true, true, false]
    await voteAll(t, answers)
    const roundId = round(t).id as string
    await Promise.all(
      t.openids.map((o, i) => t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, i, answers) }, o)),
    )
    await t.svc.ackResult({ roomId: t.roomId, roundId }, oid(0))
    await t.svc.ackResult({ roomId: t.roomId, roundId }, oid(1))
    expect(room(t).phase).toBe('result')
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(2))
    expect(room(t).roundNo).toBe(2)
    expect(room(t).phase).toBe('question')
    expect(round(t).participants).toEqual([t.pids[0], t.pids[1]])
  })

  it('遊戲中剩不到 2 人時自動結束', async () => {
    const t = await createTable(3, { start: true })
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(2))
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(1))
    expect(room(t).status).toBe('ended')
  })

  it('已離開的玩家不能再用舊的 roomId 操作', async () => {
    const t = await createTable(3, { start: true })
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(2))
    await expectGameError(t.svc.syncState({ roomId: t.roomId }, oid(2)), 'NOT_MEMBER')
    await expectGameError(t.svc.leaveRoom({ roomId: t.roomId }, oid(2)), 'NOT_MEMBER')
  })
})

describe('非法操作與安全', () => {
  it('偽造的 roomId / 不存在的房間會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.syncState({ roomId: 'nope' }, oid(0)), 'ROOM_NOT_FOUND')
    await expectGameError(t.svc.syncState({ roomId: '' }, oid(0)), 'INVALID_INPUT')
    await expectGameError(t.svc.syncState({} as { roomId: string }, oid(0)), 'INVALID_INPUT')
  })

  it('非房間成員無法讀取狀態或改變房間', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.syncState({ roomId: t.roomId }, oid(42)), 'NOT_MEMBER')
    await expectGameError(t.svc.endGame({ roomId: t.roomId }, oid(42)), 'NOT_MEMBER')
    await expectGameError(t.svc.startGame({ roomId: t.roomId }, oid(42)), 'NOT_MEMBER')
    await expectGameError(t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[0]! }, oid(42)), 'NOT_MEMBER')
  })

  it('dispatch：未知 action、非物件 payload、缺少身份都會被擋下', async () => {
    const t = await createTable(1)
    await expectGameError(t.svc.dispatch('dropDatabase', {}, oid(0)), 'INVALID_INPUT')
    await expectGameError(t.svc.dispatch('syncState', 'not-an-object', oid(0)), 'INVALID_INPUT')
    await expectGameError(t.svc.dispatch('syncState', { roomId: t.roomId }, ''), 'INTERNAL')
    await expectGameError(t.svc.dispatch(undefined, { roomId: t.roomId }, oid(0)), 'INVALID_INPUT')
    const ok = (await t.svc.dispatch('syncState', { roomId: t.roomId }, oid(0))) as { me: { pid: string } }
    expect(ok.me.pid).toBe(t.pids[0])
  })

  it('pid 由 roomId + openid 雜湊而成：同一人在不同房間 pid 不同，且無法從 pid 反推', async () => {
    const db = createFakeDb()
    const svc = createGameService({ db, salt: 'test-salt' })
    const a = await svc.createRoom({ nickname: 'A' }, oid(0))
    const b = await svc.createRoom({ nickname: 'A' }, oid(0))
    expect(a.pid).not.toBe(b.pid)
    expect(a.pid).toMatch(/^[0-9a-f]{16}$/)
    expect(a.pid).not.toContain('openid')
  })

  it('votes / guesses 文件只存在於後端集合中，房間與玩家文件不含任何答案欄位', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    await voteAll(t, [true, false, true])
    const publicDocs = JSON.stringify([...t.db.dump('rooms'), ...t.db.dump('players')])
    expect(publicDocs).not.toMatch(/"answer"|"guesses"|"allCorrect"/)
    expect(t.db.dump('votes').every((v) => typeof v.answer === 'boolean')).toBe(true)
  })

  it('錯誤的階段操作：結算前確認、投票前猜測、遊戲結束後操作', async () => {
    const t = await createTable(3, { start: true })
    const roundId = round(t).id as string
    await expectGameError(t.svc.ackResult({ roomId: t.roomId, roundId }, oid(0)), 'WRONG_PHASE')
    await expectGameError(
      t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, 0, [true, true, true]) }, oid(0)),
      'WRONG_PHASE',
    )
    await t.svc.endGame({ roomId: t.roomId }, oid(0))
    await expectGameError(t.svc.nextRound({ roomId: t.roomId }, oid(0)), 'WRONG_PHASE')
    await expectGameError(t.svc.leaveRoom({ roomId: t.roomId }, oid(1)).then(() => t.svc.syncState({ roomId: t.roomId }, oid(1))), 'NOT_MEMBER')
  })
})
