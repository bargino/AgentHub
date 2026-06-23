import { useT } from '../../i18n'

type StatusType = 'online' | 'running' | 'idle' | 'error' | 'offline'

interface StatusDotProps {
  status: StatusType
  size?: 'sm' | 'md'
  label?: string
  className?: string
  /** 覆盖状态默认色（仍保留该状态的脉冲与 a11y 标签） */
  color?: string
}

const STATUS_CONFIG: Record<StatusType, { color: string; labelKey: string; pulse: boolean }> = {
  online: { color: 'var(--color-success)', labelKey: 'common.status.online', pulse: false },
  running: { color: 'var(--color-brand)', labelKey: 'common.status.running', pulse: true },
  idle: { color: 'var(--color-warning)', labelKey: 'common.status.idle', pulse: false },
  error: { color: 'var(--color-error)', labelKey: 'common.status.error', pulse: false },
  offline: { color: 'var(--color-text-tertiary)', labelKey: 'common.status.offline', pulse: false }
}

const DOT_SIZE = { sm: 6, md: 8 }

export function StatusDot({
  status,
  size = 'sm',
  label,
  className = '',
  color
}: StatusDotProps): React.JSX.Element {
  const tr = useT()
  const cfg = STATUS_CONFIG[status]
  const dotColor = color ?? cfg.color
  const d = DOT_SIZE[size]
  // 文本替代：状态不只靠颜色传达。无可见文字时给圆点加 role/aria-label/title；
  // 有可见文字时圆点设为装饰（aria-hidden），由文字承载语义。running 仍用脉冲作非颜色线索。
  const statusText = tr(cfg.labelKey)

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={cfg.pulse ? 'animate-pulse-soft' : ''}
        title={label ?? statusText}
        role={label === undefined ? 'img' : undefined}
        aria-label={label === undefined ? statusText : undefined}
        aria-hidden={label === undefined ? undefined : true}
        style={{
          width: d,
          height: d,
          borderRadius: '50%',
          background: dotColor,
          boxShadow: `0 0 0 2px ${dotColor}22`,
          flexShrink: 0
        }}
      />
      {label !== undefined ? (
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {label}
        </span>
      ) : null}
    </span>
  )
}
