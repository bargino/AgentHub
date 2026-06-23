import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@renderer/lib/utils'
import { getRoleIcon, getRoleSolid, getRoleTint, getRoleRing } from './role'

export type AvatarRole =
  | 'orchestrator'
  | 'planner'
  | 'coder'
  | 'reviewer'
  | 'preview'
  | 'deployer'
  | 'user'
  | string

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 44
}

const ICON_PX: Record<AvatarSize, number> = {
  xs: 12,
  sm: 15,
  md: 19,
  lg: 23
}

const RADIUS_PX: Record<AvatarSize, number> = {
  xs: 7,
  sm: 9,
  md: 11,
  lg: 13
}

export interface AvatarProps {
  role: AvatarRole
  size?: AvatarSize
  className?: string
}

/**
 * 角色头像：以「形状」区分人/Agent —— 真人（user）为中性圆形，Agent 为圆角方形徽标；
 * 近中性底 + 角色色图标 + 角色色细环，去「饱和色块」感，随主题自适应。
 */
export function Avatar({ role, size = 'md', className }: AvatarProps): React.JSX.Element {
  const px = SIZE_PX[size]
  const solid = getRoleSolid(role)
  const isHuman = role === 'user'
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-role={role}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden select-none',
        className
      )}
      style={{
        width: px,
        height: px,
        borderRadius: isHuman ? '9999px' : RADIUS_PX[size],
        background: getRoleTint(role),
        boxShadow: `inset 0 0 0 1px ${getRoleRing(role)}`
      }}
    >
      <AvatarPrimitive.Fallback
        data-slot="avatar-fallback"
        delayMs={0}
        className="flex size-full items-center justify-center"
      >
        {React.createElement(getRoleIcon(role), {
          size: ICON_PX[size],
          color: solid,
          strokeWidth: 2,
          absoluteStrokeWidth: true
        })}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
