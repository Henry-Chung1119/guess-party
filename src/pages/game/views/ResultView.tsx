import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import Waiting from '@/components/Waiting'
import { callGame, toastError } from '@/services/cloud'
import type { MyState, RoundPublic } from '@/types/protocol'

interface Props {
  roomId: string
  round: RoundPublic
  me: MyState
  isHost: boolean
  onAcked: () => void
}

export default function ResultView({ roomId, round, me, isHost, onAcked }: Props) {
  const [busy, setBusy] = useState<'ack' | 'next' | null>(null)
  const total = round.participants.length
  const participant = round.participants.includes(me.pid)
  const win = me.allCorrect === true

  const ack = async () => {
    setBusy('ack')
    try {
      await callGame('ackResult', { roomId, roundId: round.id })
      onAcked()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const forceNext = async () => {
    setBusy('next')
    try {
      await callGame('nextRound', { roomId })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {participant && me.allCorrect !== null ? (
        <View className={`card result card--pop ${win ? 'result--win' : 'result--lose'}`}>
          <Text className="result__emoji">{win ? '🎉' : '🫣'}</Text>
          <Text className="result__title">{win ? '恭喜！你全部猜對了！' : '很可惜，這次沒有全部猜對。'}</Text>
          <Text className="result__sub">{win ? '你看穿了每一個人。' : '沒有人會知道你錯在哪裡，也沒有人知道誰投了什麼。'}</Text>
        </View>
      ) : (
        <View className="card card--flat result">
          <Text className="result__title">這回合你沒有參與</Text>
        </View>
      )}

      {me.acked || !participant ? (
        <Waiting title="等其他人看完結果" progress={{ done: round.ackCount, total, label: '準備好下一回合' }} />
      ) : (
        <Btn onClick={() => void ack()} loading={busy === 'ack'} disabled={busy !== null}>
          看完了，下一回合
        </Btn>
      )}

      {isHost && (
        <Btn variant="ghost" onClick={() => void forceNext()} loading={busy === 'next'} disabled={busy !== null}>
          房主：不等了，直接開始下一回合
        </Btn>
      )}
    </>
  )
}
