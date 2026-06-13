import type { AgentRole } from '../../types'
import { User } from 'lucide-react'
import { ROLE_CONFIG, customRoleConfig } from './role'

interface AvatarProps {
  role?: AgentRole
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP = {
  xs: { box: 20, icon: 11 },
  sm: { box: 28, icon: 14 },
  md: { box: 36, icon: 18 },
  lg: { box: 44, icon: 22 }
}

export function Avatar({ role, size = 'md', className = '' }: AvatarProps): React.JSX.Element {
  const s = SIZE_MAP[size]

  if (!role) {
    return (
      <div
        className={`flex items-center justify-center shrink-0 rounded-full ${className}`}
        style={{
          width: s.box,
          height: s.box,
          background: 'var(--color-bg-spotlight)',
          border: '1px solid var(--color-border-light)'
        }}
      >
        <User size={s.icon} color="var(--color-text-secondary)" />
      </div>
    )
  }

  const cfg = ROLE_CONFIG[role] ?? customRoleConfig(role)
  const Icon = cfg.icon

  return (
    <div
      className={`flex items-center justify-center shrink-0 rounded-full ${className}`}
      style={{
        width: s.box,
        height: s.box,
        background: cfg.color,
        boxShadow: `0 2px 6px ${cfg.color}33`
      }}
      title={cfg.label}
    >
      <Icon size={s.icon} color="#fff" strokeWidth={2} />
    </div>
  )
}
