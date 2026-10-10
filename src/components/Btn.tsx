import { Button } from '@tarojs/components'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'yes' | 'no'
  disabled?: boolean
  loading?: boolean
  inline?: boolean
  openType?: 'share'
  className?: string
}

export default function Btn({ children, onClick, variant = 'primary', disabled, loading, inline, openType, className = '' }: Props) {
  const cls = ['btn', `btn--${variant}`, inline ? 'btn--inline' : '', className].filter(Boolean).join(' ')
  return (
    <Button
      className={cls}
      hoverClass="btn--hover"
      disabled={disabled || loading}
      loading={loading}
      openType={openType}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
