import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Send,
  Square,
  AtSign,
  SquareSlash,
  Code,
  Paperclip,
  X,
  CornerUpLeft,
  Map,
  Eye,
  Rocket,
  ListTodo,
  Files,
  GitBranch,
  Monitor,
  Users
} from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import { Avatar } from '../ui/Avatar'
import { getRoleLabel } from '../ui/role'
import type { Agent, AgentRole } from '../../types'

const ROLE_DESC: Record<string, string> = {
  orchestrator: '需求拆解与任务编排',
  planner: '分析项目结构与方案',
  coder: '代码修改与实现',
  reviewer: '代码审查',
  preview: '启动网页预览',
  deployer: '确认并部署'
}

/** /命令动作：@角色直达 或 打开面板（在事件处理中执行，避免 render 期捕获 ref） */
type CommandAction =
  | { type: 'prefix'; role: string }
  | { type: 'panel'; panel: 'task' | 'git' | 'diff' | 'preview' | 'group' }

/** 联想菜单项：@Agent 或 /命令 */
type MenuItem =
  | { kind: 'agent'; role: AgentRole; label: string; desc: string }
  | { kind: 'command'; cmd: string; desc: string; icon: React.ReactNode; action: CommandAction }

function agentItems(members: Agent[]): MenuItem[] {
  return members.map((a) => ({
    kind: 'agent' as const,
    role: a.role,
    label: `@${a.role}`,
    desc: a.description || ROLE_DESC[a.role] || a.name
  }))
}

/** 引用原文 -> Markdown 引用块前缀（逐行加 >，超长截断） */
function buildQuoteBlock(authorLabel: string, content: string): string {
  let text = content.trim().replace(/\s+/g, ' ')
  if (text.length > 240) text = text.slice(0, 240) + '…'
  return `> **${authorLabel}**：${text}\n\n`
}

