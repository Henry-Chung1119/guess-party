import { describe, expect, it } from 'vitest'
import { createGameService } from '../src/handlers'
import { MAX_PLAYERS } from '../src/protocol'
import { createFakeDb } from './fakeDb'
import { createTable, expectGameError, oid, room } from './helpers'

describe('建立與加入房間', () => {
  it('建立房間會產生 6 位數房間碼，房主自動加入且已準備', async () => {
    const db = createFakeDb()
    const svc = createGameService({ db })
    const r = await svc.createRoom({ nickname: '小明' }, oid(0))
    expect(r.code).toMatch(/^\d{6}$/)
    const doc = db.dump('rooms')[0]!
    expect(doc.status).toBe('lobby')
    expect(doc.hostPid).toBe(r.pid)
    expect(doc.playerOrder).toEqual([r.pid])
    const player = db.dump('players')[0]!
    expect(player.nickname).toBe('小明')
    expect(player.ready).toBe(true)
    expect(JSON.stringify(player)).not.toContain('openid')
  })

  it('房間碼重複時會重新產生', async () => {
    const db = createFakeDb()
    const codes = ['111111', '111111', '222222']
    const svc = createGameService({ db, randomCode: () => codes.shift() ?? '999999' })
    const a = await svc.createRoom({ nickname: 'A' }, oid(0))
    const b = await svc.createRoom({ nickname: 'B' }, oid(1))
    expect(a.code).toBe('111111')
    expect(b.code).toBe('222222')
  })

  it('輸入房間碼可加入，依加入順序排列', async () => {
    const t = await createTable(3)
    expect(room(t).playerOrder).toEqual(t.pids)
    expect(room(t).playerCount).toBe(3)
  })

  it('不存在的房間碼或格式錯誤會被拒絕', async () => {
    const t = await createTable(1)
    await expectGameError(t.svc.joinRoom({ code: '000000', nickname: 'X' }, oid(9)), 'ROOM_NOT_FOUND')
    await expectGameError(t.svc.joinRoom({ code: '12ab', nickname: 'X' }, oid(9)), 'INVALID_INPUT')
    await expectGameError(t.svc.joinRoom({ code: t.code, nickname: '' }, oid(9)), 'INVALID_INPUT')
    await expectGameError(t.svc.joinRoom({ code: t.code, nickname: '這個暱稱實在是太長太長太長了' }, oid(9)), 'INVALID_INPUT')
  })

  it('同一位玩家重複加入會回到原本的位置，不會佔用新名額', async () => {
    const t = await createTable(2)
    const again = await t.svc.joinRoom({ code: t.code, nickname: '新暱稱' }, oid(1))
    expect(again.rejoined).toBe(true)
    expect(again.pid).toBe(t.pids[1])
    expect(room(t).playerCount).toBe(2)
    expect(room(t).playerOrder).toHaveLength(2)
  })

  it('人數上限 12：滿員後再加入會被拒絕，併發搶最後一席只有一人成功', async () => {
    const t = await createTable(MAX_PLAYERS - 1)
    const results = await Promise.allSettled([
      t.svc.joinRoom({ code: t.code, nickname: 'a' }, oid(100)),
      t.svc.joinRoom({ code: t.code, nickname: 'b' }, oid(101)),
      t.svc.joinRoom({ code: t.code, nickname: 'c' }, oid(102)),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    expect(room(t).playerCount).toBe(MAX_PLAYERS)
    expect(room(t).playerOrder).toHaveLength(MAX_PLAYERS)
    expect(t.db.dump('players')).toHaveLength(MAX_PLAYERS)
    await expectGameError(t.svc.joinRoom({ code: t.code, nickname: 'd' }, oid(103)), 'ROOM_FULL')
  })

  it('遊戲開始後不能中途加入，但原成員可以用房間碼重新進入', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.joinRoom({ code: t.code, nickname: '晚到' }, oid(9)), 'GAME_STARTED')
    const back = await t.svc.joinRoom({ code: t.code, nickname: '玩家1' }, oid(1))
    expect(back.rejoined).toBe(true)
    expect(back.status).toBe('playing')
  })
})

describe('準備與開始', () => {
  it('非房主不能開始遊戲', async () => {
    const t = await createTable(3)
    await expectGameError(t.svc.startGame({ roomId: t.roomId }, oid(1)), 'NOT_HOST')
  })

  it('人數不足 3 人不能開始', async () => {
    const t = await createTable(2)
    await expectGameError(t.svc.startGame({ roomId: t.roomId }, oid(0)), 'NOT_ENOUGH_PLAYERS')
  })

  it('有人未準備不能開始，準備後即可', async () => {
    const t = await createTable(3)
    await t.svc.setReady({ roomId: t.roomId, ready: false }, oid(2))
    await expectGameError(t.svc.startGame({ roomId: t.roomId }, oid(0)), 'PLAYERS_NOT_READY')
    await t.svc.setReady({ roomId: t.roomId, ready: true }, oid(2))
    const r = await t.svc.startGame({ roomId: t.roomId }, oid(0))
    expect(room(t).status).toBe('playing')
    expect(room(t).phase).toBe('question')
    expect(room(t).round.id).toBe(r.roundId)
    expect(room(t).round.askerPid).toBe(t.pids[0])
    expect(room(t).round.participants).toEqual(t.pids)
  })

  it('重複按開始只會建立一個回合', async () => {
    const t = await createTable(3)
    const results = await Promise.allSettled([
      t.svc.startGame({ roomId: t.roomId }, oid(0)),
      t.svc.startGame({ roomId: t.roomId }, oid(0)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(t.db.dump('rounds')).toHaveLength(1)
    expect(room(t).roundNo).toBe(1)
  })

  it('開始後 setReady 會被拒絕', async () => {
    const t = await createTable(3, { start: true })
    await expectGameError(t.svc.setReady({ roomId: t.roomId, ready: false }, oid(1)), 'WRONG_PHASE')
  })
})

describe('離開與移除', () => {
  it('玩家離開大廳後名單更新；房主離開會把房主轉給下一位', async () => {
    const t = await createTable(3)
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(0))
    expect(room(t).hostPid).toBe(t.pids[1])
    expect(room(t).playerOrder).toEqual([t.pids[1], t.pids[2]])
    expect(room(t).playerCount).toBe(2)
    await expectGameError(t.svc.setReady({ roomId: t.roomId, ready: true }, oid(0)), 'NOT_MEMBER')
  })

  it('最後一人離開時房間自動關閉', async () => {
    const t = await createTable(1)
    await t.svc.leaveRoom({ roomId: t.roomId }, oid(0))
    expect(room(t).status).toBe('ended')
  })

  it('只有房主能移除玩家，且不能移除自己', async () => {
    const t = await createTable(3)
    await expectGameError(t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[2]! }, oid(1)), 'NOT_HOST')
    await expectGameError(t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[0]! }, oid(0)), 'INVALID_INPUT')
    await t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[2]! }, oid(0))
    expect(room(t).playerOrder).toEqual([t.pids[0], t.pids[1]])
    expect(t.db.dump('players').map((p) => p._id)).not.toContain(t.pids[2])
  })

  it('被移除的玩家可以在大廳階段重新加入（視為新成員）', async () => {
    const t = await createTable(3)
    await t.svc.kickPlayer({ roomId: t.roomId, targetPid: t.pids[1]! }, oid(0))
    const r = await t.svc.joinRoom({ code: t.code, nickname: '回來了' }, oid(1))
    expect(r.rejoined).toBe(false)
    expect(room(t).playerOrder).toEqual([t.pids[0], t.pids[2], t.pids[1]])
  })
})
