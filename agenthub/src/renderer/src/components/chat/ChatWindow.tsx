import { useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ListTodo,
  GitBranch,
  Monitor,
  MessageCircle,
  Users,
  Files,
  FolderPlus,
  AtSign,
  SquareSlash
} from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import type { Message } from '../../types'
import { MessageBubble } from './MessageBubble'
import { ToolCallGroup } from './ToolCallGroup'
import { MessageInput } from './MessageInput'
import { AgentStatusBar } from './AgentStatusBar'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { getRoleColor, getRoleLabel } from '../ui/role'

/** 顶栏成员头像堆叠（前 4 + 「+N」），点击打开群设置 */
function MemberStack(): React.JSX.Element | null {
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const agents = useAppStore((s) => s.agents)
  const conv = conversations.find((c) => c.id === activeId)
  const members = useMemo(() => resolveMembers(conv, agents), [conv, agents])

  if (members.length === 0) return null

  const shown = members.slice(0, 4)
  const rest = members.length - shown.length

  return (
    <button
      onClick={() => useAppStore.getState().toggleGroupPanel()}
      title={`群成员 ${members.length} 人，点击管理`}
      className="flex items-center border-none bg-transparent cursor-pointer pl-1"
    >
      {shown.map((m, i) => (
        <span
          key={m.id}
          className="rounded-full"
          style={{
            marginLeft: i === 0 ? 0 : -8,
            boxShadow: '0 0 0 2px var(--color-bg-container)',
            borderRadius: '50%',
            zIndex: shown.length - i
          }}
        >
          <Avatar role={m.role} size="sm" />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="flex items-center justify-center rounded-full text-[10px] font-semibold"
          style={{
            width: 28,
            height: 28,
            marginLeft: -8,
            background: 'var(--color-bg-spotlight)',
            color: 'var(--color-text-secondary)',
            boxShadow: '0 0 0 2px var(--color-bg-container)'
          }}
        >
          +{rest}
        </span>
      )}
    </button>
  )
}

function ToolbarButton({
  onClick,
  title,
  icon,
  label,
  active,
  pulse
}: {
  onClick: () => void
  title: string
  icon: React.ReactNode
  label: string
  active?: boolean
  pulse?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs hover-spotlight"
      style={{ color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)' }}
    >
      {icon}
      <span>{label}</span>
      {pulse && (
        <span
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: 'var(--color-warning)' }}
        />
      )}
    </button>
  )
}

/** 消息流渲染单元：消息（含聚合标记）/ 连续工具调用组 / 时间分组 pill */
type FeedItem =
  | { kind: 'message'; msg: Message; grouped: boolean }
  | { kind: 'tools'; msgs: Message[] }
  | { kind: 'time'; id: string; label: string }

const TIME_GROUP_GAP_MS = 5 * 60_000

/** 时间分组标签：今天 HH:mm / 昨天 HH:mm / MM-DD HH:mm */
function timeGroupLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return hm
  if (t >= startOfToday - 86_400_000) return `昨天 ${hm}`
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

/** 构建消息流：>5 分钟插入时间 pill；同 Agent 连续消息聚合（仅首条带头像名字，
 *  飞书模式）；相邻同 agent 工具消息聚合为折叠组（Claude.ai 模式）。 */
function buildFeed(messages: Message[]): FeedItem[] {
  const items: FeedItem[] = []
  let lastTs: number | null = null
  let prevMsg: Message | null = null

  for (const msg of messages) {
    // 时间分组（thinking/tool 等过程消息也参与计时，pill 只插在可见间隔处）
    const ts = msg.rawTimestamp ? new Date(msg.rawTimestamp).getTime() : NaN
    let timeInserted = false
    if (!Number.isNaN(ts)) {
      if (lastTs === null || ts - lastTs > TIME_GROUP_GAP_MS) {
        const label = timeGroupLabel(msg.rawTimestamp!)
        if (label) {
          items.push({ kind: 'time', id: `time_${msg.id}`, label })
          timeInserted = true
        }
      }
      lastTs = ts
    }

    if (msg.type === 'tool') {
      const last = items[items.length - 1]
      if (last && last.kind === 'tools' && last.msgs[0].agentRole === msg.agentRole) {
        last.msgs.push(msg)
      } else {
        items.push({ kind: 'tools', msgs: [msg] })
      }
      prevMsg = msg
      continue
    }

    // 连续聚合：同 type（agent/user）且同 agent 身份、未被时间 pill 或其它类型隔断
    const groupable = msg.type === 'agent' || msg.type === 'user'
    const grouped =
      groupable &&
      !timeInserted &&
      prevMsg !== null &&
      prevMsg.type === msg.type &&
      prevMsg.agentRole === msg.agentRole &&
      prevMsg.agentName === msg.agentName
    items.push({ kind: 'message', msg, grouped })
    prevMsg = msg
  }
  return items
}

