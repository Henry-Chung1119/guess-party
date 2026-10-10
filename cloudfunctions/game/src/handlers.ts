/**
 * 遊戲核心邏輯。
 *
 * 設計重點：
 * 1. 所有狀態轉換都用「條件式更新」（where 帶上目前 phase 與 round.id）實作，
 *    多個玩家同時觸發同一個轉換時只有一個會成功，其餘自然失敗且無副作用。
 * 2. 投票 / 猜測文件的 _id 固定為 `${roundId}_${pid}`，利用 _id 唯一性在資料庫層
 *    原子性地防止重複提交，不需要先查再寫。
 * 3. 是否進入下一階段一律以 votes / guesses 集合的「實際計數」判斷，
 *    不信任房間文件上的計數器（計數器只做顯示用）。
 * 4. 任何函數都不會把投票內容回傳給前端；猜測驗證只回傳 allCorrect 布林值。
 */
import * as crypto from 'crypto'
import type { Db, DocData } from './db'
import { GameError, isDuplicateKeyError } from './errors'
import {
  MAX_NICKNAME,
  MAX_PLAYERS,
  MAX_QUESTION,
  MIN_PLAYERS,
  type ActionName,
  type ActionPayloads,
  type ActionResults,
  type MyState,
  type Phase,
  type PlayerPublic,
  type RoomPublic,
  type RoundPublic,
} from './protocol'

// ---------- 資料庫文件型別（含不公開欄位） ----------

interface RoomDoc extends RoomPublic {
  createdAt: Date
  updatedAt: Date
}

interface PlayerDoc extends PlayerPublic {
  joinedAt: Date
  lastSeenAt: Date
}

interface RoundDoc {
  _id: string
  roomId: string
  no: number
  askerPid: string
  askerIndex: number
  question: string | null
  participants: string[]
  phase: Phase
  createdAt: Date
}

interface VoteDoc {
  _id: string
  roomId: string
  roundId: string
  pid: string
  answer: boolean
  createdAt: Date
}

interface GuessDoc {
  _id: string
  roomId: string
  roundId: string
  pid: string
  guesses: Record<string, boolean>
  allCorrect: boolean
  acked: boolean
  createdAt: Date
  ackedAt?: Date
}

// ---------- 服務介面 ----------

export interface ServiceDeps {
  db: Db
  /** 可選的雜湊鹽，部署時以環境變數 PID_SALT 提供 */
  salt?: string
  now?: () => Date
  randomId?: () => string
  randomCode?: () => string
}

type Raw = Record<string, unknown>
type Handler<A extends ActionName> = (payload: ActionPayloads[A], openid: string) => Promise<ActionResults[A]>

export type GameService = { [A in ActionName]: Handler<A> } & {
  dispatch(action: unknown, payload: unknown, openid: string): Promise<unknown>
}

// ---------- 輸入驗證工具 ----------

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readString(raw: Raw, key: string, max: number, label = key): string {
  const v = raw[key]
  if (typeof v !== 'string') throw new GameError('INVALID_INPUT', `缺少${label}`)
  const s = v.trim()
  if (!s || s.length > max) throw new GameError('INVALID_INPUT', `${label}長度需為 1–${max} 字`)
  return s
}

function readBoolean(raw: Raw, key: string, label = key): boolean {
  const v = raw[key]
  if (typeof v !== 'boolean') throw new GameError('INVALID_INPUT', `${label}格式錯誤`)
  return v
}

function readCode(raw: Raw): string {
  const code = readString(raw, 'code', 6, '房間碼')
  if (!/^\d{6}$/.test(code)) throw new GameError('INVALID_INPUT', '房間碼須為 6 位數字')
  return code
}

const err = {
  notMember: () => new GameError('NOT_MEMBER', '你不在這個房間裡'),
  notHost: () => new GameError('NOT_HOST', '只有房主可以執行這個操作'),
  wrongPhase: (msg = '目前階段無法執行這個操作') => new GameError('WRONG_PHASE', msg),
}

