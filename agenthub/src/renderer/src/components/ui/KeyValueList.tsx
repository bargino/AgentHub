import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface KeyValueItem {
  /** 稳定唯一键，用于列表渲染。 */
  key: string
  label: React.ReactNode
  value: React.ReactNode
}

/** 键值明细列表：用于右侧详情面板（任务状态 / 优先级 / 创建时间 等）。 */
export function KeyValueList({
  items,
  className
}: {
  items: KeyValueItem[]
  className?: string
}): React.JSX.Element {
  return (
    <dl data-slot="key-value-list" className={cn('flex flex-col', className)}>
      {items.map((it) => (
        <div
          key={it.key}
          className="flex items-center justify-between gap-3 border-b border-[var(--color-divider)] py-2 last:border-b-0"
        >
          <dt
            className="shrink-0"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}
          >
            {it.label}
          </dt>
          <dd
            className="min-w-0 truncate text-right"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
