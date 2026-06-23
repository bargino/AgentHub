import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const pillVariants = cva(
  'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--color-bg-spotlight)] text-[var(--color-text-secondary)]',
        brand: 'bg-[var(--color-brand-bg)] text-[var(--color-brand)]',
        success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
        warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
        error: 'bg-[var(--color-error-bg)] text-[var(--color-error)]'
      }
    },
    defaultVariants: { tone: 'neutral' }
  }
)

const TONE_DOT: Record<NonNullable<VariantProps<typeof pillVariants>['tone']>, string> = {
  neutral: 'var(--color-text-tertiary)',
  brand: 'var(--color-brand)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)'
}

export interface StatusPillProps
  extends React.ComponentProps<'span'>, VariantProps<typeof pillVariants> {
  /** 是否显示前导状态圆点，默认显示。 */
  dot?: boolean
}

/** 语义状态药丸：进行中 / 完成 / 失败 / 等待 / 高危 等，颜色由 tone 决定。 */
export function StatusPill({
  className,
  tone,
  dot = true,
  children,
  ...props
}: StatusPillProps): React.JSX.Element {
  return (
    <span data-slot="status-pill" className={cn(pillVariants({ tone }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: TONE_DOT[tone ?? 'neutral'] }}
        />
      ) : null}
      {children}
    </span>
  )
}
