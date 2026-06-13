import { useState } from 'react'
import { X, RotateCcw, Loader2, Check } from 'lucide-react'
import { useAppStore } from '../../store'
import { retryTask } from '../../services/api'
import type { Task, TaskStatus } from '../../types'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { Badge } from '../ui/Badge'
import { ResizeHandle } from '../ui/ResizeHandle'

function RetryButton({ taskId }: { taskId: string }): React.JSX.Element {
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState(false)

  const handleRetry = async (): Promise<void> => {
    if (retrying) return
    setRetrying(true)
    setError(false)
    try {
      await retryTask(taskId)
    } catch {
      setError(true)
      setTimeout(() => setError(false), 3000)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={retrying}
      className="shrink-0 flex items-center justify-center rounded-md transition-colors"
      style={{
        width: 28,
        height: 28,
        marginTop: 2,
        color: error ? 'var(--color-warning, #faad14)' : 'var(--color-error, #ff4d4f)',
        opacity: retrying ? 0.5 : 1,
        cursor: retrying ? 'not-allowed' : 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-error-bg, #fff2f0)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
      title={error ? '重试失败，请稍后再试' : '重试'}
    >
      {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
    </button>
  )
}

const STATUS_BADGE: Record<
  TaskStatus,
  {
    label: string
    variant: 'default' | 'brand' | 'success' | 'warning' | 'error' | 'ghost'
  }
> = {
  pending: { label: '等待', variant: 'ghost' },
  running: { label: '运行中', variant: 'brand' },
  waiting_approval: { label: '待审批', variant: 'warning' },
  success: { label: '完成', variant: 'success' },
  failed: { label: '失败', variant: 'error' },
  cancelled: { label: '已取消', variant: 'ghost' }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

function TaskItem({ task, isLast }: { task: Task; isLast: boolean }): React.JSX.Element {
  const cfg = STATUS_BADGE[task.status]
  const roleColor = getRoleColor(task.agentRole)
  const failed = task.status === 'failed'
  const done = task.status === 'success'

  return (
    <div
      className="relative flex items-start gap-3"
      style={{
        padding: '6px 16px',
        background: failed ? 'var(--color-error-bg)' : undefined,
        borderLeft: failed ? '2px solid var(--color-error)' : '2px solid transparent'
      }}
    >
      {/* 时间线连接线：完成路径实线品牌色，未完成虚线灰 */}
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 27,
            top: 38,
            bottom: -8,
            borderLeft: done ? '1.5px solid var(--color-brand)' : '1px dashed var(--color-border)',
            transition: 'border-color var(--transition-slow)'
          }}
        />
      )}

      {/* 节点：Avatar + 角色色圆环；running 光晕扩散；success checkmark 弹入 */}
      <div className="relative shrink-0" style={{ marginTop: 2 }}>
        <span
          className="block rounded-full"
          style={
            {
              padding: 2,
              border: `2px solid ${task.status === 'pending' ? 'var(--color-border)' : roleColor}`,
              '--pulse-color': `${roleColor}55`,
              animation: task.status === 'running' ? 'pulseRing 1.8s ease-out infinite' : undefined,
              transition: 'border-color var(--transition-normal)'
            } as React.CSSProperties
          }
        >
          <Avatar role={task.agentRole} size="sm" />
        </span>
        {task.status === 'running' && (
          <span
            className="absolute flex items-center justify-center rounded-full"
            style={{
              right: -2,
              bottom: -2,
              width: 14,
              height: 14,
              background: 'var(--color-bg-container)',
              boxShadow: '0 0 0 1px var(--color-border-light)'
            }}
          >
            <Loader2 size={10} className="animate-spin" style={{ color: 'var(--color-brand)' }} />
          </span>
        )}
        {done && (
          <span
            className="absolute flex items-center justify-center rounded-full animate-spring-pop"
            style={{
              right: -2,
              bottom: -2,
              width: 14,
              height: 14,
              background: 'var(--color-success)',
              boxShadow: '0 0 0 2px var(--color-bg-container)'
            }}
          >
            <Check size={9} color="#fff" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0" style={{ paddingBottom: isLast ? 0 : 14 }}>
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {task.title}
          </span>
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
        </div>

        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <span className="text-xs" style={{ color: roleColor }}>
            {getRoleLabel(task.agentRole)}
          </span>
          {task.startedAt && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
              {formatTime(task.startedAt)}
            </span>
          )}
        </div>
      </div>

      {/* 重试（失败任务常显） */}
      {failed && <RetryButton taskId={task.id} />}
    </div>
  )
}

export function TaskPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.taskPanelOpen)
  const activeId = useAppStore((s) => s.activeConversationId)
  const tasksMap = useAppStore((s) => s.tasks)
  const toggle = (): void => useAppStore.getState().toggleTaskPanel()
  const tasks = (activeId ? tasksMap[activeId] : undefined) ?? []

  if (!open) return null

  const done = tasks.filter((t) => t.status === 'success').length
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div
      className="relative flex flex-col shrink-0 panel-slide-right"
      style={{
        width: 'var(--right-panel-width)',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      <ResizeHandle />
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            任务进度
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
            {done}/{tasks.length}
          </span>
        </div>
        <button
          onClick={toggle}
          className="flex items-center justify-center rounded-md hover-spotlight"
          style={{ width: 28, height: 28 }}
        >
          <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* 分段进度条：按任务数分段，完成段渐变填充 + 右侧百分比 */}
      {tasks.length > 0 && (
        <div className="shrink-0 flex items-center gap-2.5" style={{ padding: '12px 16px' }}>
          <div className="flex flex-1 gap-0.5">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: 4, background: 'var(--color-border-light)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: t.status === 'success' ? '100%' : t.status === 'running' ? '40%' : 0,
                    background:
                      t.status === 'running' ? 'var(--color-brand)' : 'var(--gradient-brand)',
                    transition: 'width var(--duration-slow) var(--ease-out-quart)'
                  }}
                />
              </div>
            ))}
          </div>
          <span
            className="text-[11px] font-medium tabular-nums shrink-0"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {pct}%
          </span>
        </div>
      )}

      {/* task list with timeline */}
      <div className="flex-1 overflow-y-auto" style={{ paddingTop: 12, paddingBottom: 12 }}>
        {tasks.length === 0 ? (
          <div
            className="flex items-center justify-center text-sm"
            style={{ color: 'var(--color-text-secondary)', paddingTop: 48, paddingBottom: 48 }}
          >
            暂无任务
          </div>
        ) : (
          tasks.map((t, i) => <TaskItem key={t.id} task={t} isLast={i === tasks.length - 1} />)
        )}
      </div>
    </div>
  )
}
