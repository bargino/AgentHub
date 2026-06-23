import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Message } from '../../types'
import { useAppStore } from '../../store'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { useT } from '../../i18n'
import { ThinkingCard } from './ThinkingCard'
import { ToolCallGroup } from './ToolCallGroup'
import { CodeChangeCard } from './CodeChangeCard'
import { MarkdownBody, MessageBubble } from './MessageBubble'

/** 执行耗时格式化：<1s 用 ms，<60s 用 s，否则 m+s */
function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

/** 执行过程分段：保留真实顺序，相邻 tool 消息聚为一组（连续多工具可整体折叠）， 其余消息逐条独立。 */
type TraceSeg = { kind: 'tools'; key: string; msgs: Message[] } | { kind: 'msg'; msg: Message }

function segmentSteps(steps: Message[]): TraceSeg[] {
  const segs: TraceSeg[] = []
  let tools: Message[] = []
  const flush = (): void => {
    if (tools.length > 0) {
      segs.push({ kind: 'tools', key: `tools_${tools[0].id}`, msgs: tools })
      tools = []
    }
  }
  for (const s of steps) {
    if (s.type === 'tool') {
      tools.push(s)
    } else {
      flush()
      segs.push({ kind: 'msg', msg: s })
    }
  }
  flush()
  return segs
}

/** 一次 agent 任务执行聚合卡：
 *  - 头部：头像 + 角色名 + 时间（仅一次）
 *  - 「执行过程」折叠区：按真实发生顺序的步骤（思考 / 工具调用+结果 / 中间输出），不按类型合并
 *  - 代码修改块：本次任务的 Diff 文件增删行数（对标 Cursor/Windsurf），始终可见、点击进入审查
 *  - 主体：最终答案 Markdown，复用 MessageBubble(grouped) 保留复制/引用/澄清/计划确认/流式
 *  执行中自动展开过程、完成后保持展开（用户手动开合优先；历史 turn 初始收起）；
 *  过程内相邻工具聚为可整体折叠的组，单工具/工具组结束后各自收起。 */
export function AgentTurnCard({
  steps,
  answer
}: {
  steps: Message[]
  answer: Message | null
}): React.JSX.Element {
  const tr = useT()
  const head =
    answer ??
    steps.find((s) => s.type === 'thinking' || s.type === 'tool' || s.type === 'agent') ??
    steps[0]
  const role = head?.agentRole ?? 'orchestrator'
  const roleColor = getRoleColor(role)
  const streaming = !!answer?.streaming || steps.some((s) => s.streaming)
  // 执行耗时：turn 内消息时间戳跨度（rawTimestamp 为 ISO，可靠）
  const durationText = useMemo(() => {
    const stamps = (answer ? [...steps, answer] : steps)
      .map((m) => (m.rawTimestamp ? Date.parse(m.rawTimestamp) : NaN))
      .filter((n) => !Number.isNaN(n))
    return stamps.length >= 2 ? formatDuration(Math.max(...stamps) - Math.min(...stamps)) : ''
  }, [steps, answer])
  // 执行过程分段（相邻工具聚组），保留真实顺序
  const segs = useMemo(() => segmentSteps(steps), [steps])
  // 本次任务产生的代码变更：按 taskId 从 diff 缓存匹配（实时会话已缓存；命中则内联展示）
  const diffsById = useAppStore((s) => s.diffsById)
  const taskId = answer?.taskId ?? steps.find((s) => s.taskId !== undefined)?.taskId
  const diffs = useMemo(
    () => (taskId ? Object.values(diffsById).filter((d) => d.taskId === taskId) : []),
    [diffsById, taskId]
  )
  const [expanded, setExpanded] = useState(streaming)
  const [userToggled, setUserToggled] = useState(false)
  const [prevStreaming, setPrevStreaming] = useState(streaming)

  // 执行中自动展开过程；完成后不自动收起（避免刚跑完的工具/思考记录「消失」）；
  // 用户手动开合优先；已结束的历史 turn 初始即收起（useState(streaming) 初值为 false）。
  if (streaming !== prevStreaming) {
    setPrevStreaming(streaming)
    if (streaming && !userToggled) setExpanded(true)
  }

  const timeText = (answer ?? head)?.timestamp

  return (
    <div className="animate-fade-in">
      <div className="flex items-start gap-2.5 px-4 mt-3">
        <Avatar role={role} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1" style={{ maxWidth: 'min(75%, var(--bubble-max-agent))' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: roleColor }} />
            <span className="text-xs font-semibold" style={{ color: roleColor }}>
              {head?.agentName ?? getRoleLabel(role)}
            </span>
            {timeText && (
              <span
                className="text-[11px] tabular-nums opacity-60"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {timeText}
              </span>
            )}
          </div>

          {steps.length > 0 && (
            <div
              className="rounded-lg overflow-hidden mb-1"
              style={{
                border: '1px solid var(--color-border-light)',
                background: 'var(--color-bg-spotlight)'
              }}
            >
              <button
                onClick={() => {
                  setUserToggled(true)
                  setExpanded(!expanded)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 border-none bg-transparent cursor-pointer hover-spotlight"
              >
                <ChevronRight
                  size={12}
                  className="shrink-0 transition-transform duration-200"
                  style={{
                    color: 'var(--color-text-tertiary)',
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
                  }}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {tr('chat.turn.trace')}
                  {streaming
                    ? ` · ${tr('chat.turn.running')}`
                    : durationText
                      ? ` · ${durationText}`
                      : ''}
                </span>
              </button>
              {expanded && (
                <div
                  className="flex flex-col gap-1.5 px-2.5 py-2"
                  style={{ borderTop: '1px solid var(--color-border-light)' }}
                >
                  {segs.map((seg) =>
                    seg.kind === 'tools' ? (
                      <ToolCallGroup key={seg.key} msgs={seg.msgs} compact />
                    ) : seg.msg.type === 'thinking' ? (
                      <ThinkingCard key={seg.msg.id} msg={seg.msg} compact />
                    ) : seg.msg.type === 'system' ? (
                      <div
                        key={seg.msg.id}
                        className="text-[11px] px-2 py-1 rounded whitespace-pre-wrap break-words"
                        style={{
                          background: 'var(--color-bg-spotlight)',
                          color: 'var(--color-text-tertiary)'
                        }}
                      >
                        {seg.msg.content}
                      </div>
                    ) : seg.msg.type === 'error' ? (
                      <div
                        key={seg.msg.id}
                        className="text-[12px] px-2 py-1 rounded whitespace-pre-wrap break-words"
                        style={{
                          background: 'var(--color-error-bg)',
                          color: 'var(--color-error)',
                          border: '1px solid var(--color-error-border)'
                        }}
                      >
                        {seg.msg.content}
                      </div>
                    ) : (
                      <div key={seg.msg.id} className="text-[13px]">
                        <MarkdownBody content={seg.msg.content} />
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* 代码修改块：始终可见（不随执行过程折叠），对标 Cursor / Windsurf 行内变更展示 */}
          <CodeChangeCard diffs={diffs} />
        </div>
      </div>

      {answer && <MessageBubble msg={answer} grouped />}
    </div>
  )
}