export function MessageInput(): React.JSX.Element {
  const [text, setText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [filtered, setFiltered] = useState<MenuItem[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [focused, setFocused] = useState(false)
  const [justSent, setJustSent] = useState(false)
  const activeId = useAppStore((s) => s.activeConversationId)
  const agents = useAppStore((s) => s.agents)
  const conversations = useAppStore((s) => s.conversations)
  const activeDiff = useAppStore((s) => s.activeDiff)
  const replyingTo = useAppStore((s) => s.replyingTo)
  const contextUsage = useAppStore((s) => s.contextUsage)
  const running = conversations.find((c) => c.id === activeId)?.status === 'running'
  // @联想只列当前群成员（空 = 全员），与发送路由口径一致
  const memberItems = useMemo(() => {
    const conv = conversations.find((c) => c.id === activeId)
    return agentItems(resolveMembers(conv, agents))
  }, [agents, conversations, activeId])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** /命令表：@直达型仅当对应角色在群内；面板型动作在 runCommand 中执行 */
  const commandItems = useMemo<MenuItem[]>(() => {
    const roles = new Set(memberItems.map((m) => (m.kind === 'agent' ? m.role : '')))
    const items: MenuItem[] = []
    if (roles.has('planner'))
      items.push({
        kind: 'command',
        cmd: '/plan',
        desc: '让 Planner 制定方案',
        icon: <Map size={15} />,
        action: { type: 'prefix', role: 'planner' }
      })
    if (roles.has('reviewer'))
      items.push({
        kind: 'command',
        cmd: '/review',
        desc: '发起代码审查',
        icon: <Eye size={15} />,
        action: { type: 'prefix', role: 'reviewer' }
      })
    if (roles.has('deployer'))
      items.push({
        kind: 'command',
        cmd: '/deploy',
        desc: '发起部署流程',
        icon: <Rocket size={15} />,
        action: { type: 'prefix', role: 'deployer' }
      })
    items.push(
      {
        kind: 'command',
        cmd: '/tasks',
        desc: '打开任务面板',
        icon: <ListTodo size={15} />,
        action: { type: 'panel', panel: 'task' }
      },
      {
        kind: 'command',
        cmd: '/files',
        desc: '查看文件变更与提交历史',
        icon: <Files size={15} />,
        action: { type: 'panel', panel: 'git' }
      }
    )
    if (activeDiff)
      items.push({
        kind: 'command',
        cmd: '/diff',
        desc: '查看代码 Diff',
        icon: <GitBranch size={15} />,
        action: { type: 'panel', panel: 'diff' }
      })
    items.push(
      {
        kind: 'command',
        cmd: '/preview',
        desc: '打开网页预览',
        icon: <Monitor size={15} />,
        action: { type: 'panel', panel: 'preview' }
      },
      {
        kind: 'command',
        cmd: '/group',
        desc: '群设置（成员 / 规则 / 技能）',
        icon: <Users size={15} />,
        action: { type: 'panel', panel: 'group' }
      }
    )
    return items
  }, [memberItems, activeDiff])

  // 订阅外部 store 的草稿（如 DiffViewer 的「请求修改」），消费后清空
  useEffect(() => {
    const consume = (draft: string | null): void => {
      if (!draft) return
      setText(draft)
      useAppStore.setState({ draftMessage: null })
      textareaRef.current?.focus()
    }
    consume(useAppStore.getState().draftMessage)
    return useAppStore.subscribe((s) => consume(s.draftMessage))
  }, [])

  // 点击气泡「引用回复」后聚焦输入框
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus()
  }, [replyingTo])

  /** 根据输入内容刷新联想菜单（@ 末尾触发成员；行首 / 触发命令） */
  const refreshMenu = useCallback(
    (val: string): void => {
      const atMatch = val.match(/@([\w-]*)$/)
      if (atMatch) {
        const query = atMatch[1].toLowerCase()
        const f = memberItems.filter(
          (m) => m.kind === 'agent' && m.role.toLowerCase().startsWith(query)
        )
        setFiltered(f)
        setMenuIndex(0)
        setShowMenu(f.length > 0)
        return
      }
      const slashMatch = val.match(/^\/([\w-]*)$/)
      if (slashMatch) {
        const query = slashMatch[1].toLowerCase()
        const f = commandItems.filter(
          (m) => m.kind === 'command' && m.cmd.slice(1).toLowerCase().startsWith(query)
        )
        setFiltered(f)
        setMenuIndex(0)
        setShowMenu(f.length > 0)
        return
      }
      setShowMenu(false)
    },
    [memberItems, commandItems]
  )

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setText(val)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    refreshMenu(val)
  }

  /** 执行 /命令动作（事件触发，非 render 期）：@角色直达填充输入 / 打开对应面板 */
  const runCommand = (action: CommandAction): void => {
    if (action.type === 'prefix') {
      setText(`@${action.role} `)
      textareaRef.current?.focus()
      return
    }
    const store = useAppStore.getState()
    const toggles: Record<typeof action.panel, () => void> = {
      task: store.toggleTaskPanel,
      git: store.toggleGitPanel,
      diff: store.toggleDiffPanel,
      preview: store.togglePreviewPanel,
      group: store.toggleGroupPanel
    }
    toggles[action.panel]()
    setText('')
  }

  const pickItem = (item: MenuItem): void => {
    if (item.kind === 'agent') {
      setText((t) => t.replace(/@[\w-]*$/, `@${item.role} `))
      textareaRef.current?.focus()
    } else {
      runCommand(item.action)
    }
    setShowMenu(false)
  }

  const handleSend = (): void => {
    if (!text.trim() || !activeId || running) return
    const { replyingTo: quoted, setReplyingTo, sendMessage } = useAppStore.getState()
    let content = text.trim()
    if (quoted) {
      const author =
        quoted.type === 'user'
          ? '用户'
          : (quoted.agentName ?? getRoleLabel(quoted.agentRole ?? 'orchestrator'))
      content = buildQuoteBlock(author, quoted.content) + content
      setReplyingTo(null)
    }
    void sendMessage(content)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    // 发送瞬间图标飞出微动画
    setJustSent(true)
    setTimeout(() => setJustSent(false), 300)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filtered[menuIndex]) pickItem(filtered[menuIndex])
      } else if (e.key === 'Escape') {
        setShowMenu(false)
      }
      return
    }
    if (e.key === 'Escape' && replyingTo) {
      useAppStore.getState().setReplyingTo(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** 工具栏：末尾插入 @（必要时补空格）并弹出成员菜单 */
  const insertAt = (): void => {
    const next = text === '' || /\s$/.test(text) ? text + '@' : text + ' @'
    setText(next)
    textareaRef.current?.focus()
    refreshMenu(next)
  }

  /** 工具栏：输入为空时置 / 并弹出命令菜单 */
  const insertSlash = (): void => {
    if (text !== '') return
    setText('/')
    textareaRef.current?.focus()
    refreshMenu('/')
  }

  /** 工具栏：引用文件（项目内文件转相对路径，agent 在 workspace 同构目录可直接读） */
  const attachFile = async (): Promise<void> => {
    const conv = conversations.find((c) => c.id === activeId)
    const file = await window.api.dialog.selectFile(conv?.projectPath ?? undefined)
    if (!file) return
    let ref = file
    const base = conv?.projectPath
    if (base && file.toLowerCase().startsWith(base.toLowerCase())) {
      ref = file
        .slice(base.length)
        .replace(/^[\\/]+/, '')
        .replace(/\\/g, '/')
    }
    setText((t) => {
      const sep = t === '' || /\s$/.test(t) ? '' : ' '
      return `${t}${sep}\`${ref}\` `
    })
    textareaRef.current?.focus()
  }

  /** 工具栏：插入代码块模板，光标定位到围栏内 */
  const insertCodeBlock = (): void => {
    const prefix = text === '' || text.endsWith('\n') ? text : text + '\n'
    const next = prefix + '```\n\n```'
    setText(next)
    setShowMenu(false)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      const pos = prefix.length + 4
      ta.setSelectionRange(pos, pos)
    })
  }

  const canSend = !!text.trim() && !running
  const quotedAuthor = replyingTo
    ? replyingTo.type === 'user'
      ? '用户'
      : (replyingTo.agentName ?? getRoleLabel(replyingTo.agentRole ?? 'orchestrator'))
    : ''

  return (
    <div className="relative px-4 pb-3.5 pt-1" style={{ background: 'var(--color-bg-layout)' }}>
      {/* @Agent / 斜杠命令联想菜单 */}
      {showMenu && filtered.length > 0 && (
        <div
          className="absolute bottom-full left-6 mb-1.5 overflow-hidden animate-menu-pop"
          style={{
            zIndex: 50,
            minWidth: 260,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-float)'
          }}
        >
          {filtered.map((item, i) => {
            const selected = i === menuIndex
            const key = item.kind === 'agent' ? item.role : item.cmd
            return (
              <div
                key={key}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickItem(item)
                }}
                onMouseEnter={() => setMenuIndex(i)}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
                style={{
                  background: selected ? 'var(--color-brand-bg)' : 'transparent',
                  borderLeft: selected ? '3px solid var(--color-brand)' : '3px solid transparent',
                  transition: 'background var(--transition-fast)'
                }}
              >
                {item.kind === 'agent' ? (
                  <Avatar role={item.role} size="sm" />
                ) : (
                  <span
                    className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                    style={{ background: 'var(--color-brand-bg)', color: 'var(--color-brand)' }}
                  >
                    {item.icon}
                  </span>
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-[13px] font-medium leading-tight"
                    style={{ color: 'var(--color-brand)' }}
                  >
                    {item.kind === 'agent' ? item.label : item.cmd}
                  </span>
                  <span
                    className="text-[11px] leading-tight truncate"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    {item.desc}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Composer 浮起卡片 */}
      <div
        className="overflow-hidden"
        style={{
          background: 'var(--color-bg-container)',
          border: `1px solid ${focused ? 'var(--color-brand)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-xl)',
          boxShadow: focused
            ? '0 0 0 3px var(--color-brand-bg), var(--shadow-md)'
            : 'var(--shadow-sm)',
          transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)'
        }}
      >
        {/* Agent 工作中：顶部渐变流光条 */}
        {running && <div className="flow-bar" />}
        {/* 引用回复预览条 */}
        {replyingTo && (
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{
              borderBottom: '1px solid var(--color-border-light)',
              background: 'var(--color-bg-spotlight)'
            }}
          >
            <CornerUpLeft size={13} style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
            <span
              className="text-[12px] truncate flex-1 min-w-0"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              回复{' '}
              <span style={{ color: 'var(--color-brand)', fontWeight: 500 }}>{quotedAuthor}</span>：
              {replyingTo.content.replace(/\s+/g, ' ').slice(0, 80)}
            </span>
            <button
              onClick={() => useAppStore.getState().setReplyingTo(null)}
              title="取消引用 (Esc)"
              className="flex items-center justify-center w-5 h-5 rounded border-none bg-transparent cursor-pointer hover-spotlight shrink-0"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setTimeout(() => setShowMenu(false), 150)
          }}
          placeholder={
            running
              ? 'Agent 正在执行任务，完成后可继续发送…'
              : '输入消息，@ 呼叫 Agent，/ 使用命令...'
          }
          rows={1}
          className="w-full resize-none border-none outline-none bg-transparent px-4 pt-3 pb-1 text-[14px]"
          style={{
            maxHeight: 120,
            minHeight: 40,
            lineHeight: '1.6',
            color: 'var(--color-text-primary)'
          }}
        />

        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* 左侧工具栏 */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={insertAt}
              title="@ 呼叫 Agent"
              className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent cursor-pointer hover-spotlight"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <AtSign size={15} />
            </button>
            <button
              onClick={insertSlash}
              title="/ 命令"
              disabled={text !== ''}
              className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent hover-spotlight"
              style={{
                color: 'var(--color-text-tertiary)',
                cursor: text === '' ? 'pointer' : 'not-allowed',
                opacity: text === '' ? 1 : 0.4
              }}
            >
              <SquareSlash size={15} />
            </button>
            <button
              onClick={insertCodeBlock}
              title="插入代码块"
              className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent cursor-pointer hover-spotlight"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <Code size={15} />
            </button>
            <button
              onClick={() => void attachFile()}
              title="引用文件"
              className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent cursor-pointer hover-spotlight"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <Paperclip size={15} />
            </button>
            <span className="text-[11px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
              {running ? 'Agent 工作中…' : 'Enter 发送 / Shift+Enter 换行'}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* 上下文余量（有真实计量时显示，按压力分级着色） */}
            {contextUsage && contextUsage.usedTokens > 0 && (
              <span
                className="flex items-center gap-1 text-[11px] tabular-nums"
                title={`上下文已用 ${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.windowTokens.toLocaleString()} tokens`}
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      contextUsage.pressureLevel >= 3
                        ? 'var(--color-error)'
                        : contextUsage.pressureLevel === 2
                          ? 'var(--color-warning)'
                          : contextUsage.pressureLevel === 1
                            ? 'var(--color-brand)'
                            : 'var(--color-text-tertiary)'
                  }}
                />
                上下文{' '}
                {Math.min(
                  100,
                  Math.round((contextUsage.usedTokens / contextUsage.windowTokens) * 100)
                )}
                %
              </span>
            )}
            {running ? (
              <button
                onClick={() => void useAppStore.getState().stopGeneration()}
                title="停止本轮执行"
                className="btn-press flex items-center justify-center w-7 h-7"
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'var(--color-error)',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(255, 77, 79, 0.35)'
                }}
              >
                <Square size={11} color="#fff" fill="#fff" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="btn-press flex items-center justify-center w-7 h-7 overflow-hidden"
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: canSend ? 'var(--gradient-brand)' : 'var(--color-border-light)',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  boxShadow: canSend ? '0 2px 8px rgba(37, 99, 235, 0.35)' : 'none'
                }}
                onMouseEnter={(e) => {
                  if (canSend) e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                }}
              >
                <Send
                  size={14}
                  color={canSend ? '#fff' : 'var(--color-text-tertiary)'}
                  strokeWidth={2}
                  style={{
                    transform: justSent ? 'translateX(16px)' : 'translateX(0)',
                    opacity: justSent ? 0 : 1,
                    transition: justSent
                      ? 'transform 250ms var(--ease-out-quart), opacity 250ms var(--ease-out-quart)'
                      : 'none'
                  }}
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
