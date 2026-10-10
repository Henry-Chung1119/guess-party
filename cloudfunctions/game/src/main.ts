/**
 * 雲函數入口：所有遊戲操作都經由同一個雲函數 `game` 以 action 分派。
 * 身份來源只有 cloud.getWXContext().OPENID，前端無法偽造。
 */
import cloud from 'wx-server-sdk'
import type { Db } from './db'
import { GameError } from './errors'
import { createGameService } from './handlers'
import type { ApiResponse } from './protocol'

// DYNAMIC_CURRENT_ENV：自動使用雲函數目前所在的環境，型別定義較舊故需轉型
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string })

const service = createGameService({
  db: cloud.database() as unknown as Db,
  salt: process.env.PID_SALT,
})

interface GameEvent {
  action?: unknown
  payload?: unknown
}

export async function main(event: GameEvent): Promise<ApiResponse<unknown>> {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, code: 'INTERNAL', message: '無法取得使用者身份' }
  try {
    const data = await service.dispatch(event?.action, event?.payload, OPENID)
    return { ok: true, data }
  } catch (e) {
    if (e instanceof GameError) return { ok: false, code: e.code, message: e.message }
    console.error('[game] unexpected error', event?.action, e)
    return { ok: false, code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' }
  }
}
