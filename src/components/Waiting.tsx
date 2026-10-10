import { Text, View } from '@tarojs/components'

interface Props {
  title: string
  hint?: string
  progress?: { done: number; total: number; label: string }
}

/** 等待其他玩家的畫面：只顯示完成人數，不顯示是誰 */
export default function Waiting({ title, hint, progress }: Props) {
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  return (
    <View className="card card--flat waiting card--pop">
      <Text className="waiting__title">{title}</Text>
      {hint && <Text className="hint">{hint}</Text>}
      <View className="dots">
        <View />
        <View />
        <View />
      </View>
      {progress && (
        <View className="progress">
          <View className="progress__bar">
            <View className="progress__fill" style={{ width: `${pct}%` }} />
          </View>
          <Text className="progress__text">
            {progress.done} / {progress.total} 人{progress.label}
          </Text>
        </View>
      )}
    </View>
  )
}
