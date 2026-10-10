import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import Waiting from '@/components/Waiting'
import { callGame, GameApiError, toastError } from '@/services/cloud'
import type { MyState, RoundPublic } from '@/types/protocol'

interface Props {
  roomId: string
  round: RoundPublic
  me: MyState
  askerName: string
  onVoted: () => void
}

export default function VotingView({ roomId, round, me, askerName, onVoted }: Props) {
  const [busy, setBusy] = useState<boolean | null>(null)
  const total = round.participants.length
  const canVote = round.participants.includes(me.pid) && !me.hasVoted

  const vote = async (answer: boolean) => {
    if (busy !== null) return
    setBusy(answer)
    try {
      await callGame('submitVote', { roomId, roundId: round.id, answer })
      void Taro.vibrateShort({ type: 'light' })
      onVoted()
    } catch (e) {
      if (e instanceof GameApiError && e.code === 'ALREADY_VOTED') onVoted()
      else toastError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <View className="card question-card card--pop">
        <Text className="question-card__by">{askerName} 問大家</Text>
        <Text className="question-card__text">{round.question}</Text>
      </View>

      {canVote ? (
        <>
          <View className="vote-grid">
            <Btn variant="yes" onClick={() => void vote(true)} loading={busy === true} disabled={busy !== null}>
              是
            </Btn>
            <Btn variant="no" onClick={() => void vote(false)} loading={busy === false} disabled={busy !== null}>
              否
            </Btn>
          </View>
          <Text className="vote-note">匿名投票，送出後不能修改。</Text>
        </>
      ) : (
        <Waiting
          title="已收到你的答案"
          hint="只有你知道自己投了什麼。"
          progress={{ done: round.votedCount, total, label: '已投票' }}
        />
      )}
    </>
  )
}