/** 历史消息分页：滚动区顶部的"加载更早"入口 */
function LoadOlderButton({ onLoad }: { onLoad: () => void }): React.JSX.Element | null {
  const activeId = useAppStore((s) => s.activeConversationId)
  const hasMore = useAppStore((s) => (activeId ? s.hasMoreHistory[activeId] : false))
  const loading = useAppStore((s) => s.loadingHistory)

  if (!hasMore) return null

  return (
    <div className="flex justify-center pb-2">
      <button
        onClick={onLoad}
        disabled={loading}
        className="text-[11px] px-3 py-1 rounded-full border-none cursor-pointer hover-spotlight"
        style={{
          background: 'var(--color-bg-spotlight)',
          color: 'var(--color-text-secondary)'
        }}
      >
        {loading ? '加载中…' : '加载更早的消息'}
      </button>
    </div>
  )
}

/** Agent 工作中指示器（会话 running 且没有正在流式输出的气泡时显示）。
 *  绑定当前 running 任务的角色，多 Agent 协作时可区分谁在工作。 */
function WorkingIndicator({ role, name }: { role?: string; name?: string }): React.JSX.Element {
  const roleColor = getRoleColor(role ?? 'orchestrator')
  return (
    <div className="flex items-start gap-2.5 px-4 my-2 animate-fade-in">
      <Avatar role={role ?? 'orchestrator'} size="sm" className="mt-0.5" />
      <div className="min-w-0">
        {name && (
          <div className="text-xs font-semibold mb-1" style={{ color: roleColor }}>
            {name}
          </div>
        )}
        <div
          className="flex items-center gap-1.5 px-3.5 py-3 rounded-lg"
          style={{
            background: 'var(--color-bg-container)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px var(--radius-bubble) var(--radius-bubble) var(--radius-bubble)',
            boxShadow: `0 0 16px ${roleColor}22`
          }}
        >
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  )
}

/** 空态：品牌光斑背景 + 6 角色色轨道编队 + 引导卡片 */
const ORBIT_ROLES = ['orchestrator', 'planner', 'coder', 'reviewer', 'preview', 'deployer']

