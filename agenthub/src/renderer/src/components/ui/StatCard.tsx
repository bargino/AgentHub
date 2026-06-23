import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface StatCardProps {
  icon?: LucideIcon
  iconColor?: string
  label: string
  value: React.ReactNode
  /** 同比/环比变化，trend 决定颜色（up=绿 / down=红 / flat=灰）。 */
  delta?: { value: string; trend: 'up' | 'down' | 'flat' }
  className?: string
  children?: React.ReactNode
}

/** 仪表盘统计卡：图标 + 数值 + 标签 + 变化量，对齐设计稿统计磁贴。 */
export function StatCard({
  icon: Icon,
  iconColor = 'var(--color-brand)',
  label,
  value,
  delta,
  className,
  children
}: StatCardProps): React.JSX.Element {
  const trendColor =
    delta?.trend === 'up'
      ? 'var(--color-success)'
      : delta?.trend === 'down'
        ? 'var(--color-error)'
        : 'var(--color-text-tertiary)'

  return (
    <div
      data-slot="stat-card"
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-bg-container)] p-4',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
          {label}
        </span>
        {Icon ? (
          <span
            className="flex size-7 items-center justify-center rounded-[var(--radius-md)]"
            style={{
              background: `color-mix(in srgb, ${iconColor} 14%, transparent)`,
              color: iconColor
            }}
          >
            <Icon size={15} />
          </span>
        ) : null}
      </div>
      <div
        className="tabular-nums font-semibold"
        style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-primary)' }}
      >
        {value}
      </div>
      {delta ? (
        <span
          className="tabular-nums"
          style={{ fontSize: 'var(--font-size-xs)', color: trendColor }}
        >
          {delta.value}
        </span>
      ) : null}
      {children}
    </div>
  )
}
