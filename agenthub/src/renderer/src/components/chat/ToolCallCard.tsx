import { ChevronRight, Loader2, Check, XCircle, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Message } from '../../types'
import { Badge } from '../ui/Badge'
import { getRoleColor } from '../ui/role'
import { useT } from '../../i18n'

const STATUS_CONFIG = {
  running: {
    icon: Loader2,
    iconColor: 'var(--color-brand)',
    animate: true,
    badgeVariant: 'brand' as const,
    labelKey: 'chat.tools.statusRunning'
  },
  success: {
    icon: Check,
    iconColor: 'var(--color-success)',
    animate: false,
    badgeVariant: 'success' as const,
    labelKey: 'chat.tools.statusDone'
  },
  failed: {
    icon: XCircle,
    iconColor: 'var(--color-error)',
    animate: false,
    badgeVariant: 'error' as const,
    labelKey: 'chat.tools.statusFailed'
  }
}

/** 工具输入摘要：取首行并截断，给卡片头部提供上下文 */
function inputSummary(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || ms <= 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

/** 命令/工具调用卡片（对标 Codex）：执行中自动展开看实时输出，
 *  结束后自动收起为一行摘要（含退出码/耗时）；用户手动开合优先。 */
export function ToolCallCard({
  msg,
  compact = false
}: {
  msg: Message
  compact?: boolean
}): React.JSX.Element {
  const tr = useT()
  const status = msg.toolStatus ?? 'running'
  const running = status === 'running'
  const [expanded, setExpanded] = useState(running)
  const [userToggled, setUserToggled] = useState(false)
  const [prevRunning, setPrevRunning] = useState(running)
  const bodyRef = useRef<HTMLDivElement>(null)
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.running

  // 未被用户手动开合过则跟随执行态：执行中展开、结束自动收起（渲染期同步复位）
  if (running !== prevRunning) {
    setPrevRunning(running)
    if (!userToggled) setExpanded(running)
  }

  // 执行中输出跟随到底部
  useEffect(() => {
    if (running && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [msg.content, running, expanded])

  const StatusIcon = config.icon
  const summary = inputSummary(msg.content)
  const exitCode = msg.meta?.exitCode
  const duration = formatDuration(msg.meta?.durationMs)
  const metaText = [exitCode !== undefined && exitCode !== null ? `exit ${exitCode}` : '', duration]
    .filter(Boolean)
    .join(' · ')

  const roleColor = getRoleColor(msg.agentRole ?? 'orchestrator')

  return (
    <div
      className={`relative rounded-lg overflow-hidden ${compact ? 'w-full' : 'max-w-[440px]'}`}
      style={{
        border: '1px solid var(--color-border-light)',
        borderLeft: running ? `2px solid ${roleColor}` : '1px solid var(--color-border-light)',
        background: 'var(--color-bg-container)'
      }}
    >
      {/* 执行中：顶部 shimmer 扫过 */}
      {running && (
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none"
          style={{
            height: 1.5,
            background: `linear-gradient(90deg, transparent, ${roleColor}88, transparent)`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.6s linear infinite'
          }}
        />
      )}
      <button
        onClick={() => {
          setUserToggled(true)
          setExpanded(!expanded)
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
        <Terminal size={14} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
        <span
          className="shrink-0 text-left text-[var(--font-size-sm)] font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {msg.toolName}
        </span>
        {summary && (
          <span
            className="flex-1 text-left text-[11px] truncate"
            style={{
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {metaText && (
          <span
            className="shrink-0 text-[11px]"
            style={{
              color:
                exitCode !== undefined && exitCode !== null && exitCode !== 0
                  ? 'var(--color-error)'
                  : 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {metaText}
          </span>
        )}
        <StatusIcon
          size={12}
          className={`shrink-0 ${config.animate ? 'animate-spin' : ''}`}
          style={{ color: config.iconColor }}
        />
        <Badge variant={config.badgeVariant} size="sm">
          {tr(config.labelKey)}
        </Badge>
      </button>

      {expanded && msg.content && (
        <div
          ref={bodyRef}
          className="px-3 py-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-60 overflow-y-auto"
          style={{
            background: 'var(--color-bg-code)',
            color: 'var(--color-text-code)',
            fontFamily: 'var(--font-mono)'
          }}
        >
          {msg.content}
        </div>
      )}
    </div>
  )
}
