import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight, Loader2 } from 'lucide-react'
import type { Message } from '../../types'
import { Avatar } from '../ui/Avatar'

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

/** 思考过程卡片（对标 Codex）：流式时实时展开，完成后自动折叠为一行摘要。
 *  用户手动开合的状态优先于自动行为。 */
export function ThinkingCard({ msg }: { msg: Message }): React.JSX.Element {
  const streaming = !!msg.streaming
  const [open, setOpen] = useState(false)
  const userToggled = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 流式输出时内容区自动跟随到底部
  useEffect(() => {
    if (streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [msg.content, streaming])

  // 思考完成：未被用户手动操作过则自动收起
  useEffect(() => {
    if (!streaming && !userToggled.current) setOpen(false)
  }, [streaming])

  const expanded = streaming || open
  const duration = formatDuration(msg.meta?.thinkingMs)

  return (
    <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
      <Avatar role={msg.agentRole ?? 'orchestrator'} size="sm" className="mt-0.5" />
      <div className="max-w-[75%] min-w-0 flex-1">
        <div
          className="rounded-lg overflow-hidden"
          style={{
            border: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-spotlight)'
          }}
        >
          <button
            onClick={() => {
              userToggled.current = true
              setOpen(!expanded)
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
            <Brain size={13} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {streaming ? '正在思考…' : duration ? `已思考 ${duration}` : '已思考'}
            </span>
            {streaming && (
              <Loader2
                size={11}
                className="shrink-0 animate-spin"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
            )}
          </button>
          {expanded && msg.content && (
            <div
              ref={bodyRef}
              className="px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words overflow-y-auto"
              style={{
                maxHeight: 180,
                color: 'var(--color-text-secondary)',
                borderTop: '1px solid var(--color-border-light)'
              }}
            >
              {msg.content}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
