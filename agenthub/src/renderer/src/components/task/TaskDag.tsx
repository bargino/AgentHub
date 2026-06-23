import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps
} from '@xyflow/react'
import Dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../../store'
import type { Task, TaskStatus } from '../../types'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { useT } from '../../i18n'

const NODE_W = 210
const NODE_H = 58

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'var(--color-text-tertiary)',
  running: 'var(--color-brand)',
  waiting_approval: 'var(--color-warning)',
  success: 'var(--color-success)',
  failed: 'var(--color-error)',
  cancelled: 'var(--color-text-tertiary)'
}

const STATUS_KEY: Record<TaskStatus, string> = {
  pending: 'task.status.pending',
  running: 'task.status.running',
  waiting_approval: 'task.status.waitingApproval',
  success: 'task.status.success',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled'
}

type TaskNodeData = { task: Task }
type TaskFlowNode = Node<TaskNodeData, 'task'>

/** DAG 节点：角色色左条 + 头像 + 标题 + 状态点（复用列表视图同套 token / 角色色 / 文案）。 */
function TaskNode({ data }: NodeProps<TaskFlowNode>): React.JSX.Element {
  const tr = useT()
  const { task } = data
  const roleColor = getRoleColor(task.agentRole)
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5"
      style={{
        width: NODE_W,
        height: NODE_H,
        background: 'var(--color-bg-container)',
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${roleColor}`,
        boxShadow: 'var(--shadow-sm)'
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'var(--color-border)', width: 6, height: 6 }}
      />
      <Avatar role={task.agentRole} size="sm" />
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-xs font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span
            className="inline-block shrink-0 rounded-full"
            style={{ width: 6, height: 6, background: STATUS_COLOR[task.status] }}
          />
          <span className="truncate text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {getRoleLabel(task.agentRole)} · {tr(STATUS_KEY[task.status])}
          </span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'var(--color-border)', width: 6, height: 6 }}
      />
    </div>
  )
}

const nodeTypes = { task: TaskNode }

/** 用 dagre 做分层（Sugiyama）布局：按 dependsOn 连边，自动处理 fan-in/out 与交叉。 */
function buildGraph(tasks: Task[]): { nodes: TaskFlowNode[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 52 })
  const ids = new Set(tasks.map((t) => t.id))
  for (const t of tasks) g.setNode(t.id, { width: NODE_W, height: NODE_H })
  const edges: Edge[] = []
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) continue
      g.setEdge(dep, t.id)
      edges.push({
        id: `${dep}->${t.id}`,
        source: dep,
        target: t.id,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { stroke: 'var(--color-border)', strokeWidth: 1.5 }
      })
    }
  }
  Dagre.layout(g)
  return {
    nodes: tasks.map((t) => {
      const p = g.node(t.id)
      return {
        id: t.id,
        type: 'task',
        position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
        data: { task: t }
      }
    }),
    edges
  }
}

/** 跟随应用主题（documentElement[data-theme]）切换 reactflow colorMode。 */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setDark(el.dataset.theme === 'dark'))
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

/** 任务 DAG 图视图：节点=任务（角色色+状态），边=dependsOn 依赖；只读（不可拖拽/连线）。 */
export function TaskDag(): React.JSX.Element {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)
  const tasksMap = useAppStore((s) => s.tasks)
  const dark = useDarkMode()
  const tasks = useMemo(() => (activeId ? (tasksMap[activeId] ?? []) : []), [activeId, tasksMap])
  const { nodes, edges } = useMemo(() => buildGraph(tasks), [tasks])

  if (tasks.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {tr('task.empty')}
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={dark ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.3}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
