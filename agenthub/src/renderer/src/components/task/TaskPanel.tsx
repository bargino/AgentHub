import { useState } from 'react'
import { RotateCcw, Loader2, Check, CornerDownRight, ChevronRight, Clock } from 'lucide-react'
import { useAppStore } from '../../store'
import { retryTask } from '../../services/api'
import type { Task, TaskStatus } from '../../types'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { Badge } from '../ui/Badge'
import { useT } from '../../i18n'

function RetryButton({ taskId }: { taskId: string }): React.JSX.Element {
  const tr = useT()
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
      title={error ? tr('task.retryFailed') : tr('task.retry')}
    >
      {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
    </button>
  )
}

const STATUS_BADGE: Record<
  TaskStatus,
  {
    labelKey: string
    variant: 'default' | 'brand' | 'success' | 'warning' | 'error' | 'ghost'
  }
> = {
  pending: { labelKey: 'task.status.pending', variant: 'ghost' },
  running: { labelKey: 'task.status.running', variant: 'brand' },
  waiting_approval: { labelKey: 'task.status.waitingApproval', variant: 'warning' },
  success: { labelKey: 'task.status.success', variant: 'success' },
  failed: { labelKey: 'task.status.failed', variant: 'error' },
  cancelled: { labelKey: 'task.status.cancelled', variant: 'ghost' }
}

function formatTime(value: string): string {
  // 后端 fmt_time 已返回 "HH:MM" 字符串，直接透传；
  // 仅当传入的是可解析的完整时间戳时才格式化（兜底），避免对 "15:42" 再 new Date 解析得到 NaN:NaN
  if (/^\d{1,2}:\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TaskItem({
  task,
  isLast,
  depLabels
}: {
  task: Task
  isLast: boolean
  depLabels: string[]
}): React.JSX.Element {
  const tr = useT()
  const cfg = STATUS_BADGE[task.status]
  const roleColor = getRoleColor(task.agentRole)
  const failed = task.status === 'failed'
  const done = task.status === 'success'
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Boolean(task.result)

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
          className="block rounded-[11px]"
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
        {task.status === 'waiting_approval' && (
          <span
            className="absolute flex items-center justify-center rounded-full"
            style={{
              right: -2,
              bottom: -2,
              width: 14,
              height: 14,
              background: 'var(--color-warning)',
              boxShadow: '0 0 0 2px var(--color-bg-container)'
            }}
          >
            <Clock size={9} color="#fff" strokeWidth={2.5} />
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
          <Badge variant={cfg.variant}>{tr(cfg.labelKey)}</Badge>
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
          {hasDetail && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-0.5 text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <ChevronRight
                size={12}
                style={{
                  transform: expanded ? 'rotate(90deg)' : 'none',
                  transition: 'transform var(--transition-normal)'
                }}
              />
              {tr('task.detail')}
            </button>
          )}
        </div>

        {/* 依赖关系：DAG 上游节点（depends_on 已在后端回填为真实任务标题） */}
        {depLabels.length > 0 && (
          <div
            className="flex items-start gap-1 text-xs"
            style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}
            title={`${tr('task.dependsOn')}: ${depLabels.join(', ')}`}
          >
            <CornerDownRight size={12} className="shrink-0" style={{ marginTop: 2 }} />
            <span className="truncate">{depLabels.join(', ')}</span>
          </div>
        )}

        {/* 任务详情：执行结果 / 失败原因（展开） */}
        {hasDetail && expanded && (
          <pre
            className="text-xs whitespace-pre-wrap break-words rounded-md"
            style={{
              marginTop: 6,
              padding: '8px 10px',
              background: 'var(--color-bg-spotlight)',
              border: '1px solid var(--color-border-light)',
              color: failed ? 'var(--color-error)' : 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {task.result}
          </pre>
        )}
      </div>

      {/* 重试（失败任务常显） */}
      {failed && <RetryButton taskId={task.id} />}
    </div>
  )
}

export function TaskPanel(): React.JSX.Element {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)
  const tasksMap = useAppStore((s) => s.tasks)
  const tasks = (activeId ? tasksMap[activeId] : undefined) ?? []

  const done = tasks.filter((t) => t.status === 'success').length
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  // 依赖 id -> 标题（depends_on 已由后端回填为真实任务 id），供 DAG 关系展示
  const titleById = new Map(tasks.map((t) => [t.id, t.title]))
  const depLabelsOf = (t: Task): string[] =>
    (t.dependsOn ?? []).map((id) => titleById.get(id)).filter((x): x is string => Boolean(x))

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--color-bg-container)' }}
    >
      {/* 进度概览：任务数 + 完成数 */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-light)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('task.title')}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          {done}/{tasks.length}
        </span>
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
            {tr('task.empty')}
          </div>
        ) : (
          tasks.map((t, i) => (
            <TaskItem
              key={t.id}
              task={t}
              isLast={i === tasks.length - 1}
              depLabels={depLabelsOf(t)}
            />
          ))
        )}
      </div>
    </div>
  )
}
