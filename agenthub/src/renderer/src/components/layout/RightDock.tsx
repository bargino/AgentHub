import { FileDiff, ListTodo, Files, Monitor, FileText, X, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import type { RightTab } from '../../types'
import { ReviewCenter } from '../diff/ReviewCenter'
import { TaskPanel } from '../task/TaskPanel'
import { GitPanel } from '../git/GitPanel'
import { PreviewPanel } from '../preview/PreviewPanel'
import { SpecPanel } from '../spec/SpecPanel'

const TABS: { key: RightTab; icon: LucideIcon; labelKey: string }[] = [
  { key: 'review', icon: FileDiff, labelKey: 'rightDock.review' },
  { key: 'task', icon: ListTodo, labelKey: 'rightDock.task' },
  { key: 'spec', icon: FileText, labelKey: 'rightDock.spec' },
  { key: 'git', icon: Files, labelKey: 'rightDock.git' },
  { key: 'preview', icon: Monitor, labelKey: 'rightDock.preview' }
]

/** 右侧停靠区单实例容器：审查 / 任务 / Git / 预览 共用一处 + tab 切换，消除横向挤压。 */
export function RightDock(): React.JSX.Element | null {
  const tr = useT()
  const rightTab = useAppStore((s) => s.rightTab)
  const pendingCount = useAppStore((s) => s.pendingApprovals.length)
  const setRightTab = useAppStore((s) => s.setRightTab)

  if (!rightTab) return null

  return (
    <div
      className="flex flex-col shrink-0 animate-slide-in-right"
      style={{
        width: 'var(--right-panel-width)',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      {/* tab 条 */}
      <div
        className="flex items-center gap-0.5 px-2 shrink-0"
        style={{ height: 40, borderBottom: '1px solid var(--color-border)' }}
      >
        {TABS.map(({ key, icon: Icon, labelKey }) => {
          const active = rightTab === key
          const badge = key === 'review' ? pendingCount : 0
          return (
            <button
              key={key}
              onClick={() => setRightTab(key)}
              className="relative flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs cursor-pointer transition-colors"
              style={{
                color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                background: active ? 'var(--color-brand-bg)' : 'transparent',
                fontWeight: active ? 600 : 400
              }}
            >
              <Icon size={14} />
              <span>{tr(labelKey)}</span>
              {badge > 0 && (
                <span
                  className="flex items-center justify-center text-[10px] font-semibold tabular-nums rounded-full px-1"
                  style={{
                    minWidth: 16,
                    height: 16,
                    color: '#fff',
                    background: 'var(--color-error)'
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
        <button
          onClick={() => setRightTab(null)}
          className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md ml-auto"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={tr('common.close')}
        >
          <X size={15} />
        </button>
      </div>

      {/* 内容体 */}
      <div className="flex-1 min-h-0">
        {rightTab === 'review' && <ReviewCenter />}
        {rightTab === 'task' && <TaskPanel />}
        {rightTab === 'spec' && <SpecPanel />}
        {rightTab === 'git' && <GitPanel />}
        {rightTab === 'preview' && <PreviewPanel />}
      </div>
    </div>
  )
}
