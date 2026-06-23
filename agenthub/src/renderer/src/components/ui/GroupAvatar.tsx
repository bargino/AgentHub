import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { getRoleIcon, getRoleSolid, getRoleTint, getRoleRing } from './role'

export interface GroupAvatarProps {
  /** 成员角色列表（按 resolveMembers 顺序）。单人=单头像，多人=2×2 拼贴 */
  roles: string[]
  /** 像素尺寸，默认 40 */
  size?: number
  className?: string
}

/** 单角色双色调图标块（群组头像的单元）。 */
function RoleTile({
  role,
  size,
  radius,
  iconRatio
}: {
  role: string
  size: number
  radius: number
  iconRatio: number
}): React.JSX.Element {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: getRoleTint(role),
        boxShadow: `inset 0 0 0 1px ${getRoleRing(role)}`
      }}
    >
      {React.createElement(getRoleIcon(role), {
        size: Math.max(9, Math.round(size * iconRatio)),
        color: getRoleSolid(role),
        strokeWidth: 2,
        absoluteStrokeWidth: true
      })}
    </div>
  )
}

/** 群组头像：单成员渲染双色调图标块，多成员渲染 2×2 拼贴（图标化，去「纯色+字」）。 */
export function GroupAvatar({ roles, size = 40, className }: GroupAvatarProps): React.JSX.Element {
  const list = roles.length > 0 ? roles : ['orchestrator']

  if (list.length === 1) {
    return (
      <div className={className}>
        <RoleTile role={list[0]} size={size} radius={12} iconRatio={0.46} />
      </div>
    )
  }

  const cells = list.slice(0, 4)
  const gap = 2
  const pad = 2
  const cell = (size - pad * 2 - gap) / 2
  return (
    <div
      className={cn('grid', className)}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: '1fr 1fr',
        gap,
        padding: pad,
        borderRadius: 12,
        background: 'var(--color-bg-container)',
        boxShadow: 'inset 0 0 0 1px var(--color-border)'
      }}
    >
      {cells.map((role, i) => (
        <RoleTile key={`${role}-${i}`} role={role} size={cell} radius={5} iconRatio={0.5} />
      ))}
    </div>
  )
}
