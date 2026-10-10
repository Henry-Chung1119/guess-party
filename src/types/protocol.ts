/**
 * 前後端共用的通訊協定與型別。
 *
 * ⚠️ 本檔案是前端副本，主檔在 cloudfunctions/game/src/protocol.ts，兩份內容必須完全相同：
 *   - cloudfunctions/game/src/protocol.ts（主檔）
 *   - src/types/protocol.ts（前端副本）
 * 修改任一份時請同步另一份。（Taro 與雲函數是兩個獨立的編譯環境，直接共用檔案會讓建置變複雜，MVP 先以複製處理。）
 */

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 12
export const MAX_NICKNAME = 12
export const MAX_QUESTION = 80

export type RoomStatus = 'lobby' | 'playing' | 'ended'
export type Phase = 'lobby' | 'question' | 'voting' | 'guessing' | 'result' | 'ended'

/** 房間文件中對所有成員公開的回合資訊（不含任何投票內容） */
export interface RoundPublic {
  id: string
  no: number
  askerPid: string
  askerIndex: number
  question: string | null
  participants: string[]
  votedCount: number
  guessedCount: number
  ackCount: number
}

export interface RoomPublic {
  _id: string
  code: string
  hostPid: string
  status: RoomStatus
  phase: Phase
  /** 以加入順序排列的玩家公開 ID（pid），同時也是出題順序 */
  playerOrder: string[]
  playerCount: number
  maxPlayers: number
  roundNo: number
  round: RoundPublic | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface PlayerPublic {
  /** pid：由 roomId + openid 雜湊而成，前端永遠拿不到任何人的 openid */
  _id: string
  roomId: string
  nickname: string
  ready: boolean
  online: boolean
  joinedAt?: unknown
  lastSeenAt?: unknown
}

/** 只回傳給本人的私有狀態 */
export interface MyState {
  pid: string
  isHost: boolean
  hasVoted: boolean
  hasGuessed: boolean
  allCorrect: boolean | null
  acked: boolean
}

export interface ActionPayloads {
  createRoom: { nickname: string }
  joinRoom: { code: string; nickname: string }
  leaveRoom: { roomId: string }
  setReady: { roomId: string; ready: boolean }
  kickPlayer: { roomId: string; targetPid: string }
  startGame: { roomId: string }
  submitQuestion: { roomId: string; question: string }
  submitVote: { roomId: string; roundId: string; answer: boolean }
  submitGuess: { roomId: string; roundId: string; guesses: Record<string, boolean> }
  ackResult: { roomId: string; roundId: string }
  nextRound: { roomId: string }
  endGame: { roomId: string }
  syncState: { roomId: string }
  setPresence: { roomId: string; online: boolean }
}

export interface ActionResults {
  createRoom: { roomId: string; code: string; pid: string }
  joinRoom: { roomId: string; code: string; pid: string; rejoined: boolean; status: RoomStatus }
  leaveRoom: { left: true }
  setReady: { ready: boolean }
  kickPlayer: { removed: true }
  startGame: { roundId: string }
  submitQuestion: { roundId: string }
  submitVote: { voted: true }
  submitGuess: { allCorrect: boolean; alreadySubmitted: boolean }
  ackResult: { acked: true }
  nextRound: { roundNo: number }
  endGame: { ended: true }
  syncState: { room: RoomPublic; players: PlayerPublic[]; me: MyState }
  setPresence: { online: boolean }
}

export type ActionName = keyof ActionPayloads

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NOT_MEMBER'
  | 'NOT_HOST'
  | 'NOT_ASKER'
  | 'WRONG_PHASE'
  | 'ALREADY_VOTED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'PLAYERS_NOT_READY'
  | 'CONFLICT'
  | 'NETWORK'
  | 'INTERNAL'

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string }
