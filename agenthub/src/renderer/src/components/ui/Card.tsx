import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/** 通用卡片容器：圆角 + 轻边框 + 容器底色，对齐设计稿面板卡片质感。 */
export function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-bg-container)]',
        className
      )}
      {...props}
    />
  )
}

/** 卡片头部：标题区 + 右侧操作位，左右分布。 */
export function CardHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-center justify-between gap-2 px-4 pt-4 pb-2', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>): React.JSX.Element {
  return (
    <h3
      data-slot="card-title"
      className={cn('font-semibold text-[var(--color-text-primary)]', className)}
      style={{ fontSize: 'var(--font-size-panel)' }}
      {...props}
    />
  )
}

export function CardContent({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />
}
