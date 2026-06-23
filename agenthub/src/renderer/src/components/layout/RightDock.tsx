import { Maximize2, Minimize2, X } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { ConversationOverview } from '../chat/ConversationOverview'
import { TasksPage } from '../pages/TasksPage'
import { DiffPage } from '../pages/DiffPage'
import { PreviewPage } from '../pages/PreviewPage'
import { DeployPage } from '../pages/DeployPage'
import { PlanPanel } from '../plan/PlanPanel'
import { GitPanel } from '../git/GitPanel'
import { PageShellEmbeddedContext } from '../pages/page-shell-context'
import { RIGHT_DOCK_TABS } from './right-dock-tabs'

/** 会话右侧工作区：概览 / 任务 / Diff / 预览 / 部署（+ 计划 / Git）单实例 + tab 切换；
 *  支持展开接管中间区（A2）。任务/Diff/预览/部署 复用完整页面（嵌入态去重会话头）。 */
export function RightDock(): React.JSX.Element | null {
  const tr = useT()
  const rightTab = useAppStore((s) => s.rightTab)
  const rightExpanded = useAppStore((s) => s.rightExpanded)
  const pendingCount = useAppStore((s) => s.pendingApprovals.length)
  const setRightTab = useAppStore((s) => s.setRightTab)
  const setRightExpanded = useAppStore((s) => s.setRightExpanded)

  if (!rightTab) return null

  return (
    <div
      className={
        rightExpanded
          ? 'flex flex-col min-w-0 flex-1'
          : 'flex flex-col shrink-0 animate-slide-in-right'
      }
      style={{
        width: rightExpanded ? undefined : 'var(--right-panel-width)',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      {/* tab 条 */}
      <div
        className="flex items-center gap-0.5 px-2 shrink-0 overflow-x-auto"
        style={{ height: 40, borderBottom: '1px solid var(--color-border)' }}
      >
        {RIGHT_DOCK_TABS.map(({ key, icon: Icon, labelKey }) => {
          const active = rightTab === key
          const badge = key === 'review' ? pendingCount : 0
          const label = tr(labelKey)
          return (
            <button
              key={key}
              onClick={() => setRightTab(key)}
              title={label}
              aria-label={label}
              className="relative flex items-center gap-1.5 px-2 h-7 rounded-md text-xs cursor-pointer transition-colors shrink-0"
              style={{
                color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                background: active ? 'var(--color-brand-bg)' : 'transparent',
                fontWeight: active ? 600 : 400
              }}
            >
              <Icon size={14} className="shrink-0" />
              {active && <span>{label}</span>}
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
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setRightExpanded(!rightExpanded)}
            className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={rightExpanded ? tr('rightDock.collapse') : tr('rightDock.expand')}
          >
            {rightExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={() => setRightTab(null)}
            className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={tr('common.close')}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 内容体：完整页面以嵌入态渲染（去掉重复会话头），概览/计划/Git 为独立面板 */}
      <div className="flex-1 min-h-0 flex flex-col">
        <PageShellEmbeddedContext.Provider value={true}>
          {rightTab === 'overview' && <ConversationOverview />}
          {rightTab === 'task' && <TasksPage />}
          {rightTab === 'review' && <DiffPage />}
          {rightTab === 'preview' && <PreviewPage />}
          {rightTab === 'deploy' && <DeployPage />}
          {rightTab === 'plan' && <PlanPanel />}
          {rightTab === 'git' && <GitPanel />}
        </PageShellEmbeddedContext.Provider>
      </div>
    </div>
  )
}
