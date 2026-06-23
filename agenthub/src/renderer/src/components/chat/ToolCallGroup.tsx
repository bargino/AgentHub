import { useState } from 'react'
import { ChevronRight, Loader2, Check, XCircle, Wrench } from 'lucide-react'
import type { Message } from '../../types'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { useT } from '../../i18n'
import { ToolCallCard } from './ToolCallCard'

/** 执行耗时格式化：<1s 用 ms，<60s 用 s，否则 m+s */
function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

/** 连续工具调用聚合卡片（参照 Claude.ai "Used N tools" 折叠模式）。
 *  单条时直接平铺 ToolCallCard；多条折叠为组：运行中自动展开，
 *  全部结束后自动收起（用户手动开合优先）。
 *  compact：用于「执行过程」聚合卡内，去掉头像/角色名/外边距，仅渲染紧凑折叠组。 */
export function ToolCallGroup({
  msgs,
  compact = false
}: {
  msgs: Message[]
  compact?: boolean
}): React.JSX.Element {
  const tr = useT()
  const running = msgs.filter((m) => (m.toolStatus ?? 'running') === 'running').length
  const failed = msgs.filter((m) => m.toolStatus === 'failed').length
  const [expanded, setExpanded] = useState(running > 0)
  const [userToggled, setUserToggled] = useState(false)
  const [prevRunning, setPrevRunning] = useState(running > 0)

  // 未被用户手动开合过则跟随运行态：运行中展开、全部结束收起（渲染期同步复位）
  if (running > 0 !== prevRunning) {
    setPrevRunning(running > 0)
    if (!userToggled) setExpanded(running > 0)
  }

  const role = msgs[0].agentRole ?? 'orchestrator'
  const agentName = msgs[0].agentName ?? getRoleLabel(role)

  // 单条工具：直接平铺一张（紧凑）卡，无需分组外壳
  if (msgs.length === 1) {
    if (compact) return <ToolCallCard msg={msgs[0]} compact />
    return (
      <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
        <Avatar role={role} size="sm" className="mt-0.5" />
        <ToolCallCard msg={msgs[0]} />
      </div>
    )
  }

  // 组耗时：组内消息时间戳跨度（rawTimestamp 为 ISO，可靠）
  const stamps = msgs
    .map((m) => (m.rawTimestamp ? Date.parse(m.rawTimestamp) : NaN))
    .filter((n) => !Number.isNaN(n))
  const durationText =
    running === 0 && stamps.length >= 2
      ? formatDuration(Math.max(...stamps) - Math.min(...stamps))
      : ''

  const headline =
    running > 0
      ? tr('chat.tools.using', { cur: msgs.length - running, total: msgs.length })
      : tr('chat.tools.used', { count: msgs.length })

  const groupBox = (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-container)'
      }}
    >
      <button
        onClick={() => {
          setUserToggled(true)
          setExpanded(!expanded)
        }}
        className={`flex items-center w-full border-none bg-transparent cursor-pointer hover-spotlight ${
          compact ? 'gap-1.5 px-2 py-1' : 'gap-2 px-3 py-2'
        }`}
      >
        <ChevronRight
          size={compact ? 11 : 12}
          className="shrink-0 transition-transform duration-200"
          style={{
            color: 'var(--color-text-tertiary)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
          }}
        />
        <Wrench
          size={compact ? 12 : 13}
          className="shrink-0"
          style={{ color: 'var(--color-text-secondary)' }}
        />
        <span
          className={`flex-1 text-left font-medium ${compact ? 'text-[11px]' : 'text-[var(--font-size-sm)]'}`}
          style={{ color: 'var(--color-text-primary)' }}
        >
          {headline}
        </span>
        {durationText && (
          <span
            className="shrink-0 text-[11px] tabular-nums"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {durationText}
          </span>
        )}
        {running > 0 ? (
          <Loader2
            size={12}
            className="shrink-0 animate-spin"
            style={{ color: 'var(--color-brand)' }}
          />
        ) : failed > 0 ? (
          <span
            className="flex items-center gap-1 text-[11px] shrink-0"
            style={{ color: 'var(--color-error)' }}
          >
            <XCircle size={12} /> {failed} {tr('chat.tools.failed')}
          </span>
        ) : (
          <Check size={12} className="shrink-0" style={{ color: 'var(--color-success)' }} />
        )}
      </button>

      {expanded && (
        <div
          className="flex flex-col gap-1.5 px-2.5 py-2"
          style={{
            borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-spotlight)'
          }}
        >
          {msgs.map((m) => (
            <ToolCallCard key={m.id} msg={m} compact />
          ))}
        </div>
      )}
    </div>
  )

  if (compact) return groupBox

  return (
    <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
      <Avatar role={role} size="sm" className="mt-0.5" />
      <div className="max-w-[440px] flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold" style={{ color: getRoleColor(role) }}>
            {agentName}
          </span>
        </div>
        {groupBox}
      </div>
    </div>
  )
}
