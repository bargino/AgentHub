type StatusType = 'online' | 'running' | 'idle' | 'error' | 'offline'

interface StatusDotProps {
  status: StatusType
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

const STATUS_CONFIG: Record<StatusType, { color: string; label: string; pulse: boolean }> = {
  online: { color: 'var(--color-success)', label: '在线', pulse: false },
  running: { color: 'var(--color-brand)', label: '运行中', pulse: true },
  idle: { color: 'var(--color-warning)', label: '空闲', pulse: false },
  error: { color: 'var(--color-error)', label: '错误', pulse: false },
  offline: { color: 'var(--color-text-tertiary)', label: '离线', pulse: false }
}

const DOT_SIZE = { sm: 6, md: 8 }

export function StatusDot({
  status,
  size = 'sm',
  label,
  className = ''
}: StatusDotProps): React.JSX.Element {
  const cfg = STATUS_CONFIG[status]
  const d = DOT_SIZE[size]

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={cfg.pulse ? 'animate-pulse-soft' : ''}
        style={{
          width: d,
          height: d,
          borderRadius: '50%',
          background: cfg.color,
          boxShadow: `0 0 0 2px ${cfg.color}22`,
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
