import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, CornerUpLeft, Undo2 } from 'lucide-react'
import type { Message, AgentRole } from '../../types'
import { useAppStore } from '../../store'
import { Avatar } from '../ui/Avatar'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { ThinkingCard } from './ThinkingCard'
import { ToolCallCard } from './ToolCallCard'
import { CodeBlock } from './CodeBlock'

/** agent / approval / error 气泡的 Markdown 正文（GFM + 代码块高亮） */
export function MarkdownBody({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="md-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}

/** 浮动操作条：气泡右上 hover 浮出（复制 / 引用回复 / 用户消息回退） */
function BubbleActions({ msg }: { msg: Message }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // 仅已落库的用户消息可回退（乐观插入的 temp_ 消息无服务端 id）
  const canRollback = msg.type === 'user' && !msg.id.startsWith('temp_')

  const rollback = (): void => {
    if (!confirmRollback) {
      setConfirmRollback(true)
      setTimeout(() => setConfirmRollback(false), 3000)
      return
    }
    setConfirmRollback(false)
    void useAppStore.getState().rollbackTo(msg.id)
  }

  return (
    <div
      className="absolute -top-3 right-1 z-10 hidden group-hover:flex items-center gap-0.5 px-1 py-0.5 rounded-md animate-menu-pop"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-light)',
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <button
        onClick={copy}
        title={copied ? '已复制' : '复制'}
        className="flex items-center justify-center w-5 h-5 rounded border-none bg-transparent cursor-pointer hover-spotlight"
        style={{ color: copied ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <button
        onClick={() => useAppStore.getState().setReplyingTo(msg)}
        title="引用回复"
        className="flex items-center justify-center w-5 h-5 rounded border-none bg-transparent cursor-pointer hover-spotlight"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <CornerUpLeft size={12} />
      </button>
      {canRollback && (
        <button
          onClick={rollback}
          title={confirmRollback ? '再次点击确认：删除本条及之后的全部消息' : '回退到此处'}
          className="flex items-center justify-center h-5 rounded border-none bg-transparent cursor-pointer hover-spotlight"
          style={{
            minWidth: 20,
            padding: confirmRollback ? '0 4px' : 0,
            color: confirmRollback ? 'var(--color-error)' : 'var(--color-text-tertiary)'
          }}
        >
          <Undo2 size={12} />
          {confirmRollback && <span className="text-[10px] ml-1">确认回退</span>}
        </button>
      )}
    </div>
  )
}

export function MessageBubble({
  msg,
  grouped = false
}: {
  msg: Message
  /** 同 Agent 连续消息的后续条：不渲染头像与名字行，组内紧凑间距 */
  grouped?: boolean
}): React.JSX.Element {
  // 系统消息：居中灰色 pill
  if (msg.type === 'system') {
    return (
      <div className="flex justify-center my-3">
        <span
          className="text-[11px] px-3 py-1 rounded-full max-w-[80%] truncate"
          style={{ background: 'var(--color-bg-spotlight)', color: 'var(--color-text-secondary)' }}
        >
          {msg.content}
        </span>
      </div>
    )
  }

  // 思考过程：流式展开 / 完成自动折叠
  if (msg.type === 'thinking') {
    return <ThinkingCard msg={msg} />
  }

  // 工具调用：左侧 Avatar + ToolCallCard（连续多条由 ChatWindow 聚合为 ToolCallGroup）
  if (msg.type === 'tool') {
    return (
      <div className="flex items-start gap-2.5 my-1.5 px-4 animate-fade-in">
        <Avatar role={msg.agentRole ?? 'orchestrator'} size="sm" className="mt-0.5" />
        <ToolCallCard msg={msg} />
      </div>
    )
  }

  // 用户消息：右对齐渐变气泡（纯文本保留换行），hover 右上浮出操作条
  if (msg.type === 'user') {
    return (
      <div
        className={`group flex justify-end px-4 animate-fade-in ${grouped ? 'mt-0.5' : 'mt-3'} mb-0.5`}
      >
        <div className="relative max-w-[70%]">
          <BubbleActions msg={msg} />
          <div
            className="px-3.5 py-2.5 text-[13px] whitespace-pre-wrap break-words"
            style={{
              background: 'var(--bubble-user-bg)',
              color: '#fff',
              lineHeight: 'var(--leading-relaxed)',
              borderRadius: grouped
                ? 'var(--radius-bubble)'
                : 'var(--radius-bubble) 4px var(--radius-bubble) var(--radius-bubble)',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            {msg.content}
          </div>
        </div>
      </div>
    )
  }

  // agent / approval / error：Markdown 气泡
  const role: AgentRole = msg.agentRole ?? 'orchestrator'
  const roleColor = getRoleColor(role)
  const isError = msg.type === 'error'
  const isApproval = msg.type === 'approval'

  const bubbleBackground = isError
    ? 'var(--color-error-bg)'
    : isApproval
      ? 'var(--color-brand-bg)'
      : 'var(--color-bg-container)'
  const bubbleBorder = isError
    ? 'var(--color-error-border)'
    : isApproval
      ? 'var(--color-brand)'
      : 'var(--color-border)'

  return (
    <div
      className={`group flex items-start gap-2.5 px-4 animate-fade-in ${grouped ? 'mt-0.5' : 'mt-3'} mb-0.5`}
    >
      {grouped ? (
        <span className="w-7 shrink-0" />
      ) : (
        <Avatar role={role} size="sm" className="mt-0.5" />
      )}
      <div className="relative max-w-[75%] min-w-0">
        {!grouped && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: roleColor }} />
            <span className="text-xs font-semibold" style={{ color: roleColor }}>
              {msg.agentName ?? getRoleLabel(role)}
            </span>
            <span
              className="text-[11px] tabular-nums opacity-60 group-hover:opacity-100"
              style={{
                color: 'var(--color-text-tertiary)',
                transition: 'opacity var(--transition-fast)'
              }}
            >
              {msg.timestamp}
            </span>
          </div>
        )}
        {!msg.streaming && <BubbleActions msg={msg} />}
        <div
          className="px-3.5 py-2.5 text-[13px]"
          style={{
            background: bubbleBackground,
            border: `1px solid ${bubbleBorder}`,
            lineHeight: 'var(--leading-relaxed)',
            borderRadius: grouped
              ? 'var(--radius-bubble)'
              : '4px var(--radius-bubble) var(--radius-bubble) var(--radius-bubble)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <MarkdownBody content={msg.content} />
          {msg.streaming && <span className="stream-cursor" />}
        </div>
      </div>
    </div>
  )
}
