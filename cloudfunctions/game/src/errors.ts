import type { ErrorCode } from './protocol'

/** 可預期的業務錯誤：會原樣回傳給前端顯示 */
export class GameError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'GameError'
  }
}

/** 判斷雲資料庫的「_id 重複」錯誤（用來做原子性的防重複提交） */
export function isDuplicateKeyError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { errCode?: number; errMsg?: string; message?: string }
  if (err.errCode === -502001) return true
  const msg = `${err.errMsg ?? ''} ${err.message ?? ''}`
  return /duplicate|E11000|-502001/i.test(msg)
}
