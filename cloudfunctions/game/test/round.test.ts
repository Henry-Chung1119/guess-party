import { describe, expect, it } from 'vitest'
import { ask, createTable, expectGameError, oid, perfectGuess, room, round, voteAll } from './helpers'

describe('出題階段', () => {
  it('只有出題者能出題，其他人會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.submitQuestion({ roomId: t.roomId, question: '偷問' }, oid(1)), 'NOT_ASKER')
    await expectGameError(t.svc.submitQuestion({ roomId: t.roomId, question: '' }, oid(0)), 'INVALID_INPUT')
    await ask(t, '你曾經喜歡過現場的某個人嗎？')
    expect(room(t).phase).toBe('voting')
    expect(round(t).question).toBe('你曾經喜歡過現場的某個人嗎？')
    expect(round(t).votedCount).toBe(0)
  })

  it('出題前不能投票，出題後不能再改題目', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(
      t.svc.submitVote({ roomId: t.roomId, roundId: round(t).id, answer: true }, oid(1)),
      'WRONG_PHASE',
    )
    await ask(t)
    await expectGameError(t.svc.submitQuestion({ roomId: t.roomId, question: '改題' }, oid(0)), 'WRONG_PHASE')
  })
})

describe('匿名投票', () => {
  it('每人只能投一次，重複投票被拒絕且不影響計數', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(1))
    await expectGameError(t.svc.submitVote({ roomId: t.roomId, roundId, answer: false }, oid(1)), 'ALREADY_VOTED')
    expect(t.db.dump('votes')).toHaveLength(1)
    expect(t.db.dump('votes')[0]!.answer).toBe(true)
    expect(round(t).votedCount).toBe(1)
    expect(room(t).phase).toBe('voting')
  })

  it('非成員與錯誤的 roundId 都會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    await expectGameError(
      t.svc.submitVote({ roomId: t.roomId, roundId: round(t).id, answer: true }, oid(99)),
      'NOT_MEMBER',
    )
    await expectGameError(t.svc.submitVote({ roomId: t.roomId, roundId: 'stale', answer: true }, oid(1)), 'WRONG_PHASE')
    await expectGameError(
      t.svc.submitVote({ roomId: t.roomId, roundId: round(t).id, answer: 'yes' as unknown as boolean }, oid(1)),
      'INVALID_INPUT',
    )
  })

  it('多人同時投票：所有票都被記錄，且只發生一次階段轉換', async () => {
    for (let run = 0; run < 5; run++) {
      const t = await createTable(6, { start: true })
      await ask(t)
      await voteAll(t, [true, false, true, true, false, false])
      expect(t.db.dump('votes')).toHaveLength(6)
      expect(room(t).phase).toBe('guessing')
      expect(round(t).votedCount).toBe(6)
      expect(round(t).guessedCount).toBe(0)
      expect(t.db.dump('rounds')).toHaveLength(1)
      expect(t.db.dump('rounds')[0]!.phase).toBe('guessing')
    }
  })

  it('同一人連點兩下只會算一票', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    const results = await Promise.allSettled([
      t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(2)),
      t.svc.submitVote({ roomId: t.roomId, roundId, answer: false }, oid(2)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(t.db.dump('votes')).toHaveLength(1)
  })
})

describe('猜測與後端驗證', () => {
  const answers = [true, false, true, false]

  it('全部猜對回傳 true；任一錯誤回傳 false；回應中不含任何投票內容', async () => {
    const t = await createTable(4, { start: true })
    await ask(t)
    await voteAll(t, answers)
    const roundId = round(t).id as string

    const perfect = await t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, 1, answers) }, oid(1))
    expect(perfect).toEqual({ allCorrect: true, alreadySubmitted: false })

    const wrongOne = perfectGuess(t, 2, answers)
    wrongOne[t.pids[3]!] = !wrongOne[t.pids[3]!]
    const miss = await t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: wrongOne }, oid(2))
    expect(miss).toEqual({ allCorrect: false, alreadySubmitted: false })
    // 回應只有布林值，沒有任何欄位能推回真實答案或錯幾題
    expect(Object.keys(miss)).toEqual(['allCorrect', 'alreadySubmitted'])
  })

  it('猜測名單必須恰好是其他參與者：缺人、多人、猜自己都會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    await voteAll(t, [true, true, false])
    const roundId = round(t).id as string
    const base = perfectGuess(t, 1, [true, true, false])

    const missing = { ...base }
    delete missing[t.pids[2]!]
    await expectGameError(t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: missing }, oid(1)), 'INVALID_INPUT')

    const extra = { ...base, ghost: true }
    await expectGameError(t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: extra }, oid(1)), 'INVALID_INPUT')

    const withSelf = { ...base, [t.pids[1]!]: true }
    await expectGameError(t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: withSelf }, oid(1)), 'INVALID_INPUT')

    const notBoolean = { ...base, [t.pids[0]!]: 'yes' } as unknown as Record<string, boolean>
    await expectGameError(t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: notBoolean }, oid(1)), 'INVALID_INPUT')
    expect(t.db.dump('guesses')).toHaveLength(0)
  })

  it('重複提交（含併發）不會重新驗證，一律回傳第一次的結果 — 無法暴力破解', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    await voteAll(t, [true, false, false])
    const roundId = round(t).id as string
    const wrong = perfectGuess(t, 1, [false, false, true]) // 全錯
    const right = perfectGuess(t, 1, [true, false, false])

    const [first, second] = await Promise.all([
      t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: wrong }, oid(1)),
      t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: right }, oid(1)),
    ])
    // 兩次回應的 allCorrect 必須相同（皆為先寫入者的結果），且只存了一筆猜測
    expect(first.allCorrect).toBe(second.allCorrect)
    expect(t.db.dump('guesses').filter((g) => g.pid === t.pids[1])).toHaveLength(1)

    // 之後再試其他組合，仍只拿到同一個結果
    for (const g of [right, wrong]) {
      const again = await t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: g }, oid(1))
      expect(again.alreadySubmitted).toBe(true)
      expect(again.allCorrect).toBe(first.allCorrect)
    }
  })

  it('投票階段還沒結束不能猜測', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    const roundId = round(t).id as string
    await t.svc.submitVote({ roomId: t.roomId, roundId, answer: true }, oid(0))
    await expectGameError(
      t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, 1, [true, true, true]) }, oid(1)),
      'WRONG_PHASE',
    )
  })

  it('所有人完成猜測後進入結算；syncState 只回傳本人的結果', async () => {
    const t = await createTable(3, { start: true })
    await ask(t)
    await voteAll(t, answers)
    const roundId = round(t).id as string
    await Promise.all(
      t.openids.map((o, i) =>
        t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, i, i === 2 ? [false, false, false] : answers) }, o),
      ),
    )
    expect(room(t).phase).toBe('result')
    expect(round(t).guessedCount).toBe(3)

    const s1 = await t.svc.syncState({ roomId: t.roomId }, oid(1))
    expect(s1.me).toMatchObject({ hasVoted: true, hasGuessed: true, allCorrect: true, acked: false })
    const s2 = await t.svc.syncState({ roomId: t.roomId }, oid(2))
    expect(s2.me.allCorrect).toBe(false)
    // 公開資料裡沒有任何 answer / allCorrect 欄位
    const publicJson = JSON.stringify({ room: s2.room, players: s2.players })
    expect(publicJson).not.toMatch(/"answer"|"allCorrect"|"guesses"|openid/)
  })
})

