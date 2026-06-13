import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2, Check, XCircle, Wrench } from 'lucide-react'
import type { Message } from '../../types'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { ToolCallCard } from './ToolCallCard'

/** 连续工具调用聚合卡片（参照 Claude.ai "Used N tools" 折叠模式）。
 *  单条时直接平铺 ToolCallCard；多条折叠为组：运行中自动展开，
 *  全部结束后自动收起（用户手动开合优先）。 */
export function ToolCallGroup({ msgs }: { msgs: Message[] }): React.JSX.Element {
  const running = msgs.filter((m) => (m.toolStatus ?? 'running') === 'running').length
  const failed = msgs.filter((m) => m.toolStatus === 'failed').length
  const [open, setOpen] = useState(false)
  const userToggled = useRef(false)

  // 运行中自动展开、全部结束自动收起；用户手动开合后不再自动接管
  useEffect(() => {
    if (!userToggled.current) setOpen(running > 0)
  }, [running])

  const role = msgs[0].agentRole ?? 'orchestrator'
  const agentName = msgs[0].agentName ?? getRoleLabel(role)

  if (msgs.length === 1) {
    return (
      <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
        <Avatar role={role} size="sm" className="mt-0.5" />
        <ToolCallCard msg={msgs[0]} />
      </div>
    )
  }

  const expanded = open

  const headline =
    running > 0
      ? `正在使用工具（${msgs.length - running}/${msgs.length}）`
      : `使用了 ${msgs.length} 个工具`

  return (
    <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
      <Avatar role={role} size="sm" className="mt-0.5" />
      <div className="max-w-[440px] flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold" style={{ color: getRoleColor(role) }}>
            {agentName}
          </span>
        </div>
        <div
          className="rounded-lg overflow-hidden"
          style={{
            border: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-container)'
          }}
        >
          <button
            onClick={() => {
              userToggled.current = true
              setOpen(!expanded)
            }}
            className="flex items-center gap-2 w-full px-3 py-2 border-none bg-transparent cursor-pointer hover-spotlight"
          >
            <ChevronRight
              size={12}
              className="shrink-0 transition-transform duration-200"
              style={{
                color: 'var(--color-text-tertiary)',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
              }}
            />
            <Wrench
              size={13}
              className="shrink-0"
              style={{ color: 'var(--color-text-secondary)' }}
            />
            <span
              className="flex-1 text-left text-[var(--font-size-sm)] font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {headline}
            </span>
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
                <XCircle size={12} /> {failed} 失败
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-[11px] shrink-0"
                style={{ color: 'var(--color-success)' }}
              >
                <Check size={12} /> 完成
              </span>
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
      </div>
    </div>
  )
}
