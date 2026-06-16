import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { getRoleGradient } from './role'
import { t } from '../../i18n'

function monogram(role: string): string {
  if (role === 'user') return t('common.meInitial')
  return role.charAt(0).toUpperCase() || '?'
}

export interface GroupAvatarProps {
  /** 成员角色列表（按 resolveMembers 顺序）。单人=单头像，多人=2×2 拼贴 */
  roles: string[]
  /** 像素尺寸，默认 40 */
  size?: number
  className?: string
}

/** 群组头像：单成员渲染渐变方头像，多成员渲染微信式 2×2 拼贴（对齐原型 .avatar-stack）。 */
export function GroupAvatar({ roles, size = 40, className }: GroupAvatarProps): React.JSX.Element {
  const list = roles.length > 0 ? roles : ['orchestrator']

  if (list.length === 1) {
    return (
      <div
        className={cn('flex items-center justify-center font-bold text-white', className)}
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          background: getRoleGradient(list[0]),
          fontSize: Math.round(size * 0.4),
          boxShadow: '0 4px 10px rgba(15, 23, 42, 0.12)'
        }}
      >
        {monogram(list[0])}
      </div>
    )
  }

  const cells = list.slice(0, 4)
  return (
    <div
      className={cn('grid', className)}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: '1fr 1fr',
        gap: 2,
        padding: 2,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--color-border-light)',
        boxShadow: '0 4px 10px rgba(15, 23, 42, 0.10)'
      }}
    >
      {cells.map((role, i) => (
        <div
          key={`${role}-${i}`}
          className="flex items-center justify-center font-bold text-white"
          style={{
            borderRadius: 5,
            background: getRoleGradient(role),
            fontSize: Math.max(8, Math.round(size * 0.22))
          }}
        >
          {monogram(role)}
        </div>
      ))}
    </div>
  )
}
