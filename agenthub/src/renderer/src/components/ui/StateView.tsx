import type * as React from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

type StateKind = 'loading' | 'empty' | 'error'

/**
 * 统一的加载 / 空 / 错误三态占位。集中处理「列表/面板还没有内容时该显示什么」，
 * 避免各页面各写一行文字、风格不一（见架构评审 E2）。
 */
export function StateView({
  kind,
  icon: Icon,
  title,
  description,
  action
}: {
  kind: StateKind
  /** empty/error 态的图标；loading 态固定用旋转的 Loader2 */
  icon?: LucideIcon
  title: string
  description?: string
  /** 操作区（如「重试」按钮）；通常仅 error/empty 态提供 */
  action?: React.ReactNode
}): React.JSX.Element {
  const tone = kind === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)'
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center"
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {kind === 'loading' ? (
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-brand)' }} />
      ) : Icon ? (
        <Icon size={28} style={{ color: tone, opacity: 0.8 }} />
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {title}
        </span>
        {description ? (
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {description}
          </span>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
