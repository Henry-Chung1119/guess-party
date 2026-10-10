import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { callGame, GameApiError } from '@/services/cloud'
import { watchPlayers, watchRoom } from '@/services/realtime'
import type { MyState, PlayerPublic, RoomPublic } from '@/types/protocol'

export interface RoomState {
  room: RoomPublic | null
  /** 依加入順序（= 出題順序）排列 */
  players: PlayerPublic[]
  me: MyState | null
  loading: boolean
  error: GameApiError | null
  refresh: () => Promise<void>
  patchMe: (patch: Partial<MyState>) => void
  nameOf: (pid: string) => string
}

/**
 * 房間即時狀態：
 * - 公開狀態（room / players）來自資料庫 watch，立即更新；
 * - 私有狀態（me：是否投過票、我的結果）只能由雲函數 syncState 取得，
 *   在進入頁面、回到前景、watch 重連、回合切換時重新同步。
 */
export function useRoom(roomId: string | undefined): RoomState {
  const [room, setRoom] = useState<RoomPublic | null>(null)
  const [players, setPlayers] = useState<PlayerPublic[]>([])
  const [me, setMe] = useState<MyState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<GameApiError | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!roomId) return
    try {
      const s = await callGame('syncState', { roomId })
      if (!alive.current) return
      setRoom(s.room)
      setPlayers(s.players)
      setMe(s.me)
      setError(null)
    } catch (e) {
      if (alive.current && e instanceof GameApiError) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    alive.current = true
    if (!roomId) {
      setLoading(false)
      return
    }
    void refresh()
    const closeRoom = watchRoom(roomId, (r) => r && setRoom(r), refresh)
    const closePlayers = watchPlayers(roomId, setPlayers, refresh)
    return () => {
      alive.current = false
      closeRoom()
      closePlayers()
    }
  }, [roomId, refresh])

  // 回合切換時先在本地重置私有狀態，再向雲端確認，避免新回合短暫顯示「已投票」
  const roundId = room?.round?.id
  const phase = room?.phase
  const lastRound = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!roundId) return
    if (lastRound.current && lastRound.current !== roundId) {
      setMe((m) => (m ? { ...m, hasVoted: false, hasGuessed: false, allCorrect: null, acked: false } : m))
    }
    lastRound.current = roundId
    void refresh()
  }, [roundId, phase, refresh])

  useDidShow(() => {
    void refresh()
  })
  useDidHide(() => {
    if (roomId) void callGame('setPresence', { roomId, online: false }).catch(() => undefined)
  })

  const ordered = useMemo(() => {
    if (!room) return players
    const index = new Map(room.playerOrder.map((p, i) => [p, i]))
    return [...players]
      .filter((p) => index.has(p._id))
      .sort((a, b) => (index.get(a._id) ?? 0) - (index.get(b._id) ?? 0))
  }, [players, room])

  const nameOf = useCallback(
    (pid: string) => ordered.find((p) => p._id === pid)?.nickname ?? '玩家',
    [ordered],
  )

  const patchMe = useCallback((patch: Partial<MyState>) => {
    setMe((m) => (m ? { ...m, ...patch } : m))
  }, [])

  return { room, players: ordered, me, loading, error, refresh, patchMe, nameOf }
}
