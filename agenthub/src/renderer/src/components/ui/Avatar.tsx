import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@renderer/lib/utils'
import { getRoleGradient } from './role'
import { t } from '../../i18n'

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

const FONT_PX: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 15,
  lg: 18
}

const USER_GRADIENT = 'linear-gradient(135deg, #334155 0%, #64748b 100%)'

function avatarGradient(role: string): string {
  return role === 'user' ? USER_GRADIENT : getRoleGradient(role)
}

function monogram(role: string): string {
  if (role === 'user') return t('common.meInitial')
  return role.charAt(0).toUpperCase() || '?'
}

export interface AvatarProps {
  role: AvatarRole
  size?: AvatarSize
  className?: string
}

/** 角色头像：保留 role/size API，底层 Radix Avatar；角色双色渐变 + 白色字标 + 柔和投影（对齐原型）。 */
export function Avatar({ role, size = 'md', className }: AvatarProps): React.JSX.Element {
  const px = SIZE_PX[size]
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-role={role}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] select-none',
        className
      )}
      style={{
        width: px,
        height: px,
        background: avatarGradient(role),
        boxShadow: '0 4px 10px rgba(15, 23, 42, 0.12)'
      }}
    >
      <AvatarPrimitive.Fallback
        data-slot="avatar-fallback"
        delayMs={0}
        className="flex size-full items-center justify-center font-bold text-white"
        style={{ fontSize: FONT_PX[size] }}
      >
        {monogram(role)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
