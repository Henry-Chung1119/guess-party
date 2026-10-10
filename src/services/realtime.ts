/**
 * 即時同步：以雲資料庫 watch 監聽房間文件與玩家集合。
 * 這兩個集合在資料庫權限中設定為「所有使用者可讀、僅雲函數可寫」，
 * votes / guesses 則完全不開放前端讀取。
 */
import Taro from '@tarojs/taro'
import type { PlayerPublic, RoomPublic } from '@/types/protocol'

interface Snapshot {
  docs: unknown[]
}
interface Watcher {
  close(): unknown
}
interface WatchTarget {
  watch(opts: { onChange: (s: Snapshot) => void; onError: (e: unknown) => void }): Watcher
}
interface MiniDb {
  collection(name: string): {
    doc(id: string): WatchTarget
    where(q: Record<string, unknown>): WatchTarget
  }
}

const getDb = (): MiniDb => Taro.cloud.database() as unknown as MiniDb

/**
 * 建立會自動重連的 watcher。斷線時以指數退避重試，重連成功後呼叫 onReconnect
 * 讓頁面補一次 syncState，避免遺漏斷線期間的變化。
 */
function watchWithRetry(
  make: (db: MiniDb) => WatchTarget,
  onDocs: (docs: unknown[]) => void,
  onReconnect: () => void,
): () => void {
  let closed = false
  let watcher: Watcher | null = null
  let retries = 0

  const start = (isRetry: boolean) => {
    if (closed) return
    watcher = make(getDb()).watch({
      onChange: (snapshot) => {
        retries = 0
        onDocs(snapshot.docs ?? [])
      },
      onError: () => {
        if (closed) return
        watcher = null
        const delay = Math.min(1000 * 2 ** retries, 8000)
        retries += 1
        setTimeout(() => start(true), delay)
      },
    })
    if (isRetry) onReconnect()
  }
  start(false)

  return () => {
    closed = true
    try {
      watcher?.close()
    } catch {
      /* ignore */
    }
  }
}

export const watchRoom = (roomId: string, cb: (room: RoomPublic | null) => void, onReconnect: () => void) =>
  watchWithRetry(
    (db) => db.collection('rooms').doc(roomId),
    (docs) => cb((docs[0] as RoomPublic | undefined) ?? null),
    onReconnect,
  )

export const watchPlayers = (roomId: string, cb: (players: PlayerPublic[]) => void, onReconnect: () => void) =>
  watchWithRetry(
    (db) => db.collection('players').where({ roomId }),
    (docs) => cb(docs as PlayerPublic[]),
    onReconnect,
  )
