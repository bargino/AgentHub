import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, CornerUpLeft, Undo2 } from 'lucide-react'
import type { Message, AgentRole } from '../../types'
import { useAppStore } from '../../store'
import { confirmPlan, revisePlan } from '../../services/api'
import { Avatar } from '../ui/Avatar'
import { Tooltip } from '../ui/Tooltip'
import { getRoleColor, getRoleLabel } from '../ui/role'
import { useT } from '../../i18n'
import { ThinkingCard } from './ThinkingCard'
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
  const tr = useT()
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
      <Tooltip content={copied ? tr('common.copied') : tr('common.copy')}>
        <button
          onClick={copy}
          aria-label={copied ? tr('common.copied') : tr('common.copy')}
          className="flex items-center justify-center w-6 h-6 rounded border-none bg-transparent cursor-pointer hover-spotlight"
          style={{ color: copied ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </Tooltip>
      <Tooltip content={tr('chat.bubble.quote')}>
        <button
          onClick={() => useAppStore.getState().setReplyingTo(msg)}
          aria-label={tr('chat.bubble.quote')}
          className="flex items-center justify-center w-6 h-6 rounded border-none bg-transparent cursor-pointer hover-spotlight"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <CornerUpLeft size={12} />
        </button>
      </Tooltip>
      {canRollback && (
        <Tooltip
          content={confirmRollback ? tr('chat.bubble.rollbackConfirm') : tr('chat.bubble.rollback')}
        >
          <button
            onClick={rollback}
            aria-label={
              confirmRollback ? tr('chat.bubble.rollbackConfirm') : tr('chat.bubble.rollback')
            }
            className="flex items-center justify-center h-6 rounded border-none bg-transparent cursor-pointer hover-spotlight"
            style={{
              minWidth: 24,
              padding: confirmRollback ? '0 4px' : 0,
              color: confirmRollback ? 'var(--color-error)' : 'var(--color-text-tertiary)'
            }}
          >
            <Undo2 size={12} />
            {confirmRollback && (
              <span className="text-[10px] ml-1">{tr('chat.bubble.rollbackConfirmShort')}</span>
            )}
          </button>
        </Tooltip>
      )}
    </div>
  )
}

/** 规划期澄清快捷选项（Phase 1a）：点击即把该选项作为用户消息发出，推荐项高亮 */
function ClarifyOptions({
  options,
  recommended
}: {
  options: string[]
  recommended?: number
}): React.JSX.Element {
  const [sent, setSent] = useState(false)
  const pick = (opt: string): void => {
    if (sent) return
    setSent(true)
    void useAppStore.getState().sendMessage(opt)
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {options.map((opt, i) => {
        const isRec = i === recommended
        return (
          <button
            key={i}
            onClick={() => pick(opt)}
            disabled={sent}
            className="text-[12px] px-2.5 py-1 rounded-full border-none hover-spotlight transition-colors"
            style={{
              border: `1px solid ${isRec ? 'var(--color-brand)' : 'var(--color-border)'}`,
              background: isRec ? 'var(--color-brand-bg)' : 'var(--color-bg-spotlight)',
              color: isRec ? 'var(--color-brand)' : 'var(--color-text-secondary)',
              opacity: sent ? 0.5 : 1
            }}
          >
            {isRec ? `★ ${opt}` : opt}
          </button>
        )
      })}
    </div>
  )
}