function EmptyState(): React.JSX.Element {
  return (
    <div
      className="flex-1 flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      {/* 品牌色光斑（仅品牌触点允许渐变/光效） */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 420,
          height: 420,
          top: '8%',
          left: '14%',
          background: 'radial-gradient(circle, var(--color-brand) 0%, transparent 65%)',
          opacity: 0.1,
          filter: 'blur(8px)'
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: 360,
          height: 360,
          bottom: '6%',
          right: '10%',
          background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 65%)',
          opacity: 0.1,
          filter: 'blur(8px)'
        }}
      />

      <div className="text-center relative z-10 px-8">
        {/* 多 Agent 轨道编队：中心 Logo + 角色色圆点缓慢旋转 */}
        <div className="relative w-36 h-36 mx-auto mb-6">
          <div
            className="absolute inset-0 rounded-full"
            style={{ border: '1px dashed var(--color-border)' }}
          />
          <div className="absolute inset-0" style={{ animation: 'orbitSpin 24s linear infinite' }}>
            {ORBIT_ROLES.map((role, i) => {
              const angle = (i / ORBIT_ROLES.length) * 2 * Math.PI
              return (
                <span
                  key={role}
                  className="absolute w-2.5 h-2.5 rounded-full"
                  style={{
                    background: getRoleColor(role),
                    left: `calc(50% + ${Math.cos(angle) * 72}px - 5px)`,
                    top: `calc(50% + ${Math.sin(angle) * 72}px - 5px)`,
                    boxShadow: `0 0 8px ${getRoleColor(role)}66`
                  }}
                />
              )
            })}
          </div>
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'var(--gradient-brand)',
              boxShadow: '0 4px 16px rgba(37, 99, 235, 0.35)'
            }}
          >
            <MessageCircle size={24} color="#fff" />
          </div>
        </div>

        <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          多 Agent 协作工作台
        </p>
        <p className="text-xs mt-1.5 mb-7" style={{ color: 'var(--color-text-secondary)' }}>
          选择或新建一个会话，让 AI 团队为你工作
        </p>

        {/* 引导卡片 */}
        <div className="flex items-stretch justify-center gap-3">
          <button
            onClick={() => useAppStore.getState().setNewProjectOpen(true)}
            className="card-hover w-40 p-4 rounded-xl text-left cursor-pointer"
            style={{
              background: 'var(--color-bg-container)',
              border: '1px solid var(--color-border-light)'
            }}
          >
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg mb-2.5"
              style={{ background: 'var(--gradient-brand)' }}
            >
              <FolderPlus size={15} color="#fff" />
            </span>
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              新建项目会话
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              关联本地项目，组建 Agent 群
            </div>
          </button>
          <div
            className="card-hover w-40 p-4 rounded-xl text-left"
            style={{
              background: 'var(--color-bg-container)',
              border: '1px solid var(--color-border-light)'
            }}
          >
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg mb-2.5"
              style={{ background: 'var(--color-brand-bg)' }}
            >
              <AtSign size={15} style={{ color: 'var(--color-brand)' }} />
            </span>
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              @Agent 直达
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              @coder 改这里、@reviewer 审查
            </div>
          </div>
          <div
            className="card-hover w-40 p-4 rounded-xl text-left"
            style={{
              background: 'var(--color-bg-container)',
              border: '1px solid var(--color-border-light)'
            }}
          >
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg mb-2.5"
              style={{ background: 'var(--color-brand-bg)' }}
            >
              <SquareSlash size={15} style={{ color: 'var(--color-brand)' }} />
            </span>
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              / 快捷命令
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              /plan 出方案、/tasks 看进度
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow(): React.JSX.Element {
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const messagesMap = useAppStore((s) => s.messages)
  const tasksMap = useAppStore((s) => s.tasks)
  const messages = useMemo(
    () => (activeId ? (messagesMap[activeId] ?? []) : []),
    [activeId, messagesMap]
  )
  const activeDiff = useAppStore((s) => s.activeDiff)
  const previewUrl = useAppStore((s) => s.previewUrl)
  const groupPanelOpen = useAppStore((s) => s.groupPanelOpen)
  const gitPanelOpen = useAppStore((s) => s.gitPanelOpen)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  const toggleTask = (): void => useAppStore.getState().toggleTaskPanel()
  const toggleDiff = (): void => useAppStore.getState().toggleDiffPanel()
  const togglePreview = (): void => useAppStore.getState().togglePreviewPanel()
  const toggleGroup = (): void => useAppStore.getState().toggleGroupPanel()
  const toggleGit = (): void => useAppStore.getState().toggleGitPanel()

  const conv = conversations.find((c) => c.id === activeId)

  // 智能滚动：仅当用户停留在底部附近时跟随新消息，向上翻阅历史不被拽回
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // 切换会话时回到底部
  useEffect(() => {
    nearBottomRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeId])

  // 加载更早消息：prepend 后恢复滚动锚点，视口内容不跳动
  const handleLoadOlder = useCallback(async () => {
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const prevTop = el?.scrollTop ?? 0
    await useAppStore.getState().loadOlderMessages()
    requestAnimationFrame(() => {
      const node = scrollRef.current
      if (node) node.scrollTop = node.scrollHeight - prevHeight + prevTop
    })
  }, [])

  if (!activeId) {
    return <EmptyState />
  }

  const feed = buildFeed(messages)
  const lastMsg = messages[messages.length - 1]
  const lastToolRunning =
    lastMsg?.type === 'tool' && (lastMsg.toolStatus ?? 'running') === 'running'
  const showWorking = conv?.status === 'running' && !lastMsg?.streaming && !lastToolRunning
  const runningTask = (activeId ? (tasksMap[activeId] ?? []) : []).find(
    (t) => t.status === 'running'
  )

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--color-bg-layout)' }}>
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          background: 'var(--color-bg-container)',
          borderBottom: '1px solid var(--color-border-light)'
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {conv?.title}
          </span>
          {conv?.projectName && <Badge variant="ghost">{conv.projectName}</Badge>}
          {conv?.status === 'running' && (
            <Badge variant="brand" size="sm">
              运行中
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <MemberStack />
          <div className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={toggleGroup}
              title="群设置"
              icon={<Users size={14} />}
              label="群设置"
              active={groupPanelOpen}
            />
            <ToolbarButton
              onClick={toggleTask}
              title="任务面板"
              icon={<ListTodo size={14} />}
              label="任务"
            />
            <ToolbarButton
              onClick={toggleGit}
              title="工作区文件变更与提交历史"
              icon={<Files size={14} />}
              label="文件"
              active={gitPanelOpen}
            />
            {activeDiff && (
              <ToolbarButton
                onClick={toggleDiff}
                title="Diff 查看"
                icon={<GitBranch size={14} />}
                label="Diff"
                active={activeDiff.status === 'pending'}
                pulse={activeDiff.status === 'pending'}
              />
            )}
            <ToolbarButton
              onClick={togglePreview}
              title="预览"
              icon={<Monitor size={14} />}
              label="预览"
              pulse={!!previewUrl}
            />
          </div>
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4 px-4">
        <LoadOlderButton onLoad={handleLoadOlder} />
        {feed.map((item) => {
          if (item.kind === 'tools') {
            return <ToolCallGroup key={item.msgs[0].id} msgs={item.msgs} />
          }
          if (item.kind === 'time') {
            return (
              <div key={item.id} className="flex justify-center my-3">
                <span className="time-pill tabular-nums">{item.label}</span>
              </div>
            )
          }
          return <MessageBubble key={item.msg.id} msg={item.msg} grouped={item.grouped} />
        })}
        {showWorking && (
          <WorkingIndicator
            role={runningTask?.agentRole}
            name={runningTask ? getRoleLabel(runningTask.agentRole) : undefined}
          />
        )}
      </div>

      <AgentStatusBar />
      <MessageInput />
    </div>
  )
}
