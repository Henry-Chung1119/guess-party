import Taro from '@tarojs/taro'
import type { ActionName, ActionPayloads, ActionResults, ApiResponse, ErrorCode } from '@/types/protocol'

export class GameApiError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'GameApiError'
  }
}

/** 呼叫 `game` 雲函數。所有遊戲操作都走這裡，身份由雲端以 openid 判定。 */
export async function callGame<A extends ActionName>(action: A, payload: ActionPayloads[A]): Promise<ActionResults[A]> {
  let res: ApiResponse<ActionResults[A]> | undefined
  try {
    const r = await Taro.cloud.callFunction({ name: 'game', data: { action, payload } })
    res = r.result as ApiResponse<ActionResults[A]> | undefined
  } catch {
    throw new GameApiError('NETWORK', '連線失敗，請檢查網路後再試')
  }
  if (!res || typeof res !== 'object' || !('ok' in res)) {
    throw new GameApiError('INTERNAL', '伺服器回應異常，請確認雲函數已部署')
  }
  if (!res.ok) throw new GameApiError(res.code, res.message)
  return res.data
}

export function toastError(e: unknown): void {
  const title = e instanceof Error && e.message ? e.message : '發生錯誤，請再試一次'
  void Taro.showToast({ title, icon: 'none', duration: 2200 })
}

export function toast(title: string): void {
  void Taro.showToast({ title, icon: 'none', duration: 1500 })
}