/** 计划确认门禁（Phase 1b + A）：批准→执行；取消→放弃；修改计划→提交意见后端重规划 */
function PlanConfirm({
  conversationId,
  taskCount
}: {
  conversationId: string
  goal?: string
  taskCount?: number
}): React.JSX.Element {
  const [done, setDone] = useState<null | 'approved' | 'cancelled' | 'revised'>(null)
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState('')

  const confirm = (approved: boolean): void => {
    if (done !== null) return
    setDone(approved ? 'approved' : 'cancelled')
    void confirmPlan(conversationId, approved)
  }
  const submitRevise = (): void => {
    if (done !== null || !feedback.trim()) return
    setDone('revised')
    void revisePlan(conversationId, feedback.trim())
  }

  if (done !== null) {
    const txt =
      done === 'approved'
        ? '✓ 已批准，开始执行'
        : done === 'revised'
          ? '已提交修改，正在重新规划…'
          : '已取消该计划'
    return (
      <div className="mt-2 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {txt}
      </div>
    )
  }

  if (revising) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="说明要怎么改这个计划（比如：去掉测试任务、换技术栈、调整顺序…）"
          rows={2}
          className="text-[12px] px-2 py-1.5 rounded-md"
          style={{
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-spotlight)',
            color: 'var(--color-text-primary)',
            resize: 'vertical'
          }}
        />
        <div className="flex gap-1.5">
          <button
            onClick={submitRevise}
            disabled={!feedback.trim()}
            className="text-[12px] px-3 py-1 rounded-full border-none hover-spotlight transition-colors"
            style={{
              background: 'var(--color-brand)',
              color: '#fff',
              opacity: feedback.trim() ? 1 : 0.5
            }}
          >
            提交修改
          </button>
          <button
            onClick={() => setRevising(false)}
            className="text-[12px] px-3 py-1 rounded-full hover-spotlight transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-spotlight)',
              color: 'var(--color-text-secondary)'
            }}
          >
            返回
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {!!taskCount && (
        <span className="text-[12px] mr-1" style={{ color: 'var(--color-text-tertiary)' }}>
          共 {taskCount} 个任务
        </span>
      )}
      <button
        onClick={() => confirm(true)}
        className="text-[12px] px-3 py-1 rounded-full border-none hover-spotlight transition-colors"
        style={{ background: 'var(--color-brand)', color: '#fff' }}
      >
        批准执行
      </button>
      <button
        onClick={() => setRevising(true)}
        className="text-[12px] px-3 py-1 rounded-full hover-spotlight transition-colors"
        style={{
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-spotlight)',
          color: 'var(--color-text-secondary)'
        }}
      >
        修改计划
      </button>
      <button
        onClick={() => confirm(false)}
        className="text-[12px] px-3 py-1 rounded-full hover-spotlight transition-colors"
        style={{
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-spotlight)',
          color: 'var(--color-text-secondary)'
        }}
      >
        取消
      </button>
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

  // 工具消息一律由 ChatWindow 的 buildFeed 聚合为 ToolCallGroup 渲染，不会走到这里

  // 用户消息：右对齐渐变气泡（纯文本保留换行），hover 右上浮出操作条
  if (msg.type === 'user') {
    return (
      <div
        className={`group flex justify-end px-4 animate-fade-in ${grouped ? 'mt-0.5' : 'mt-3'} mb-0.5`}
      >
        <div className="relative" style={{ maxWidth: 'min(70%, var(--bubble-max-user))' }}>
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
            {msg.attachments && msg.attachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 ${msg.content ? 'mb-2' : ''}`}>
                {msg.attachments.map((a, i) => (
                  <img
                    key={i}
                    src={a.url}
                    alt={a.filename || 'image'}
                    style={{
                      maxWidth: 180,
                      maxHeight: 180,
                      borderRadius: 'var(--radius-md)',
                      display: 'block',
                      background: 'rgba(255,255,255,0.15)'
                    }}
                  />
                ))}
              </div>
            )}
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
      <div className="relative min-w-0" style={{ maxWidth: 'min(75%, var(--bubble-max-agent))' }}>
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
          {!msg.streaming &&
            msg.meta?.clarify?.options &&
            msg.meta.clarify.options.length > 0 && (
              <ClarifyOptions
                options={msg.meta.clarify.options}
                recommended={msg.meta.clarify.recommended}
              />
            )}
          {!msg.streaming && msg.meta?.planConfirm && (
            <PlanConfirm
              conversationId={msg.conversationId}
              goal={msg.meta.planConfirm.goal}
              taskCount={msg.meta.planConfirm.taskCount}
            />
          )}
          {msg.streaming && <span className="stream-cursor" />}
        </div>
      </div>
    </div>
  )
}