describe('結算確認與回合切換', () => {
  async function playRound(t: Awaited<ReturnType<typeof createTable>>, answers: boolean[]) {
    await ask(t)
    await voteAll(t, answers)
    const roundId = round(t).id as string
    await Promise.all(
      t.openids.map((o, i) => t.svc.submitGuess({ roomId: t.roomId, roundId, guesses: perfectGuess(t, i, answers) }, o)),
    )
    return roundId
  }

  it('所有人確認後進入下一回合，換下一位出題，玩家與房間保留', async () => {
    const t = await createTable(3, { start: true })
    const r1 = await playRound(t, [true, false, true])
    await Promise.all(t.openids.map((o) => t.svc.ackResult({ roomId: t.roomId, roundId: r1 }, o)))
    expect(room(t).roundNo).toBe(2)
    expect(room(t).phase).toBe('question')
    expect(round(t).askerPid).toBe(t.pids[1])
    expect(round(t).question).toBeNull()
    expect(round(t).votedCount).toBe(0)
    expect(room(t).playerOrder).toEqual(t.pids)
    expect(t.db.dump('rounds')).toHaveLength(2)

    // 新回合的私有狀態已重置
    const s = await t.svc.syncState({ roomId: t.roomId }, oid(0))
    expect(s.me).toMatchObject({ hasVoted: false, hasGuessed: false, allCorrect: null, acked: false })
  })

  it('出題順序會循環：第 4 回合回到第一位', async () => {
    const t = await createTable(3, { start: true })
    for (let i = 0; i < 3; i++) {
      expect(round(t).askerPid).toBe(t.pids[i % 3])
      const rid = await playRound(t, [true, true, false])
      await Promise.all(t.openids.map((o) => t.svc.ackResult({ roomId: t.roomId, roundId: rid }, o)))
    }
    expect(room(t).roundNo).toBe(4)
    expect(round(t).askerPid).toBe(t.pids[0])
  })

  it('重複確認與併發確認只會開啟一個新回合', async () => {
    const t = await createTable(4, { start: true })
    const r1 = await playRound(t, [true, false, true, false])
    await Promise.all([
      ...t.openids.map((o) => t.svc.ackResult({ roomId: t.roomId, roundId: r1 }, o)),
      ...t.openids.map((o) => t.svc.ackResult({ roomId: t.roomId, roundId: r1 }, o)),
    ])
    expect(room(t).roundNo).toBe(2)
    expect(t.db.dump('rounds')).toHaveLength(2)
  })

  it('房主可以在結算階段強制開始下一回合；非結算階段不行', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.nextRound({ roomId: t.roomId }, oid(0)), 'WRONG_PHASE')
    await playRound(t, [true, false, true])
    await expectGameError(t.svc.nextRound({ roomId: t.roomId }, oid(1)), 'NOT_HOST')
    const r = await t.svc.nextRound({ roomId: t.roomId }, oid(0))
    expect(r.roundNo).toBe(2)
    expect(room(t).phase).toBe('question')
  })

  it('房主可以結束遊戲，之後所有操作都會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.endGame({ roomId: t.roomId }, oid(2)), 'NOT_HOST')
    await t.svc.endGame({ roomId: t.roomId }, oid(0))
    expect(room(t).status).toBe('ended')
    expect(room(t).phase).toBe('ended')
    await expectGameError(t.svc.submitQuestion({ roomId: t.roomId, question: 'x' }, oid(0)), 'WRONG_PHASE')
  })
})
