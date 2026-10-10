import { View } from '@tarojs/components'

const EMOJIS = ['🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐨', '🦁', '🐧', '🐳', '🦋', '🐝', '🐰', '🦉', '🐷', '🦖']
const COLORS = ['#ffc53d', '#ffd9a8', '#b8ead3', '#ffc7c7', '#d8ccff', '#bfe3ff', '#f8e39a', '#ffe0f0']

/** 由 pid 決定的頭像：同一位玩家在所有人的畫面上都長一樣，且不需要上傳頭像 */
export default function Avatar({ pid, small }: { pid: string; small?: boolean }) {
  const n = parseInt(pid.slice(0, 6), 16) || 0
  const emoji = EMOJIS[n % EMOJIS.length]
  const bg = COLORS[(n >> 4) % COLORS.length]
  return (
    <View className={`avatar ${small ? 'avatar--sm' : ''}`} style={{ background: bg }}>
      {emoji}
    </View>
  )
}
