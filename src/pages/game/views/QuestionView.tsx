import { useMemo, useState } from 'react'
import { Text, Textarea, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import Waiting from '@/components/Waiting'
import { callGame, toastError } from '@/services/cloud'
import { MAX_QUESTION, type RoundPublic } from '@/types/protocol'

const IDEAS = [
  '你曾經喜歡過現場的某個人嗎？',
  '你今天有說過謊嗎？',
  '你曾經偷看過別人的手機嗎？',
  '你覺得自己是在場最會玩遊戲的人嗎？',
  '你會在洗澡的時候唱歌嗎？',
  '你曾經假裝生病請假嗎？',
  '你相信一見鍾情嗎？',
  '你曾經把朋友的秘密說出去嗎？',
  '你會偷偷看前任的社群嗎？',
  '你曾經在電影院哭過嗎？',
  '你有一個現場沒人知道的秘密嗎？',
  '你覺得在場有人在暗戀你嗎？',
]

interface Props {
  roomId: string
  round: RoundPublic
  myPid: string
  askerName: string
}

export default function QuestionView({ roomId, round, myPid, askerName }: Props) {
  const isAsker = round.askerPid === myPid
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(() => Math.floor(Math.random() * 4))
  const ideas = useMemo(() => [0, 1, 2].map((i) => IDEAS[(page * 3 + i) % IDEAS.length]!), [page])

  const submit = async () => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      await callGame('submitQuestion', { roomId, question: q })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  if (!isAsker) {
    return <Waiting title={`${askerName} 正在出題`} hint="想好怎麼回答了嗎？等一下所有人都要匿名投票。" />
  }

  return (
    <View className="card card--pop">
      <Text className="h2">這回合換你出題</Text>
      <Text className="lead">出一題用「是」或「否」就能回答的問題。</Text>
      <View className="gap" />
      <Textarea
        className="textarea"
        placeholderClass="placeholder"
        placeholder="例如：你曾經喜歡過現場的某個人嗎？"
        maxlength={MAX_QUESTION}
        value={text}
        autoHeight
        onInput={(e) => setText(e.detail.value)}
      />
      <View className="chips">
        {ideas.map((s) => (
          <View key={s} className="chip" onClick={() => setText(s)}>
            {s}
          </View>
        ))}
        <View className="chip chip--ghost" onClick={() => setPage((p) => p + 1)}>
          換一批靈感
        </View>
      </View>
      <Btn onClick={() => void submit()} loading={busy} disabled={!text.trim()}>
        公布題目
      </Btn>
      <Text className="hint" style={{ marginTop: 0 }}>公布後不能修改。你自己也要投票和猜。</Text>
    </View>
  )
}
