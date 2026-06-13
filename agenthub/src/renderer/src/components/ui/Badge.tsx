interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'brand' | 'success' | 'warning' | 'error' | 'ghost'
  size?: 'sm' | 'md'
  className?: string
}

const VARIANT_STYLES: Record<string, { bg: string; text: string; border?: string }> = {
  default: { bg: 'var(--color-bg-spotlight)', text: 'var(--color-text-secondary)' },
  brand: { bg: 'var(--color-brand-bg)', text: 'var(--color-brand)' },
  success: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)' },
  error: { bg: 'var(--color-error-bg)', text: 'var(--color-error)' },
  ghost: { bg: 'transparent', text: 'var(--color-text-secondary)', border: 'var(--color-border)' }
}

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  className = ''
}: BadgeProps): React.JSX.Element {
  const style = VARIANT_STYLES[variant]
  const padding = size === 'sm' ? '1px 6px' : '2px 8px'
  const fontSize = size === 'sm' ? 'var(--font-size-xs)' : 'var(--font-size-sm)'

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full whitespace-nowrap ${className}`}
      style={{
        padding,
        fontSize,
        lineHeight: '18px',
        background: style.bg,
        color: style.text,
        border: style.border ? `1px solid ${style.border}` : 'none'
      }}
    >
      {children}
    </span>
  )
}

interface CountBadgeProps {
  count: number
  className?: string
}

export function CountBadge({ count, className = '' }: CountBadgeProps): React.JSX.Element | null {
  if (count <= 0) return null
  const display = count > 99 ? '99+' : String(count)

  return (
    <span
      className={`inline-flex items-center justify-center font-medium text-white rounded-full ${className}`}
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        fontSize: 'var(--font-size-xs)',
        lineHeight: '18px',
        background: 'var(--color-error)'
      }}
    >
      {display}
    </span>
  )
}
