import type { AgentRole } from '../../types'
import { Cpu, Map, Code2, SearchCheck, Eye, Rocket, Bot, User, type LucideIcon } from 'lucide-react'

export interface RoleVisual {
  icon: LucideIcon
  color: string
  label: string
}

export const ROLE_CONFIG: Record<AgentRole, RoleVisual> = {
  orchestrator: { icon: Cpu, color: 'var(--color-role-orchestrator)', label: 'Orchestrator' },
  planner: { icon: Map, color: 'var(--color-role-planner)', label: 'Planner' },
  coder: { icon: Code2, color: 'var(--color-role-coder)', label: 'Coder' },
  reviewer: { icon: SearchCheck, color: 'var(--color-role-reviewer)', label: 'Reviewer' },
  preview: { icon: Eye, color: 'var(--color-role-preview)', label: 'Preview' },
  deployer: { icon: Rocket, color: 'var(--color-role-deployer)', label: 'Deployer' }
}

// 自定义角色的回退视觉：颜色按角色名哈希从调色板稳定取色
const CUSTOM_ROLE_PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#f97316'
]

export function customRoleConfig(role: string): RoleVisual {
  let hash = 0
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) | 0
  const color = CUSTOM_ROLE_PALETTE[Math.abs(hash) % CUSTOM_ROLE_PALETTE.length]
  return { icon: Bot, color, label: role }
}

export function getRoleColor(role: AgentRole): string {
  return ROLE_CONFIG[role]?.color ?? customRoleConfig(role).color
}

// 角色双色渐变（取自原型 .grad-* 配色），用于头像/群头像，区别于扁平色块
const ROLE_GRADIENTS: Record<string, string> = {
  orchestrator: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
  planner: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  coder: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  reviewer: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)',
  preview: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)',
  deployer: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)'
}

export function getRoleGradient(role: AgentRole): string {
  if (ROLE_GRADIENTS[role]) return ROLE_GRADIENTS[role]
  const c = customRoleConfig(role).color
  return `linear-gradient(135deg, ${c} 0%, color-mix(in srgb, ${c} 68%, #000 18%) 100%)`
}

export function getRoleLabel(role: AgentRole): string {
  return ROLE_CONFIG[role]?.label ?? role
}

/** 角色专属图标：用于头像图标化（取代首字母）。user/未知回退到 User/Bot。 */
export function getRoleIcon(role: string): LucideIcon {
  if (role === 'user') return User
  return ROLE_CONFIG[role as AgentRole]?.icon ?? customRoleConfig(role).icon
}

/** 头像「双色调」前景色：角色主色；user 用中性 slate，随主题自适应。 */
export function getRoleSolid(role: string): string {
  if (role === 'user') return 'var(--color-avatar-user)'
  return getRoleColor(role)
}

/** 头像底色：仅极淡角色色混入卡片底（≈8%），近中性，去「饱和色块」感（方向二·暖中性）。 */
export function getRoleTint(role: string): string {
  const c = getRoleSolid(role)
  return `color-mix(in srgb, ${c} 8%, var(--color-bg-container))`
}

/** 头像描边：角色主色低透明细环，作为唯一的角色识别点（喧宾不夺主）。 */
export function getRoleRing(role: string): string {
  const c = getRoleSolid(role)
  return `color-mix(in srgb, ${c} 26%, transparent)`
}
