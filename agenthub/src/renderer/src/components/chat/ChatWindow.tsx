import { useEffect, useRef, useCallback, useMemo } from 'react'
import { MessageCircle, FolderPlus, AtSign, SquareSlash } from 'lucide-react'
import { useAppStore } from '../../store'
import type { Message } from '../../types'
import { MessageBubble } from './MessageBubble'
import { AgentTurnCard } from './AgentTurnCard'
import { MessageInput } from './MessageInput'
import { ConversationHeader } from '../layout/ConversationHeader'
import { useT, t as tFn } from '../../i18n'

/** 消息流渲染单元：消息（含聚合标记）/ 连续工具调用组 / 时间分组 pill */
type FeedItem =
  | { kind: 'message'; msg: Message; grouped: boolean }
  | { kind: 'turn'; id: string; steps: Message[]; answer: Message | null }
  | { kind: 'time'; id: string; label: string }

/** agent 侧消息：思考 / 工具 / 答案，按 turn（一次任务执行）有序聚合 */
const AGENT_SIDE = new Set<Message['type']>(['thinking', 'tool', 'agent'])

function turnKey(m: Message): string {
  return `${m.agentRole ?? ''}|${m.agentName ?? ''}`
}

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
  if (t >= startOfToday - 86_400_000) return tFn('chat.yesterday', { time: hm })
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

/** 构建消息流：>5 分钟插入时间 pill；同 Agent 连续消息聚合（仅首条带头像名字，
 *  飞书模式）；相邻同 agent 工具消息聚合为折叠组（Claude.ai 模式）。 */
/** 构建消息流：
 *  - agent 侧（思考/工具/答案）按 turn 聚合（同 agent、taskId 不冲突的连续段）为 AgentTurnCard，
 *    保留真实时间顺序；turn 内最后一条 agent 答案为主体，其余为「执行过程」步骤。
 *  - user/system/error/approval 作为独立气泡；连续 user 紧凑聚合。
 *  - 相邻 turn / 独立项之间按 >5min 间隔插入时间 pill（turn 内部不插）。 */
function buildFeed(messages: Message[]): FeedItem[] {
  const items: FeedItem[] = []
  let lastTs: number | null = null
  let prevMsg: Message | null = null
  let turn: { key: string; taskId?: string; msgs: Message[] } | null = null

  const flushTurn = (): void => {
    if (!turn) return
    const ms = turn.msgs
    let answerIdx = -1
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i].type === 'agent') {
        answerIdx = i
        break
      }
    }
    const answer = answerIdx >= 0 ? ms[answerIdx] : null
    const steps = answer ? ms.filter((m) => m !== answer) : ms
    items.push({ kind: 'turn', id: `turn_${ms[0].id}`, steps, answer })
    turn = null
  }

  // 仅在新 turn / 独立项开头按间隔插入时间 pill（turn 内部不插）
  const maybeTimePill = (msg: Message, ts: number): boolean => {
    if (Number.isNaN(ts)) return false
    if (lastTs === null || ts - lastTs > TIME_GROUP_GAP_MS) {
      const label = timeGroupLabel(msg.rawTimestamp!)
      if (label) {
        items.push({ kind: 'time', id: `time_${msg.id}`, label })
        return true
      }
    }
    return false
  }

  for (const msg of messages) {
    const ts = msg.rawTimestamp ? new Date(msg.rawTimestamp).getTime() : NaN
    const taskId = msg.taskId
    // turn 归属：带 taskId 的任意消息（含同任务的 system/error），或 agent 侧消息（流式期 taskId 未回填兜底）
    const turnBound = taskId !== undefined || AGENT_SIDE.has(msg.type)

    if (turnBound) {
      const key = turnKey(msg)
      const sameTurn =
        turn !== null &&
        ((taskId !== undefined && turn.taskId === taskId) ||
          (turn.key === key && (turn.taskId === undefined || taskId === undefined)))
      if (sameTurn && turn) {
        turn.msgs.push(msg)
        if (turn.taskId === undefined && taskId !== undefined) turn.taskId = taskId
      } else {
        flushTurn()
        maybeTimePill(msg, ts)
        turn = { key, taskId, msgs: [msg] }
      }
      prevMsg = msg
      if (!Number.isNaN(ts)) lastTs = ts
      continue
    }

    flushTurn()
    const timeInserted = maybeTimePill(msg, ts)
    const grouped =
      msg.type === 'user' && !timeInserted && prevMsg !== null && prevMsg.type === 'user'
    items.push({ kind: 'message', msg, grouped })
    prevMsg = msg
    if (!Number.isNaN(ts)) lastTs = ts
  }
  flushTurn()
  return items
}

/** 历史消息分页：滚动区顶部的"加载更早"入口 */
function LoadOlderButton({ onLoad }: { onLoad: () => void }): React.JSX.Element | null {
  const tr = useT()
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
        {loading ? tr('chat.loading') : tr('chat.loadOlder')}
      </button>
    </div>
  )
}

/** 空态：静态品牌徽标 + 引导卡片（去旋转光环 / 去彩色辉光，方向二·暖中性）。
 *  noSelection：未选会话；noMessages：会话已建但还没消息（去掉「新建项目」卡）。*/
function EmptyState({
  variant = 'noSelection'
}: {
  variant?: 'noSelection' | 'noMessages'
}): React.JSX.Element {
  const tr = useT()
  const isStart = variant === 'noMessages'
  return (
    <div
      className="flex-1 flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      <div className="text-center relative z-10 px-8">
        {/* 静态品牌徽标：中性卡片底 + 细描边，无旋转 / 无辉光 */}
        <div
          className="w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center"
          style={{
            background: 'var(--color-bg-container)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <MessageCircle size={26} style={{ color: 'var(--color-brand)' }} />
        </div>

        <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {tr(isStart ? 'chat.empty.startTitle' : 'chat.empty.title')}
        </p>
        <p className="text-xs mt-1.5 mb-7" style={{ color: 'var(--color-text-secondary)' }}>
          {tr(isStart ? 'chat.empty.startSubtitle' : 'chat.empty.subtitle')}
        </p>

        {/* 引导卡片 */}
        <div className="flex items-stretch justify-center gap-3">
          {!isStart && (
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
                {tr('chat.empty.newProjectTitle')}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {tr('chat.empty.newProjectDesc')}
              </div>
            </button>
          )}
          <div
            className="w-40 p-4 rounded-xl text-left"
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
              {tr('chat.empty.mentionTitle')}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('chat.empty.mentionDesc')}
            </div>
          </div>
          <div
            className="w-40 p-4 rounded-xl text-left"
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
              {tr('chat.empty.slashTitle')}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('chat.empty.slashDesc')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow(): React.JSX.Element {
  const activeId = useAppStore((s) => s.activeConversationId)
  const messagesMap = useAppStore((s) => s.messages)
  const messages = useMemo(
    () => (activeId ? (messagesMap[activeId] ?? []) : []),
    [activeId, messagesMap]
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

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
  const emptyFeed = feed.length === 0

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--color-bg-layout)' }}>
      <ConversationHeader />

      {emptyFeed ? (
        <>
          <EmptyState variant="noMessages" />
          <MessageInput />
        </>
      ) : (
        <>
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4 px-4">
            <LoadOlderButton onLoad={handleLoadOlder} />
            {feed.map((item) => {
              if (item.kind === 'turn') {
                return <AgentTurnCard key={item.id} steps={item.steps} answer={item.answer} />
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
          </div>

          <MessageInput />
        </>
      )}
    </div>
  )
}
