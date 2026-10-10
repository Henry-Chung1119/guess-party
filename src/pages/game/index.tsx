import { useEffect, useState } from 'react'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import PlayerRow from '@/components/PlayerRow'
import Sheet from '@/components/Sheet'
import { useRoom } from '@/hooks/useRoom'
import { callGame, toast, toastError } from '@/services/cloud'
import { clearSession, loadNickname } from '@/store/session'
import type { Phase, RoomPublic } from '@/types/protocol'
import GuessingView from './views/GuessingView'
import QuestionView from './views/QuestionView'
import ResultView from './views/ResultView'
import VotingView from './views/VotingView'
import './index.scss'

const PHASE_LABEL: Record<Phase, string> = {
  lobby: '大廳',
  question: '出題中',
  voting: '匿名投票',
  guessing: '猜測中',
  result: '結算',
  ended: '已結束',
}

export default function Game() {
  const { roomId } = useRouter().params
  const { room, players, me, loading, error, refresh, patchMe, nameOf } = useRoom(roomId)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)

  useShareAppMessage(() => ({
    title: `${loadNickname() || '朋友'}正在玩「猜猜看」，房間碼 ${room?.code ?? ''}`,
    path: `/pages/index/index?code=${room?.code ?? ''}`,
  }))

  useEffect(() => {
    if (room?.status === 'lobby' && roomId) void Taro.redirectTo({ url: `/pages/lobby/index?roomId=${roomId}` })
  }, [room?.status, roomId])

  useEffect(() => {
    if (error && (error.code === 'NOT_MEMBER' || error.code === 'ROOM_NOT_FOUND')) {
      clearSession()
      toast(error.message)
      setTimeout(() => void Taro.reLaunch({ url: '/pages/index/index' }), 900)
    }
  }, [error])

  const goHome = () => {
    clearSession()
    void Taro.reLaunch({ url: '/pages/index/index' })
  }

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

  const leave = async () => {
    if (!roomId) return
    const { confirm } = await Taro.showModal({ title: '離開這一局？', content: '離開後遊戲會繼續進行，你的位置會從名單中移除。', confirmText: '離開', cancelText: '留下' })
    if (!confirm) return
    setSheet(false)
    await run(async () => {
      await callGame('leaveRoom', { roomId })
      goHome()
    })
  }

  const endGame = async () => {
    if (!roomId) return
    const { confirm } = await Taro.showModal({ title: '結束遊戲？', content: '所有人都會回到首頁。', confirmText: '結束', cancelText: '取消' })
    if (!confirm) return
    setSheet(false)
    await run(() => callGame('endGame', { roomId }))
  }

  const kick = async (pid: string) => {
    if (!roomId) return
    const { confirm } = await Taro.showModal({ title: `移除 ${nameOf(pid)}？`, content: '通常用在對方已經離線、卡住大家的時候。', confirmText: '移除', cancelText: '取消' })
    if (confirm) await run(() => callGame('kickPlayer', { roomId, targetPid: pid }))
  }

  if (!roomId) return <View className="screen"><Text className="lead">缺少房間資訊</Text></View>
  if (loading && !room) return <View className="screen"><Text className="lead">正在同步遊戲狀態…</Text></View>
  if (!room || !me) return <View className="screen"><Text className="lead">{error?.message ?? '載入中…'}</Text></View>

  if (room.status === 'ended') return <Ended room={room} onHome={goHome} />

  const round = room.round
  const isHost = room.hostPid === me.pid

  return (
    <View className="screen">
      <View className="game-head">
        <View>
          <Text className="game-head__round">第 {room.roundNo} 回合</Text>
          <Text className="game-head__phase">{PHASE_LABEL[room.phase]}</Text>
        </View>
        <View className="game-head__players" onClick={() => setSheet(true)}>
          <Text>👥</Text>
          <Text>{room.playerCount}</Text>
        </View>
      </View>

      {round && room.phase === 'question' && (
        <QuestionView roomId={roomId} round={round} myPid={me.pid} askerName={nameOf(round.askerPid)} />
      )}
      {round && room.phase === 'voting' && (
        <VotingView roomId={roomId} round={round} me={me} askerName={nameOf(round.askerPid)} onVoted={() => patchMe({ hasVoted: true })} />
      )}
      {round && room.phase === 'guessing' && (
        <GuessingView
          roomId={roomId}
          round={round}
          me={me}
          players={players}
          hostPid={room.hostPid}
          onGuessed={(allCorrect) => patchMe({ hasGuessed: true, allCorrect })}
          onStale={() => void refresh()}
        />
      )}
      {round && room.phase === 'result' && (
        <ResultView roomId={roomId} round={round} me={me} isHost={isHost} onAcked={() => patchMe({ acked: true })} />
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(false)}>
          <View className="row--between">
            <Text className="h3">這一局的玩家</Text>
            <Text className="hint" style={{ marginTop: 0 }}>房間碼 {room.code}</Text>
          </View>
          <View className="gap" />
          {players.map((p) => (
            <PlayerRow
              key={p._id}
              player={p}
              isHost={p._id === room.hostPid}
              isMe={p._id === me.pid}
              right={
                isHost && p._id !== me.pid ? (
                  <Btn inline variant="ghost" onClick={() => void kick(p._id)} disabled={busy}>移除</Btn>
                ) : undefined
              }
            />
          ))}
          <View className="gap" />
          {isHost && <Btn variant="ghost" onClick={() => void endGame()} disabled={busy}>結束遊戲</Btn>}
          <Btn variant="danger" onClick={() => void leave()} disabled={busy}>離開這一局</Btn>
        </Sheet>
      )}
    </View>
  )
}

function Ended({ room, onHome }: { room: RoomPublic; onHome: () => void }) {
  return (
    <View className="screen ended">
      <View className="card card--pop">
        <Text className="ended__big">{room.roundNo}</Text>
        <Text className="h2">回合，遊戲結束</Text>
        <Text className="lead">謝謝大家。誰投了什麼，永遠是秘密。</Text>
      </View>
      <Btn onClick={onHome}>回到首頁</Btn>
    </View>
  )
}
