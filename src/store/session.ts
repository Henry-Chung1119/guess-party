import Taro from '@tarojs/taro'

const SESSION_KEY = 'guess-party:session'
const NICK_KEY = 'guess-party:nickname'

/** 目前所在房間，用於 App 被關閉後回到同一局 */
export interface Session {
  roomId: string
  code: string
  pid: string
}

export function saveSession(s: Session): void {
  Taro.setStorageSync(SESSION_KEY, s)
}

export function loadSession(): Session | null {
  const v: unknown = Taro.getStorageSync(SESSION_KEY)
  if (v && typeof v === 'object' && 'roomId' in v && 'pid' in v) return v as Session
  return null
}

export function clearSession(): void {
  Taro.removeStorageSync(SESSION_KEY)
}

export function saveNickname(n: string): void {
  Taro.setStorageSync(NICK_KEY, n)
}

export function loadNickname(): string {
  const v: unknown = Taro.getStorageSync(NICK_KEY)
  return typeof v === 'string' ? v : ''
}
