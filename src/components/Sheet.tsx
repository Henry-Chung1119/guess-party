import { View } from '@tarojs/components'
import type { ReactNode } from 'react'

/** 由底部滑出的面板 */
export default function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      <View className="sheet-mask" onClick={onClose} />
      <View className="sheet" catchMove>
        {children}
      </View>
    </>
  )
}
