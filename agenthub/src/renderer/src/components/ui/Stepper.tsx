import * as React from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type StepStatus = 'done' | 'active' | 'pending' | 'failed'

export interface Step {
  /** 稳定唯一键。 */
  key: string
  label: string
  description?: string
  status: StepStatus
}

const STEP_COLOR: Record<StepStatus, string> = {
  done: 'var(--color-success)',
  active: 'var(--color-brand)',
  pending: 'var(--color-text-tertiary)',
  failed: 'var(--color-error)'
}

/** 横向流水线步骤条：构建 → 上传 → 部署 → 健康检查 → 完成（对齐部署面板设计稿）。 */
export function Stepper({
  steps,
  className
}: {
  steps: Step[]
  className?: string
}): React.JSX.Element {
  return (
    <ol data-slot="stepper" className={cn('flex items-start', className)}>
      {steps.map((step, i) => {
        const color = STEP_COLOR[step.status]
        const filled = step.status !== 'pending'
        const isLast = i === steps.length - 1
        return (
          <li
            key={step.key}
            className={cn(
              'relative flex flex-col items-center px-1 text-center',
              isLast ? 'flex-none' : 'flex-1'
            )}
          >
            {!isLast ? (
              <span
                aria-hidden
                className="absolute top-3 left-1/2 h-0.5 w-full"
                style={{
                  background:
                    step.status === 'done' ? 'var(--color-success)' : 'var(--color-border)'
                }}
              />
            ) : null}
            <span
              className="relative z-10 flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums"
              style={{
                background: filled ? color : 'var(--color-bg-container)',
                color: filled ? '#fff' : 'var(--color-text-tertiary)',
                border: filled ? 'none' : '1px solid var(--color-border)'
              }}
            >
              {step.status === 'done' ? (
                <Check size={13} />
              ) : step.status === 'failed' ? (
                <X size={13} />
              ) : (
                i + 1
              )}
            </span>
            <span
              className="mt-2"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}
            >
              {step.label}
            </span>
            {step.description ? (
              <span
                className="mt-0.5"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
              >
                {step.description}
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
