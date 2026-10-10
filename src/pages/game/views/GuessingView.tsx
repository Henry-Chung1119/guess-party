import { useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import PlayerRow from '@/components/PlayerRow'
import Waiting from '@/components/Waiting'
import { callGame, GameApiError, toastError } from '@/services/cloud'
import type { MyState, PlayerPublic, RoundPublic } from '@/types/protocol'

interface Props {
  roomId: string
  round: RoundPublic
  me: MyState
  players: PlayerPublic[]
  hostPid: string
  onGuessed: (allCorrect: boolean) => void
  onStale: () => void
}

export default function GuessingView({ roomId, round, me, players, hostPid, onGuessed, onStale }: Props) {
  const [picks, setPicks] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const total = round.participants.length

  // 目標名單直接跟著房間文件走：有人中途離開時會自動縮減
  const targets = useMemo(
    () => players.filter((p) => p._id !== me.pid && round.participants.includes(p._id)),
    [players, me.pid, round.participants],
  )
  const done = targets.every((t) => typeof picks[t._id] === 'boolean')
  const remaining = targets.filter((t) => typeof picks[t._id] !== 'boolean').length

  const submit = async () => {
    if (!done || busy) return
    const guesses: Record<string, boolean> = {}
    for (const t of targets) guesses[t._id] = picks[t._id] as boolean
    setBusy(true)
    try {
      const r = await callGame('submitGuess', { roomId, roundId: round.id, guesses })
      onGuessed(r.allCorrect)
    } catch (e) {
      toastError(e)
      if (e instanceof GameApiError && (e.code === 'INVALID_INPUT' || e.code === 'WRONG_PHASE')) onStale()
    } finally {
      setBusy(false)
    }
  }

  if (me.hasGuessed || !round.participants.includes(me.pid)) {
    return (
      <>
        <View className="card question-card">
          <Text className="question-card__text">{round.question}</Text>
        </View>
        <Waiting title="猜測已送出" hint="結果只有你自己看得到。" progress={{ done: round.guessedCount, total, label: '已完成猜測' }} />
      </>
    )
  }

  return (
    <>
      <View className="card question-card card--pop">
        <Text className="question-card__by">題目</Text>
        <Text className="question-card__text">{round.question}</Text>
      </View>
      <View className="card">
        <Text className="h2">他們各自投了什麼？</Text>
        <Text className="lead">全部猜對才算贏。送出後不能修改。</Text>
        <View className="gap" />
        {targets.map((p) => (
          <PlayerRow
            key={p._id}
            player={p}
            isHost={p._id === hostPid}
            isMe={false}
            right={
              <View className="seg">
                <View
                  className={`seg__opt ${picks[p._id] === true ? 'seg__opt--yes' : ''}`}
                  onClick={() => setPicks((s) => ({ ...s, [p._id]: true }))}
                >
                  是
                </View>
                <View
                  className={`seg__opt ${picks[p._id] === false ? 'seg__opt--no' : ''}`}
                  onClick={() => setPicks((s) => ({ ...s, [p._id]: false }))}
                >
                  否
                </View>
              </View>
            }
          />
        ))}
      </View>
      <Btn onClick={() => void submit()} disabled={!done} loading={busy}>
        {done ? '送出我的猜測' : `還有 ${remaining} 個人沒猜`}
      </Btn>
    </>
  )
}
