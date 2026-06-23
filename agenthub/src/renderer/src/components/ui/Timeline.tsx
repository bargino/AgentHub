import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface TimelineItem {
  /** 稳定唯一键。 */
  key: string
  time?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** 节点圆点颜色，默认品牌色。 */
  color?: string
  /** 右侧附加内容（如状态药丸）。 */
  trailing?: React.ReactNode
}

/** 纵向时间线：最近活动 / 事件日志（对齐仪表盘与日志面板设计稿）。 */
export function Timeline({
  items,
  className
}: {
  items: TimelineItem[]
  className?: string
}): React.JSX.Element {
  return (
    <ul data-slot="timeline" className={cn('flex flex-col', className)}>
      {items.map((it, i) => {
        const isLast = i === items.length - 1
        return (
          <li key={it.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden
                className="absolute top-4 bottom-0 left-[5px] w-px"
                style={{ background: 'var(--color-divider)' }}
              />
            ) : null}
            <span
              className="relative z-10 mt-1 size-2.5 shrink-0 rounded-full"
              style={{
                background: it.color ?? 'var(--color-brand)',
                boxShadow: '0 0 0 2px var(--color-bg-container)'
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="min-w-0 truncate"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}
                >
                  {it.title}
                </div>
                {it.trailing}
              </div>
              {it.description ? (
                <div
                  className="mt-0.5"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
                >
                  {it.description}
                </div>
              ) : null}
              {it.time ? (
                <div
                  className="mt-0.5 tabular-nums"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
                >
                  {it.time}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
