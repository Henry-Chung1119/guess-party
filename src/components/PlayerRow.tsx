import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'
import type { PlayerPublic } from '@/types/protocol'
import Avatar from './Avatar'

interface Props {
  player: PlayerPublic
  isHost: boolean
  isMe: boolean
  showReady?: boolean
  right?: ReactNode
}

export default function PlayerRow({ player, isHost, isMe, showReady, right }: Props) {
  return (
    <View className="player">
      <Avatar pid={player._id} />
      <View className="player__body">
        <Text className="player__name">{player.nickname}</Text>
        <View className="player__meta">
          {isMe && <Text className="tag tag--me">你</Text>}
          {isHost && <Text className="tag tag--host">房主</Text>}
          {showReady && !isHost && (player.ready ? <Text className="tag tag--ready">準備好了</Text> : <Text className="tag tag--wait">還沒準備</Text>)}
          {!player.online && <Text className="tag tag--offline">離線</Text>}
        </View>
      </View>
      {right}
    </View>
  )
}
