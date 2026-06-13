import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { Avatar } from '../ui/Avatar'
import { getRoleLabel } from '../ui/role'

/** 输入框上方的 Agent 实时状态条：会话运行中时显示哪些 Agent 正在工作。
 *  有 running 任务时逐个列出执行者；无任务（编排决策阶段）显示 Orchestrator 调度中。
 *  空闲时不渲染（零高度，不挤占消息流）。 */
export function AgentStatusBar(): React.JSX.Element | null {
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const tasksMap = useAppStore((s) => s.tasks)

  const conv = conversations.find((c) => c.id === activeId)
  const runningTasks = useMemo(
    () => (activeId ? (tasksMap[activeId] ?? []) : []).filter((t) => t.status === 'running'),
    [activeId, tasksMap]
  )

  if (!activeId || conv?.status !== 'running') return null

  const entries =
    runningTasks.length > 0
      ? runningTasks.map((t) => ({
          key: t.id,
          role: t.agentRole,
          label: getRoleLabel(t.agentRole),
          status: t.title ? `正在：${t.title}` : '工作中…'
        }))
      : [{ key: 'orchestrator', role: 'orchestrator', label: 'Orchestrator', status: '调度中…' }]

  return (
    <div
      className="flex items-center gap-4 px-5 py-1.5 shrink-0 animate-fade-in"
      style={{
        background: 'var(--color-bg-container)',
        borderTop: '1px solid var(--color-border-light)'
      }}
    >
      {entries.map((e) => (
        <div key={e.key} className="flex items-center gap-1.5 min-w-0">
          <Avatar role={e.role} size="xs" />
          <span
            className="text-[11px] font-medium shrink-0"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {e.label}
          </span>
          <span
            className="text-[11px] truncate"
            style={{ color: 'var(--color-text-tertiary)', maxWidth: 220 }}
          >
            {e.status}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ background: 'var(--color-success, #52c41a)' }}
          />
        </div>
      ))}
    </div>
  )
}
