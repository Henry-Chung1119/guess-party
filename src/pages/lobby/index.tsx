import { useEffect, useState } from 'react'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import PlayerRow from '@/components/PlayerRow'
import { useRoom } from '@/hooks/useRoom'
import { callGame, toast, toastError } from '@/services/cloud'
import { clearSession, loadNickname } from '@/store/session'
import { MIN_PLAYERS } from '@/types/protocol'
import './index.scss'

export default function Lobby() {
  const { roomId } = useRouter().params
  const { room, players, me, loading, error, nameOf } = useRoom(roomId)
  const [busy, setBusy] = useState(false)

  const isHost = !!room && !!me && room.hostPid === me.pid
  const myRow = players.find((p) => p._id === me?.pid)
  const readyCount = players.filter((p) => p._id === room?.hostPid || p.ready).length
  const canStart = players.length >= MIN_PLAYERS && readyCount === players.length

  useShareAppMessage(() => ({
    title: `${loadNickname() || '朋友'}邀你玩「猜猜看」，房間碼 ${room?.code ?? ''}`,
    path: `/pages/index/index?code=${room?.code ?? ''}`,
  }))

  // 房間狀態改變時換頁
  useEffect(() => {
    if (!room || !roomId) return
    if (room.status === 'playing') void Taro.redirectTo({ url: `/pages/game/index?roomId=${roomId}` })
    if (room.status === 'ended') {
      clearSession()
      toast('房間已關閉')
      setTimeout(() => void Taro.reLaunch({ url: '/pages/index/index' }), 900)
    }
  }, [room?.status, roomId])

  useEffect(() => {
    if (error && (error.code === 'NOT_MEMBER' || error.code === 'ROOM_NOT_FOUND')) {
      clearSession()
      toast(error.message)
      setTimeout(() => void Taro.reLaunch({ url: '/pages/index/index' }), 900)
    }
  }, [error])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const copyCode = () => {
    if (!room) return
    void Taro.setClipboardData({ data: room.code, success: () => toast('已複製房間碼') })
  }

  const toggleReady = () => {
    if (!roomId || !myRow) return
    void run(() => callGame('setReady', { roomId, ready: !myRow.ready }))
  }

  const start = () => {
    if (!roomId) return
    void run(() => callGame('startGame', { roomId }))
  }

  const leave = async () => {
    if (!roomId) return
    const { confirm } = await Taro.showModal({ title: '離開房間？', content: isHost ? '你是房主，離開後會由下一位玩家接手。' : '之後還可以用房間碼再回來。', confirmText: '離開', cancelText: '留下' })
    if (!confirm) return
    await run(async () => {
      await callGame('leaveRoom', { roomId })
      clearSession()
      await Taro.reLaunch({ url: '/pages/index/index' })
    })
  }

  const kick = async (pid: string) => {
    if (!roomId) return
    const { confirm } = await Taro.showModal({ title: `移除 ${nameOf(pid)}？`, content: '對方會被請出房間，之後可以再加入。', confirmText: '移除', cancelText: '取消' })
    if (confirm) void run(() => callGame('kickPlayer', { roomId, targetPid: pid }))
  }

  if (!roomId) return <View className="screen"><Text className="lead">缺少房間資訊</Text></View>
  if (loading && !room) return <View className="screen"><Text className="lead">正在進入房間…</Text></View>
  if (!room || !me) return <View className="screen"><Text className="lead">{error?.message ?? '載入中…'}</Text></View>

  const startLabel = players.length < MIN_PLAYERS ? `還差 ${MIN_PLAYERS - players.length} 人才能開始` : canStart ? '開始遊戲' : `等 ${players.length - readyCount} 人準備`

  return (
    <View className="screen">
      <View className="card code-card card--pop">
        <Text className="field-label">房間碼</Text>
        <Text className="code-card__code" onClick={copyCode}>{room.code}</Text>
        <Text className="code-card__hint">點一下複製。朋友在首頁輸入就能加入。</Text>
        <Btn variant="ghost" openType="share">用微信邀請朋友</Btn>
      </View>

      <View className="card">
        <View className="row--between">
          <Text className="h3">玩家 {players.length} / {room.maxPlayers}</Text>
          <Text className="hint" style={{ marginTop: 0 }}>至少 {MIN_PLAYERS} 人</Text>
        </View>
        <View className="gap" />
        {players.map((p) => (
          <PlayerRow
            key={p._id}
            player={p}
            isHost={p._id === room.hostPid}
            isMe={p._id === me.pid}
            showReady
            right={isHost && p._id !== me.pid ? <View className="kick" onClick={() => void kick(p._id)}>✕</View> : undefined}
          />
        ))}
      </View>

      {isHost ? (
        <Btn onClick={start} disabled={!canStart || busy} loading={busy}>{startLabel}</Btn>
      ) : (
        <Btn variant={myRow?.ready ? 'ghost' : 'primary'} onClick={toggleReady} loading={busy}>
          {myRow?.ready ? '取消準備' : '我準備好了'}
        </Btn>
      )}
      {!isHost && <Text className="hint" style={{ textAlign: 'center', marginTop: 0, marginBottom: 24 }}>等房主開始。玩法：輪流出題、匿名投票，再猜每個人怎麼投。</Text>}
      <Btn variant="danger" onClick={() => void leave()} disabled={busy}>離開房間</Btn>
    </View>
  )
}
