import { useState } from 'react'
import { ListTodo, Workflow } from 'lucide-react'
import { useT } from '../../i18n'
import { PageShell } from './PageShell'
import { TaskPanel } from '../task/TaskPanel'
import { TaskDag } from '../task/TaskDag'

type TaskView = 'list' | 'graph'

/** 任务页（对齐 ref03）：列表视图（TaskPanel，时间线 + 进度 + 逐任务重试）与
 *  DAG 图视图（TaskDag，按 dependsOn 连边）二选一切换。 */
export function TasksPage(): React.JSX.Element {
  const tr = useT()
  const [view, setView] = useState<TaskView>('list')
  const actions = (
    <div
      className="flex items-center gap-0.5 rounded-lg p-0.5"
      style={{
        background: 'var(--color-bg-spotlight)',
        border: '1px solid var(--color-border-light)'
      }}
    >
      <ViewToggle
        active={view === 'list'}
        onClick={() => setView('list')}
        icon={<ListTodo size={13} />}
        label={tr('task.viewList')}
      />
      <ViewToggle
        active={view === 'graph'}
        onClick={() => setView('graph')}
        icon={<Workflow size={13} />}
        label={tr('task.viewGraph')}
      />
    </div>
  )

  return (
    <PageShell actions={actions}>
      {view === 'list' ? (
        <div className="h-full overflow-auto">
          <TaskPanel />
        </div>
      ) : (
        <div className="h-full">
          <TaskDag />
        </div>
      )}
    </PageShell>
  )
}

function ViewToggle({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--color-bg-container)' : 'transparent',
        color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
        boxShadow: active ? 'var(--shadow-sm)' : undefined
      }}
    >
      {icon}
      {label}
    </button>
  )
}
