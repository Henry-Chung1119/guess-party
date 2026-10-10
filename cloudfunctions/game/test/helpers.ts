import { expect } from 'vitest'
import { createGameService, type GameService } from '../src/handlers'
import { GameError } from '../src/errors'
import type { ErrorCode } from '../src/protocol'
import { createFakeDb, type FakeDb } from './fakeDb'

export interface Table {
  db: FakeDb
  svc: GameService
  roomId: string
  code: string
  /** openids[i] 對應 pids[i]，i = 0 為房主 */
  openids: string[]
  pids: string[]
}

export const oid = (i: number) => `openid-${i}`

/** 建立一個已有 n 位玩家（全部已準備）的大廳 */
export async function createTable(n: number, opts: { start?: boolean } = {}): Promise<Table> {
  const db = createFakeDb()
  const svc = createGameService({ db })
  const host = await svc.createRoom({ nickname: '玩家0' }, oid(0))
  const openids = [oid(0)]
  const pids = [host.pid]
  for (let i = 1; i < n; i++) {
    const r = await svc.joinRoom({ code: host.code, nickname: `玩家${i}` }, oid(i))
    openids.push(oid(i))
    pids.push(r.pid)
    await svc.setReady({ roomId: host.roomId, ready: true }, oid(i))
  }
  const table: Table = { db, svc, roomId: host.roomId, code: host.code, openids, pids }
  if (opts.start) await svc.startGame({ roomId: host.roomId }, oid(0))
  return table
}

export const room = (t: Table) => t.db.dump('rooms').find((r) => r._id === t.roomId) as Record<string, any>
export const round = (t: Table) => room(t).round as Record<string, any>

/** 由目前出題者送出題目 */
export async function ask(t: Table, question = '你今天有說過謊嗎？') {
  const askerIdx = t.pids.indexOf(round(t).askerPid)
  return t.svc.submitQuestion({ roomId: t.roomId, question }, t.openids[askerIdx]!)
}

/** 所有參與者依指定答案投票 */
export async function voteAll(t: Table, answers: boolean[]) {
  const roundId = round(t).id as string
  await Promise.all(
    t.openids.map((o, i) => t.svc.submitVote({ roomId: t.roomId, roundId, answer: answers[i]! }, o)),
  )
}

/** 以真實答案建立某位玩家的完美猜測 */
export function perfectGuess(t: Table, me: number, answers: boolean[]): Record<string, boolean> {
  const g: Record<string, boolean> = {}
  t.pids.forEach((p, i) => {
    if (i !== me) g[p] = answers[i]!
  })
  return g
}

export async function expectGameError(p: Promise<unknown>, code: ErrorCode) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(GameError)
    expect((e as GameError).code).toBe(code)
    return
  }
  throw new Error(`expected GameError ${code} but promise resolved`)
}