export function createGameService(deps: ServiceDeps): GameService {
  const { db } = deps
  const _ = db.command
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? (() => crypto.randomBytes(8).toString('hex'))
  const randomCode = deps.randomCode ?? (() => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'))
  const salt = deps.salt ?? ''

  const rooms = () => db.collection('rooms')
  const players = () => db.collection('players')
  const rounds = () => db.collection('rounds')
  const votes = () => db.collection('votes')
  const guesses = () => db.collection('guesses')

  /** 玩家公開 ID：單向雜湊，前端只會看到 pid，拿不到 openid */
  const pidOf = (roomId: string, openid: string): string =>
    crypto.createHash('sha256').update(`${salt}:${roomId}:${openid}`).digest('hex').slice(0, 16)

  // ---------- 讀取工具 ----------

  async function getDoc<T>(col: string, id: string): Promise<T | null> {
    try {
      const res = await db.collection(col).doc(id).get()
      return (res.data as T | null) ?? null
    } catch {
      return null
    }
  }

  async function loadRoom(roomId: unknown): Promise<RoomDoc> {
    if (typeof roomId !== 'string' || !roomId || roomId.length > 64) {
      throw new GameError('INVALID_INPUT', '缺少房間資訊')
    }
    const room = await getDoc<RoomDoc>('rooms', roomId)
    if (!room) throw new GameError('ROOM_NOT_FOUND', '房間不存在或已關閉')
    return room
  }

  /** 驗證呼叫者是房間成員，回傳房間、pid 與玩家文件 */
  async function requireMember(raw: Raw, openid: string): Promise<{ room: RoomDoc; pid: string; me: PlayerDoc }> {
    const room = await loadRoom(raw.roomId)
    const pid = pidOf(room._id, openid)
    if (!room.playerOrder.includes(pid)) throw err.notMember()
    const me = await getDoc<PlayerDoc>('players', pid)
    if (!me || me.roomId !== room._id) throw err.notMember()
    return { room, pid, me }
  }

  function requireHost(room: RoomDoc, pid: string): void {
    if (room.hostPid !== pid) throw err.notHost()
  }

  function requireRound(room: RoomDoc, phase: Phase, roundId?: unknown): RoundPublic {
    if (room.status !== 'playing' || !room.round || room.phase !== phase) throw err.wrongPhase()
    if (roundId !== undefined && room.round.id !== roundId) {
      throw err.wrongPhase('回合已更新，請重新整理')
    }
    return room.round
  }

  async function listPlayers(roomId: string): Promise<PlayerDoc[]> {
    const res = await players().where({ roomId }).limit(MAX_PLAYERS + 4).get()
    return res.data as unknown as PlayerDoc[]
  }

  // ---------- 回合與狀態轉換 ----------

  function buildRound(roomId: string, no: number, askerIndex: number, playerOrder: string[]) {
    const idx = askerIndex % playerOrder.length
    const askerPid = playerOrder[idx]
    if (!askerPid) throw new GameError('INTERNAL', '找不到出題者')
    const id = randomId()
    const doc: RoundDoc = {
      _id: id,
      roomId,
      no,
      askerPid,
      askerIndex: idx,
      question: null,
      participants: [...playerOrder],
      phase: 'question',
      createdAt: now(),
    }
    const pub: RoundPublic = {
      id,
      no,
      askerPid,
      askerIndex: idx,
      question: null,
      participants: [...playerOrder],
      votedCount: 0,
      guessedCount: 0,
      ackCount: 0,
    }
    return { doc, pub }
  }

  /** 條件式階段轉換：只有房間仍在 `from` 階段且回合未變時才會生效 */
  async function transition(roomId: string, roundId: string, from: Phase, patch: DocData): Promise<boolean> {
    const res = await rooms()
      .where({ _id: roomId, phase: from, 'round.id': roundId })
      .update({ data: { ...patch, updatedAt: now() } })
    return res.stats.updated > 0
  }

  async function countIn(col: string, roundId: string, participants: string[], extra: DocData = {}): Promise<number> {
    if (participants.length === 0) return 0
    const res = await db.collection(col).where({ roundId, pid: _.in(participants), ...extra }).count()
    return res.total
  }

  /** 更新顯示用的進度計數。預設只往上調（_.max）避免併發寫入倒退；移除玩家時以實際值覆寫 */
  async function setProgress(roomId: string, roundId: string, field: 'votedCount' | 'guessedCount' | 'ackCount', value: number, absolute: boolean) {
    await rooms()
      .where({ _id: roomId, 'round.id': roundId })
      .update({ data: { [`round.${field}`]: absolute ? value : _.max(value) } })
  }

  async function endRoom(roomId: string): Promise<void> {
    await rooms().doc(roomId).update({ data: { status: 'ended', phase: 'ended', updatedAt: now() } })
  }

  async function startNextRound(room: RoomDoc): Promise<number> {
    if (!room.round) throw err.wrongPhase()
    const order = room.playerOrder
    const curIdx = order.indexOf(room.round.askerPid)
    const nextIdx = (curIdx === -1 ? room.round.askerIndex : curIdx + 1) % order.length
    const no = room.roundNo + 1
    const { doc, pub } = buildRound(room._id, no, nextIdx, order)
    await rounds().add({ data: doc as unknown as DocData })
    const ok = await transition(room._id, room.round.id, 'result', { phase: 'question', roundNo: no, round: pub })
    if (!ok) {
      // 輸掉競爭（別人已先開啟下一回合），清掉多餘的回合文件
      await rounds().doc(doc._id).remove()
      const latest = await getDoc<RoomDoc>('rooms', room._id)
      return latest?.roundNo ?? room.roundNo
    }
    return no
  }

  /**
   * 檢查目前階段是否已全員完成，是則推進。
   * 每次投票 / 猜測 / 確認結果 / 移除玩家後都會呼叫；可重複呼叫、可併發呼叫。
   */
  async function advanceIfComplete(roomId: string, recount = false): Promise<void> {
    const room = await getDoc<RoomDoc>('rooms', roomId)
    if (!room || room.status !== 'playing' || !room.round) return
    const round = room.round
    const n = round.participants.length
    if (n < 2) {
      await endRoom(roomId)
      return
    }

    if (room.phase === 'voting') {
      const total = await countIn('votes', round.id, round.participants)
      await setProgress(roomId, round.id, 'votedCount', total, recount)
      if (total >= n) {
        await rounds().doc(round.id).update({ data: { phase: 'guessing' } })
        await transition(roomId, round.id, 'voting', { phase: 'guessing', 'round.guessedCount': 0 })
      }
    } else if (room.phase === 'guessing') {
      const total = await countIn('guesses', round.id, round.participants)
      await setProgress(roomId, round.id, 'guessedCount', total, recount)
      if (total >= n) {
        await rounds().doc(round.id).update({ data: { phase: 'result' } })
        await transition(roomId, round.id, 'guessing', { phase: 'result', 'round.ackCount': 0 })
      }
    } else if (room.phase === 'result') {
      const total = await countIn('guesses', round.id, round.participants, { acked: true })
      await setProgress(roomId, round.id, 'ackCount', total, recount)
      if (total >= n) await startNextRound(room)
    }
  }

  /** 將玩家移出房間（自行離開或被房主移除），並處理房主轉移、出題者遞補、階段推進 */
  async function removePlayer(room: RoomDoc, pid: string): Promise<void> {
    const patch: DocData = { playerOrder: _.pull(pid), playerCount: _.inc(-1), updatedAt: now() }
    if (room.round) patch['round.participants'] = _.pull(pid)
    const res = await rooms().where({ _id: room._id, playerOrder: pid }).update({ data: patch })
    await players().doc(pid).remove()
    if (res.stats.updated === 0) return // 已被移除過，避免重複扣減

    const after = await getDoc<RoomDoc>('rooms', room._id)
    if (!after) return
    if (after.playerOrder.length === 0) {
      await endRoom(after._id)
      return
    }
    if (after.hostPid === pid) {
      await rooms().doc(after._id).update({ data: { hostPid: after.playerOrder[0], updatedAt: now() } })
    }
    if (after.status !== 'playing' || !after.round) return

    if (after.phase === 'question' && after.round.askerPid === pid) {
      const idx = after.round.askerIndex % after.playerOrder.length
      const newAsker = after.playerOrder[idx]
      await rooms()
        .where({ _id: after._id, phase: 'question', 'round.id': after.round.id })
        .update({ data: { 'round.askerPid': newAsker, 'round.askerIndex': idx, updatedAt: now() } })
      await rounds().doc(after.round.id).update({ data: { askerPid: newAsker, askerIndex: idx } })
    }
    await advanceIfComplete(after._id, true)
  }

  // ---------- 操作處理 ----------

  async function createRoom(raw: Raw, openid: string): Promise<ActionResults['createRoom']> {
    const nickname = readString(raw, 'nickname', MAX_NICKNAME, '暱稱')
    const roomId = randomId()
    const pid = pidOf(roomId, openid)

    let code = ''
    for (let i = 0; i < 6 && !code; i++) {
      const candidate = randomCode()
      const { total } = await rooms().where({ code: candidate, status: _.neq('ended') }).count()
      if (total === 0) code = candidate
    }
    if (!code) throw new GameError('INTERNAL', '目前無法建立房間，請稍後再試')

    const t = now()
    const room: RoomDoc = {
      _id: roomId,
      code,
      hostPid: pid,
      status: 'lobby',
      phase: 'lobby',
      playerOrder: [pid],
      playerCount: 1,
      maxPlayers: MAX_PLAYERS,
      roundNo: 0,
      round: null,
      createdAt: t,
      updatedAt: t,
    }
    await rooms().add({ data: room as unknown as DocData })
    const player: PlayerDoc = { _id: pid, roomId, nickname, ready: true, online: true, joinedAt: t, lastSeenAt: t }
    await players().add({ data: player as unknown as DocData })
    return { roomId, code, pid }
  }

  async function rejoin(room: RoomDoc, pid: string, nickname: string): Promise<ActionResults['joinRoom']> {
    await players().doc(pid).update({ data: { online: true, lastSeenAt: now(), nickname } })
    return { roomId: room._id, code: room.code, pid, rejoined: true, status: room.status }
  }

  async function joinRoom(raw: Raw, openid: string): Promise<ActionResults['joinRoom']> {
    const nickname = readString(raw, 'nickname', MAX_NICKNAME, '暱稱')
    const code = readCode(raw)

    const found = await rooms().where({ code, status: _.neq('ended') }).orderBy('createdAt', 'desc').limit(1).get()
    const room = found.data[0] as unknown as RoomDoc | undefined
    if (!room) throw new GameError('ROOM_NOT_FOUND', '找不到這個房間，請確認房間碼')

    const pid = pidOf(room._id, openid)
    if (room.playerOrder.includes(pid)) return rejoin(room, pid, nickname)
    if (room.status !== 'lobby') throw new GameError('GAME_STARTED', '遊戲已經開始，無法中途加入')
    if (room.playerCount >= room.maxPlayers) throw new GameError('ROOM_FULL', '房間已滿')

    const t = now()
    // 原子性加入：人數上限、狀態、未重複都在同一個條件式更新中檢查
    const res = await rooms()
      .where({ _id: room._id, status: 'lobby', playerCount: _.lt(room.maxPlayers), playerOrder: _.nin([pid]) })
      .update({ data: { playerOrder: _.push([pid]), playerCount: _.inc(1), updatedAt: t } })

    if (res.stats.updated === 0) {
      const again = await getDoc<RoomDoc>('rooms', room._id)
      if (again?.playerOrder.includes(pid)) return rejoin(again, pid, nickname)
      if (!again || again.status !== 'lobby') throw new GameError('GAME_STARTED', '遊戲已經開始，無法中途加入')
      throw new GameError('ROOM_FULL', '房間已滿')
    }

    await players()
      .doc(pid)
      .set({ data: { roomId: room._id, nickname, ready: false, online: true, joinedAt: t, lastSeenAt: t } })
    return { roomId: room._id, code: room.code, pid, rejoined: false, status: 'lobby' }
  }

  async function leaveRoom(raw: Raw, openid: string): Promise<ActionResults['leaveRoom']> {
    const { room, pid } = await requireMember(raw, openid)
    await removePlayer(room, pid)
    return { left: true }
  }

  async function setReady(raw: Raw, openid: string): Promise<ActionResults['setReady']> {
    const ready = readBoolean(raw, 'ready', '準備狀態')
    const { room, pid } = await requireMember(raw, openid)
    if (room.status !== 'lobby') throw err.wrongPhase('遊戲已開始')
    if (room.hostPid === pid) return { ready: true } // 房主永遠視為已準備
    await players().doc(pid).update({ data: { ready, lastSeenAt: now() } })
    return { ready }
  }

  async function kickPlayer(raw: Raw, openid: string): Promise<ActionResults['kickPlayer']> {
    const { room, pid } = await requireMember(raw, openid)
    requireHost(room, pid)
    const target = readString(raw, 'targetPid', 32, '目標玩家')
    if (target === pid) throw new GameError('INVALID_INPUT', '不能移除自己')
    if (!room.playerOrder.includes(target)) throw new GameError('INVALID_INPUT', '該玩家不在房間內')
    await removePlayer(room, target)
    return { removed: true }
  }

  async function startGame(raw: Raw, openid: string): Promise<ActionResults['startGame']> {
    const { room, pid } = await requireMember(raw, openid)
    requireHost(room, pid)
    if (room.status !== 'lobby') throw err.wrongPhase('遊戲已經開始')
    if (room.playerOrder.length < MIN_PLAYERS) {
      throw new GameError('NOT_ENOUGH_PLAYERS', `至少需要 ${MIN_PLAYERS} 位玩家`)
    }
    const list = await listPlayers(room._id)
    const notReady = list.filter((p) => p._id !== room.hostPid && !p.ready)
    if (notReady.length > 0) {
      throw new GameError('PLAYERS_NOT_READY', `還有 ${notReady.length} 位玩家尚未準備`)
    }

    const { doc, pub } = buildRound(room._id, 1, 0, room.playerOrder)
    await rounds().add({ data: doc as unknown as DocData })
    const res = await rooms()
      .where({ _id: room._id, status: 'lobby' })
      .update({ data: { status: 'playing', phase: 'question', roundNo: 1, round: pub, updatedAt: now() } })
    if (res.stats.updated === 0) {
      await rounds().doc(doc._id).remove()
      throw err.wrongPhase('遊戲已經開始')
    }
    return { roundId: doc._id }
  }

  async function submitQuestion(raw: Raw, openid: string): Promise<ActionResults['submitQuestion']> {
    const question = readString(raw, 'question', MAX_QUESTION, '題目')
    const { room, pid } = await requireMember(raw, openid)
    const round = requireRound(room, 'question')
    if (round.askerPid !== pid) throw new GameError('NOT_ASKER', '這一回合不是由你出題')

    await rounds().doc(round.id).update({ data: { question, phase: 'voting' } })
    const ok = await transition(room._id, round.id, 'question', {
      phase: 'voting',
      'round.question': question,
      'round.votedCount': 0,
    })
    if (!ok) throw new GameError('CONFLICT', '題目已經公布過了')
    return { roundId: round.id }
  }

  async function submitVote(raw: Raw, openid: string): Promise<ActionResults['submitVote']> {
    const answer = readBoolean(raw, 'answer', '答案')
    const { room, pid } = await requireMember(raw, openid)
    const round = requireRound(room, 'voting', raw.roundId)
    if (!round.participants.includes(pid)) throw new GameError('NOT_MEMBER', '你不是本回合的參與者')

    const vote: VoteDoc = { _id: `${round.id}_${pid}`, roomId: room._id, roundId: round.id, pid, answer, createdAt: now() }
    try {
      await votes().add({ data: vote as unknown as DocData })
    } catch (e) {
      if (isDuplicateKeyError(e)) throw new GameError('ALREADY_VOTED', '你已經投過票了')
      throw e
    }
    await advanceIfComplete(room._id)
    return { voted: true }
  }

  async function submitGuess(raw: Raw, openid: string): Promise<ActionResults['submitGuess']> {
    const input = raw.guesses
    if (!isRecord(input)) throw new GameError('INVALID_INPUT', '猜測資料格式錯誤')
    const { room, pid } = await requireMember(raw, openid)
    const round = requireRound(room, 'guessing', raw.roundId)
    if (!round.participants.includes(pid)) throw new GameError('NOT_MEMBER', '你不是本回合的參與者')

    const targets = round.participants.filter((p) => p !== pid)
    const keys = Object.keys(input)
    const valid = keys.length === targets.length && targets.every((t) => typeof input[t] === 'boolean')
    if (!valid) throw new GameError('INVALID_INPUT', '猜測名單與目前玩家不符，請重新整理後再試')

    const guessId = `${round.id}_${pid}`
    const existing = await getDoc<GuessDoc>('guesses', guessId)
    if (existing) return { allCorrect: existing.allCorrect, alreadySubmitted: true }

    // 驗證只在後端進行：讀取其他人的真實投票並比對，結果只保留一個布林值
    const voteRes = await votes().where({ roundId: round.id, pid: _.in(targets) }).get()
    const answers = new Map<string, boolean>()
    for (const v of voteRes.data as unknown as VoteDoc[]) answers.set(v.pid, v.answer)
    if (answers.size !== targets.length) throw new GameError('INTERNAL', '投票資料不完整，請稍後再試')

    const myGuesses: Record<string, boolean> = {}
    for (const t of targets) myGuesses[t] = input[t] as boolean
    const allCorrect = targets.every((t) => answers.get(t) === myGuesses[t])

    const doc: GuessDoc = {
      _id: guessId,
      roomId: room._id,
      roundId: round.id,
      pid,
      guesses: myGuesses,
      allCorrect,
      acked: false,
      createdAt: now(),
    }
    try {
      await guesses().add({ data: doc as unknown as DocData })
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        // 併發的重複提交：一律回傳第一次寫入的結果，不重新計算
        const again = await getDoc<GuessDoc>('guesses', guessId)
        return { allCorrect: again ? again.allCorrect : allCorrect, alreadySubmitted: true }
      }
      throw e
    }
    await advanceIfComplete(room._id)
    return { allCorrect, alreadySubmitted: false }
  }

  async function ackResult(raw: Raw, openid: string): Promise<ActionResults['ackResult']> {
    const { room, pid } = await requireMember(raw, openid)
    const round = requireRound(room, 'result', raw.roundId)
    if (!round.participants.includes(pid)) throw new GameError('NOT_MEMBER', '你不是本回合的參與者')
    await guesses()
      .where({ _id: `${round.id}_${pid}`, acked: false })
      .update({ data: { acked: true, ackedAt: now() } })
    await advanceIfComplete(room._id)
    return { acked: true }
  }

  async function nextRound(raw: Raw, openid: string): Promise<ActionResults['nextRound']> {
    const { room, pid } = await requireMember(raw, openid)
    requireHost(room, pid)
    requireRound(room, 'result')
    const roundNo = await startNextRound(room)
    return { roundNo }
  }

  async function endGame(raw: Raw, openid: string): Promise<ActionResults['endGame']> {
    const { room, pid } = await requireMember(raw, openid)
    requireHost(room, pid)
    if (room.status === 'ended') return { ended: true }
    await endRoom(room._id)
    return { ended: true }
  }

  /** 重新進入房間 / 斷線重連時取得完整狀態，其中 me 只包含本人的私有資訊 */
  async function syncState(raw: Raw, openid: string): Promise<ActionResults['syncState']> {
    const { room, pid } = await requireMember(raw, openid)
    const t = now()
    await players().doc(pid).update({ data: { online: true, lastSeenAt: t } })
    const list = await listPlayers(room._id)

    const me: MyState = {
      pid,
      isHost: room.hostPid === pid,
      hasVoted: false,
      hasGuessed: false,
      allCorrect: null,
      acked: false,
    }
    if (room.round) {
      const [vote, guess] = await Promise.all([
        getDoc<VoteDoc>('votes', `${room.round.id}_${pid}`),
        getDoc<GuessDoc>('guesses', `${room.round.id}_${pid}`),
      ])
      me.hasVoted = vote !== null
      if (guess) {
        me.hasGuessed = true
        me.allCorrect = guess.allCorrect
        me.acked = guess.acked
      }
    }
    const publicPlayers: PlayerPublic[] = list.map((p) => ({
      _id: p._id,
      roomId: p.roomId,
      nickname: p.nickname,
      ready: p.ready,
      online: p.online,
    }))
    return { room, players: publicPlayers, me }
  }

  async function setPresence(raw: Raw, openid: string): Promise<ActionResults['setPresence']> {
    const online = readBoolean(raw, 'online', '在線狀態')
    const { pid } = await requireMember(raw, openid)
    await players().doc(pid).update({ data: { online, lastSeenAt: now() } })
    return { online }
  }

  const handlers: Record<ActionName, (raw: Raw, openid: string) => Promise<unknown>> = {
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    kickPlayer,
    startGame,
    submitQuestion,
    submitVote,
    submitGuess,
    ackResult,
    nextRound,
    endGame,
    syncState,
    setPresence,
  }

  async function dispatch(action: unknown, payload: unknown, openid: string): Promise<unknown> {
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, action)) {
      throw new GameError('INVALID_INPUT', '未知的操作')
    }
    if (typeof openid !== 'string' || !openid) throw new GameError('INTERNAL', '無法取得使用者身份')
    const raw = isRecord(payload) ? payload : {}
    return handlers[action as ActionName](raw, openid)
  }

  return { ...handlers, dispatch } as unknown as GameService
}
