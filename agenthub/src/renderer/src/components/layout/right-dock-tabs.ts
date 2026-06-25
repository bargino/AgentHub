import {
  LayoutDashboard,
  ListTodo,
  FileDiff,
  Monitor,
  Send,
  FileText,
  Files,
  type LucideIcon
} from 'lucide-react'
import type { RightTab } from '../../types'

/** 右侧工作区 tab 单一事实源：RightDock（展开态 tab 条）与 RightRail（收起态图标轨）共用，
 *  保证两处入口的图标 / 文案 / 顺序始终一致。 */
export const RIGHT_DOCK_TABS: { key: RightTab; icon: LucideIcon; labelKey: string }[] = [
  { key: 'overview', icon: LayoutDashboard, labelKey: 'tab.overview' },
  { key: 'task', icon: ListTodo, labelKey: 'nav.tasks' },
  { key: 'review', icon: FileDiff, labelKey: 'nav.diff' },
  { key: 'preview', icon: Monitor, labelKey: 'nav.preview' },
  { key: 'deploy', icon: Send, labelKey: 'nav.deploy' },
  { key: 'spec', icon: FileText, labelKey: 'rightDock.spec' },
  { key: 'git', icon: Files, labelKey: 'rightDock.git' }
]
