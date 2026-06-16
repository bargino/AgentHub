import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md font-medium w-fit whitespace-nowrap shrink-0 border [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-bg-spotlight)] text-[var(--color-text-secondary)]',
        brand:
          'border-transparent bg-[var(--color-brand-bg)] text-[var(--color-brand)]',
        success:
          'border-transparent bg-[var(--color-success-bg)] text-[var(--color-success)]',
        warning:
          'border-transparent bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
        error:
          'border-transparent bg-[var(--color-error-bg)] text-[var(--color-error)]',
        ghost:
          'border-[var(--color-border)] bg-transparent text-[var(--color-text-tertiary)]',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground border-border'
      },
      size: {
        sm: 'px-1.5 py-0 text-[11px] leading-[16px]',
        md: 'px-2 py-0.5 text-xs leading-[18px]'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'md'
    }
  }
)

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps): React.JSX.Element {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

/** 未读计数 pill：圆形品牌色徽标，>99 显示 99+。 */
export function CountBadge({
  count,
  className,
  ...props
}: React.ComponentProps<'span'> & { count: number }): React.JSX.Element {
  if (!count) return <></>
  return (
    <span
      data-slot="count-badge"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white tabular-nums',
        className
      )}
      style={{ background: 'var(--color-brand)' }}
      {...props}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
