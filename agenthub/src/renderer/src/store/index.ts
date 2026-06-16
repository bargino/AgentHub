import { create } from 'zustand'
import type {
  Conversation,
  Message,
  Task,
  DiffRecord,
  Approval,
  Agent,
  AgentRole,
  RightTab
} from '../types'
import * as api from '../services/api'
import { formatTime } from '../services/api'
import {
  wsClient,
  type MsgAttachment,
  type WsServerFrame,
  type WsStatus
} from '../services/websocket'
import { notify, notifyEvent } from '../services/notify'
import { t } from '../i18n'

const APPROVAL_ACTION_KEYS: Record<string, string> = {
  apply_diff: 'approval.action.apply_diff',
  run_command: 'approval.action.run_command',
  install_dependency: 'approval.action.install_dependency',
  deploy: 'approval.action.deploy'
}

export type PageType = 'chat' | 'agents' | 'manage' | 'settings'

interface AppState {
  activePage: PageType
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Record<string, Message[]>
  tasks: Record<string, Task[]>
  agents: Agent[]
  activeDiff: DiffRecord | null
  /** diff 缓存（id -> DiffRecord）：审查界面按 approval.diffId 联动展示，避免单实例被覆盖 */
  diffsById: Record<string, DiffRecord>
  /** 会话内全部待决审批（按创建时间升序），支持多 Agent 并发审查 */
  pendingApprovals: Approval[]
  previewUrl: string | null
  draftMessage: string | null
  /** 引用回复目标（发送时拼为 Markdown 引用块前缀） */
  replyingTo: Message | null
  /** 右侧停靠区当前 tab（单实例 + tab 切换，消除横向挤压）；null = 收起 */
  rightTab: RightTab | null
  groupPanelOpen: boolean
  /** 新建项目弹窗（会话列表 + 聊天空态引导卡共用） */
  newProjectOpen: boolean
  /** 当前会话上下文用量（执行一轮结束后刷新） */
  contextUsage: api.ContextUsage | null
  /** 瞬时错误（SDK 重试中）：输入框上方悬浮提示，恢复出新内容/收尾时自清 */
  transientError: { cid: string; reason: string } | null
  wsStatus: WsStatus
  /** 后端桥最近一次结构化失败原因（python 解析失败 / 超重启上限等） */
  bridgeError: string | null

  /** 是否可能还有更早的历史消息（按上次拉取是否满页推断） */
  hasMoreHistory: Record<string, boolean>
  loadingHistory: boolean

  loadConversations: () => Promise<void>
  loadAgents: () => Promise<void>
  setActiveConversation: (id: string) => Promise<void>
  loadOlderMessages: () => Promise<void>
  sendMessage: (content: string, attachments?: MsgAttachment[]) => Promise<void>
  stopGeneration: () => Promise<void>
  rollbackTo: (messageId: string) => Promise<void>
  refreshContextUsage: () => Promise<void>
  approveDiff: () => Promise<void>
  rejectDiff: () => Promise<void>
  /** 按 id 确保 diff 已在缓存（审查界面联动 apply_diff 审批的关联 diff） */
  ensureDiff: (diffId: string) => Promise<void>
  /** 决策单条审批：直接 resolve（释放 agent 阻塞 + 级联 diff 状态），乐观移除 */
  decideApproval: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>
  /** 批量决策多条审批（P3 批量通过/拒绝） */
  decideApprovals: (approvalIds: string[], decision: 'approved' | 'rejected') => Promise<void>
  createConversation: (
    title: string,
    projectName: string,
    projectPath?: string | null,
    memberAgentIds?: string[]
  ) => Promise<void>
  updateConversation: (
    id: string,
    data: {
      title?: string
      pinned?: boolean
      archived?: boolean
      memberAgentIds?: string[]
      rules?: string
      settings?: Record<string, unknown>
    }
  ) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setReplyingTo: (msg: Message | null) => void
  setNewProjectOpen: (open: boolean) => void
  setActivePage: (page: PageType) => void
  /** 切换右侧 tab：传入当前 tab 则收起（toggle 语义）；切 tab 自动收起群设置 */
  setRightTab: (tab: RightTab | null) => void
  toggleGroupPanel: () => void
}

/** 解析会话的有效群成员（memberAgentIds 空 = 全员 enabled Agent） */
export function resolveMembers(conv: Conversation | undefined, agents: Agent[]): Agent[] {
  const enabled = agents.filter((a) => a.enabled)
  const ids = conv?.memberAgentIds ?? []
  if (ids.length === 0) return enabled
  return enabled.filter((a) => ids.includes(a.id))
}

const now = (): string => formatTime(new Date().toISOString())

export const useAppStore = create<AppState>((set, get) => ({
  activePage: 'chat',
  conversations: [],
  activeConversationId: null,
  messages: {},
  tasks: {},
  agents: [],
  activeDiff: null,
  diffsById: {},
  pendingApprovals: [],
  previewUrl: null,
  draftMessage: null,
  bridgeError: null,
  replyingTo: null,
  rightTab: null,
  groupPanelOpen: false,
  newProjectOpen: false,
  contextUsage: null,
  transientError: null,
  wsStatus: 'disconnected',
  hasMoreHistory: {},
  loadingHistory: false,

  loadConversations: async () => {
    const convs = await api.getConversations()
    set({ conversations: convs })
  },

  loadAgents: async () => {
    const agents = await api.getAgents()
    set({ agents })
  },

  setActiveConversation: async (id) => {
    // 保持多会话订阅（接收未读/状态更新）；消息按会话分桶 + 全局态有 cid 过滤，不会串台
    set((s) => ({
      activeConversationId: id,
      activeDiff: null,
      diffsById: {},
      pendingApprovals: [],
      replyingTo: null,
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    }))
    wsClient.subscribe(id)
    await resyncConversation(id)
  },

  loadOlderMessages: async () => {
    const { activeConversationId, messages, loadingHistory, hasMoreHistory } = get()
    const cid = activeConversationId
    if (!cid || loadingHistory || hasMoreHistory[cid] === false) return
    const current = messages[cid] ?? []
    const oldest = current[0]
    if (!oldest) return
    set({ loadingHistory: true })
    try {
      const older = await api.getMessages(cid, { limit: 100, before: oldest.id })
      set((s) => ({
        messages: { ...s.messages, [cid]: [...older, ...(s.messages[cid] ?? [])] },
        hasMoreHistory: { ...s.hasMoreHistory, [cid]: older.length >= 100 },
        loadingHistory: false
      }))
    } catch {
      set({ loadingHistory: false })
    }
  },

  sendMessage: async (content, attachments) => {
    const { activeConversationId, agents, conversations } = get()
    if (!activeConversationId) return

    // @提及只在当前群成员（空 = 全员）中解析角色，与后端路由口径一致
    const conv = conversations.find((c) => c.id === activeConversationId)
    const knownRoles = new Set(resolveMembers(conv, agents).map((a) => a.role))
    const match = content.match(/@([\w-]+)/)
    const targetAgent = match && knownRoles.has(match[1]) ? (match[1] as AgentRole) : undefined

    // 乐观插入用户消息，临时 id 待 message.completed 事件替换；附件用 data URL 展示缩略图
    appendMessage(activeConversationId, {
      id: `temp_${Date.now()}`,
      conversationId: activeConversationId,
      type: 'user',
      content,
      timestamp: now(),
      rawTimestamp: new Date().toISOString(),
      ...(attachments && attachments.length ? { attachments } : {})
    })

    const result = await wsClient.sendMessage(
      activeConversationId,
      content,
      targetAgent,
      attachments
    )
    if (!result.ok) {
      appendErrorMessage(activeConversationId, result.reason)
      notify.error(t('store.sendFailed'), result.reason)
    }
  },

  stopGeneration: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId) return
    try {
      await api.stopConversation(activeConversationId)
    } catch {
      appendErrorMessage(activeConversationId, t('store.stopFailed'))
    }
  },

  rollbackTo: async (messageId) => {
    const { activeConversationId } = get()
    const cid = activeConversationId
    if (!cid) return
    try {
      await api.rollbackConversation(cid, messageId)
      // 回退后重拉消息与任务，恢复干净状态
      const [msgs, tasks] = await Promise.all([
        api.getMessages(cid, { limit: 100 }),
        api.getTasks(cid)
      ])
      set((s) => ({
        messages: { ...s.messages, [cid]: msgs },
        tasks: { ...s.tasks, [cid]: tasks },
        hasMoreHistory: { ...s.hasMoreHistory, [cid]: msgs.length >= 100 },
        replyingTo: null
      }))
    } catch {
      appendErrorMessage(cid, t('store.rollbackFailed'))
    }
  },

  refreshContextUsage: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId) {
      set({ contextUsage: null })
      return
    }
    try {
      const usage = await api.getContextUsage(activeConversationId)
      set({ contextUsage: usage })
    } catch {
      set({ contextUsage: null })
    }
  },

  approveDiff: async () => {
    const { activeDiff } = get()
    if (!activeDiff) return
    const diff = await api.approveDiff(activeDiff.id)
    set((s) => ({ activeDiff: diff, diffsById: { ...s.diffsById, [diff.id]: diff } }))
  },

  rejectDiff: async () => {
    const { activeDiff } = get()
    if (!activeDiff) return
    const diff = await api.rejectDiff(activeDiff.id)
    set((s) => ({ activeDiff: diff, diffsById: { ...s.diffsById, [diff.id]: diff } }))
  },

  ensureDiff: async (diffId) => {
    if (!diffId || get().diffsById[diffId]) return
    try {
      const diff = await api.getDiffById(diffId)
      set((s) => ({ diffsById: { ...s.diffsById, [diff.id]: diff } }))
    } catch {
      /* 关联 diff 拉取失败：审查界面降级为仅摘要展示 */
    }
  },

  decideApproval: async (approvalId, decision) => {
    await get().decideApprovals([approvalId], decision)
  },

  decideApprovals: async (approvalIds, decision) => {
    const { pendingApprovals, activeConversationId } = get()
    const ids = approvalIds.filter((id) => pendingApprovals.some((a) => a.id === id))
    if (ids.length === 0) return
    const submitted: string[] = []
    try {
      // 逐条 REST 决策：后端落库 + 回传适配器解除该任务阻塞，approval.resolved 事件回灌
      for (const id of ids) {
        await api.resolveApproval(id, decision)
        submitted.push(id)
      }
    } catch {
      if (activeConversationId)
        appendErrorMessage(activeConversationId, t('store.approvalSubmitFailed'))
    }
    if (submitted.length > 0) {
      // 乐观移除已提交项（approval.resolved 事件亦会幂等清理）
      set((s) => ({
        pendingApprovals: s.pendingApprovals.filter((a) => !submitted.includes(a.id))
      }))
    }
  },

  createConversation: async (title, projectName, projectPath, memberAgentIds) => {
    const conv = await api.createConversation(title, projectName, projectPath, memberAgentIds)
    set((s) => ({ conversations: [conv, ...s.conversations] }))
    await get().setActiveConversation(conv.id)
  },

  updateConversation: async (id, data) => {
    const conv = await api.updateConversation(id, data)
    if (data.archived) {
      // 归档：移出列表并退出当前会话
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        groupPanelOpen: false
      }))
      return
    }
    set((s) => {
      let next = s.conversations.map((c) => (c.id === id ? { ...c, ...conv } : c))
      // 置顶状态变化：本地重排与服务端排序口径一致（pinned 优先，组内保持原相对顺序）
      if (data.pinned !== undefined) {
        next = [...next.filter((c) => c.pinned), ...next.filter((c) => !c.pinned)]
      }
      return { conversations: next }
    })
  },

  deleteConversation: async (id) => {
    await api.deleteConversation(id)
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id)
      const messages = { ...s.messages }
      delete messages[id]
      return {
        conversations,
        messages,
        activeConversationId:
          s.activeConversationId === id ? (conversations[0]?.id ?? null) : s.activeConversationId,
        groupPanelOpen: false
      }
    })
  },

  setReplyingTo: (msg) => set({ replyingTo: msg }),
  setNewProjectOpen: (open) => set({ newProjectOpen: open }),
  setActivePage: (page) => set({ activePage: page }),
  // 右侧停靠区单实例：切 tab（再次点击当前 tab 收起），并互斥关闭群设置
  setRightTab: (tab) =>
    set((s) => ({ rightTab: s.rightTab === tab ? null : tab, groupPanelOpen: false })),
  toggleGroupPanel: () => set((s) => ({ groupPanelOpen: !s.groupPanelOpen, rightTab: null }))
}))

function appendMessage(conversationId: string, msg: Message): void {
  useAppStore.setState((s) => {
    const prev = s.messages[conversationId] ?? []
    return { messages: { ...s.messages, [conversationId]: [...prev, msg] } }
  })
}

// 会话全量重拉（REST 真相源）：用于打开会话与断线重连补帧。桥模式无 WS 事件重放，
// 重连后用一次 REST 重拉对齐断连期间错过的消息/任务/diff/审批，避免界面停留在过期状态。
async function resyncConversation(id: string): Promise<void> {
  const store = useAppStore.getState()
  try {
    const [msgs, tasks, diff, approvals] = await Promise.all([
      api.getMessages(id, { limit: 100 }),
      api.getTasks(id),
      api.getDiff(id),
      api.getApprovals(id)
    ])
    useAppStore.setState((s) => ({
      messages: { ...s.messages, [id]: msgs },
      tasks: { ...s.tasks, [id]: tasks },
      activeDiff: diff,
      diffsById: diff ? { [diff.id]: diff } : {},
      pendingApprovals: approvals,
      hasMoreHistory: { ...s.hasMoreHistory, [id]: msgs.length >= 100 }
    }))
    // 补拉待决审批关联的 diff（历史会话重开时 getDiff 仅返回最新一条，无法覆盖全部）
    for (const a of approvals) {
      if (a.diffId) void store.ensureDiff(a.diffId)
    }
    void store.refreshContextUsage()
  } catch (err) {
    notify.error(
      t('store.loadConvFailed'),
      err instanceof Error ? err.message : t('errors.engineReady')
    )
  }
}

function appendErrorMessage(conversationId: string, content: string): void {
  appendMessage(conversationId, {
    id: `err_${Date.now()}`,
    conversationId,
    type: 'error',
    content,
    timestamp: now()
  })
}

// 用服务端消息替换乐观插入的临时用户消息：匹配最近一条同 content 的 temp_ 消息，
// 命中则原位替换，否则按 id upsert（兼容重复投递）
function replaceOptimisticOrUpsert(conversationId: string, msg: Message): void {
  useAppStore.setState((s) => {
    const prev = s.messages[conversationId] ?? []
    if (prev.some((m) => m.id === msg.id)) {
      return {
        messages: { ...s.messages, [conversationId]: prev.map((m) => (m.id === msg.id ? msg : m)) }
      }
    }
    if (msg.type === 'user') {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i]
        if (m.id.startsWith('temp_') && m.type === 'user' && m.content === msg.content) {
          const next = [...prev]
          // 保留乐观消息的图片附件（data URL）：后端消息不带可直接展示的 url
          next[i] = { ...msg, attachments: msg.attachments ?? m.attachments }
          return { messages: { ...s.messages, [conversationId]: next } }
        }
      }
    }
    return { messages: { ...s.messages, [conversationId]: [...prev, msg] } }
  })
}

interface DeltaData {
  messageId: string
  agentRole?: AgentRole
  agentName?: string
  content: string
  /** answer=正文（默认） / thinking=思考过程 */
  kind?: 'answer' | 'thinking'
}

function handleWsEvent(frame: WsServerFrame): void {
  const { activeConversationId } = useAppStore.getState()
  const cid = frame.conversationId

  switch (frame.type) {
    case 'message.completed': {
      if (!cid) return
      const m = (frame.data as { message: Message }).message
      // 任务产出新内容 = 瞬时错误已恢复，自动清除悬浮提示（不污染上下文）
      useAppStore.setState((s) => (s.transientError?.cid === cid ? { transientError: null } : s))
      // 用户消息：替换乐观插入的临时消息；其余按 id upsert（流式 delta 落库去重）
      replaceOptimisticOrUpsert(cid, {
        ...m,
        timestamp: formatTime(m.timestamp),
        rawTimestamp: m.timestamp,
        streaming: false
      })
      // 非激活会话的可见消息累计未读（thinking/tool 等过程消息不计）
      if (cid !== activeConversationId && (m.type === 'agent' || m.type === 'error')) {
        useAppStore.setState((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === cid ? { ...c, unread: (c.unread ?? 0) + 1 } : c
          )
        }))
      }
      return
    }
    case 'message.delta': {
      if (!cid) return
      const d = frame.data as DeltaData
      // 流式恢复 = 瞬时错误已过，清除悬浮提示
      useAppStore.setState((s) => (s.transientError?.cid === cid ? { transientError: null } : s))
      const msgType = d.kind === 'thinking' ? 'thinking' : 'agent'
      useAppStore.setState((s) => {
        const prev = s.messages[cid] ?? []
        const idx = prev.findIndex((mm) => mm.id === d.messageId)
        const base: Message =
          idx >= 0
            ? prev[idx]
            : {
                id: d.messageId,
                conversationId: cid,
                type: msgType,
                content: '',
                timestamp: now(),
                rawTimestamp: new Date().toISOString()
              }
        const merged: Message = {
          ...base,
          type: msgType,
          content: d.content,
          streaming: true,
          agentRole: d.agentRole ?? base.agentRole,
          agentName: d.agentName ?? base.agentName
        }
        const next = idx >= 0 ? prev.map((mm, i) => (i === idx ? merged : mm)) : [...prev, merged]
        return { messages: { ...s.messages, [cid]: next } }
      })
      return
    }
    case 'agent.transient_error': {
      if (!cid) return
      const d = frame.data as { error?: string }
      // 瞬时错误：仅悬浮提示，不入消息流/上下文；恢复出新内容或收尾时自清
      useAppStore.setState({ transientError: { cid, reason: d.error || '' } })
      return
    }
    case 'diff.generated': {
      const diff = (frame.data as { diff: DiffRecord }).diff
      if (cid && cid === activeConversationId) {
        // 进审查 tab 并缓存（与 apply_diff 审批联动统一审查界面）
        useAppStore.setState((s) => ({
          activeDiff: diff,
          diffsById: { ...s.diffsById, [diff.id]: diff },
          rightTab: 'review',
          groupPanelOpen: false
        }))
      }
      return
    }
    case 'approval.required': {
      const approval = (frame.data as { approval: Approval }).approval
      if (cid && cid === activeConversationId) {
        // 不再强抢右栏 tab（避免打断用户当前编辑/阅读）：仅入队待审批，靠审查 tab 的
        // 角标计数 + 工具栏脉冲 + toast/桌面通知三重提示，由用户自行决定何时去审查。
        useAppStore.setState((s) =>
          s.pendingApprovals.some((a) => a.id === approval.id)
            ? s
            : { pendingApprovals: [...s.pendingApprovals, approval] }
        )
        // apply_diff 审批：联动拉取关联 diff 供审查界面内联展示
        if (approval.diffId) void useAppStore.getState().ensureDiff(approval.diffId)
      }
      // 无论是否当前会话都提醒：切走窗口时补桌面通知，避免错过需确认的审批
      const who = approval.agentName ?? approval.agentRole ?? 'Agent'
      const action = APPROVAL_ACTION_KEYS[approval.actionType]
        ? t(APPROVAL_ACTION_KEYS[approval.actionType])
        : approval.actionType
      notifyEvent(
        'approval',
        t('store.approvalNotifyTitle'),
        t('store.approvalNotifyBody', { who, action, summary: approval.summary }),
        'info'
      )
      return
    }
    case 'approval.resolved': {
      // data 可能是 {approval}（动作审批）和/或 {diff}（apply_diff 级联）：均幂等处理
      const data = frame.data as { approval?: Approval; diff?: DiffRecord }
      if (data.approval) {
        const resolvedId = data.approval.id
        useAppStore.setState((s) => ({
          pendingApprovals: s.pendingApprovals.filter((a) => a.id !== resolvedId)
        }))
      }
      if (data.diff) {
        const d = data.diff
        useAppStore.setState((s) => ({
          diffsById: { ...s.diffsById, [d.id]: d },
          activeDiff: s.activeDiff && s.activeDiff.id === d.id ? d : s.activeDiff
        }))
      }
      return
    }
    case 'approval.resolve_failed': {
      // 审批已落库但 adapter 无法解除（服务重启/超时）：明确告知用户，杜绝「以为通过了」
      // 的静默分叉。关联任务的 failed 状态由随附的 task.status.changed 事件更新。
      const d = frame.data as { reason?: string }
      notifyEvent(
        'approval',
        t('store.approvalResolveFailedTitle'),
        d.reason ?? t('store.approvalResolveFailedBody'),
        'error'
      )
      return
    }
    case 'conversation.updated': {
      const conv = (frame.data as { conversation: Conversation }).conversation
      useAppStore.setState((s) => {
        const exists = s.conversations.some((c) => c.id === conv.id)
        // 非激活会话保留本地未读计数（服务端 unread 恒 0）
        const local = s.conversations.find((c) => c.id === conv.id)
        const merged = {
          ...conv,
          lastTime: formatTime(conv.lastTime),
          rawTime: conv.lastTime,
          unread: conv.id === s.activeConversationId ? 0 : (local?.unread ?? 0)
        }
        // 一轮执行结束（running -> idle）：清残留的流式标记（停止场景无 completed 事件）
        let messages = s.messages
        if (local?.status === 'running' && conv.status !== 'running') {
          const prev = s.messages[conv.id]
          if (prev?.some((m) => m.streaming)) {
            messages = {
              ...s.messages,
              [conv.id]: prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
            }
          }
        }
        return {
          conversations: exists
            ? s.conversations.map((c) => (c.id === conv.id ? { ...c, ...merged } : c))
            : [merged, ...s.conversations],
          messages
        }
      })
      // 一轮执行结束后刷新当前会话上下文用量
      const { activeConversationId: aid } = useAppStore.getState()
      if (conv.id === aid && conv.status !== 'running') {
        void useAppStore.getState().refreshContextUsage()
      }
      return
    }
    case 'task.status.changed': {
      const task = (frame.data as { task: Task }).task
      const tcid = task.conversationId
      let justSucceeded = false
      useAppStore.setState((s) => {
        const prev = s.tasks[tcid] ?? []
        const idx = prev.findIndex((t) => t.id === task.id)
        // 仅在 success 跳变时提醒一次（避免重复投递重复弹窗）
        if (task.status === 'success' && prev[idx]?.status !== 'success') justSucceeded = true
        const next = idx >= 0 ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task]
        return { tasks: { ...s.tasks, [tcid]: next } }
      })
      if (justSucceeded) notifyEvent('taskDone', t('store.taskDone'), task.title, 'success')
      return
    }
    case 'preview.started': {
      const d = frame.data as { previewUrl: string }
      if (cid && cid === activeConversationId) {
        useAppStore.setState({
          previewUrl: d.previewUrl,
          rightTab: 'preview',
          groupPanelOpen: false
        })
      }
      return
    }
    case 'error': {
      const d = frame.data as { error?: string; message?: string }
      const msg = d.error ?? d.message ?? t('errors.unknown')
      const target = cid || activeConversationId
      if (target) appendErrorMessage(target, msg)
      notifyEvent('error', t('store.agentError'), msg, 'error')
      return
    }
    default:
      // file.changed / deploy.* 等暂不直接驱动 UI，忽略
      return
  }
}

// 服务端数据（会话列表 / Agent 注册表）以 ws connected 为加载信号：
// main 进程不阻塞窗口创建，冷启动时 REST 先于后端 ready 必然失败；
// ws 自带指数退避重连，connected 即后端就绪，断线恢复时也会自动补拉
wsClient.onStatusChange((status) => {
  useAppStore.setState({ wsStatus: status })
  if (status !== 'connected') return
  // 连上即后端就绪：清除遗留的桥错误，拉取失败不再静默吞掉而是提示可重试
  useAppStore.setState({ bridgeError: null })
  const store = useAppStore.getState()
  store.loadAgents().catch((err) => {
    notify.error(
      t('store.loadAgentsFailed'),
      err instanceof Error ? err.message : t('errors.retry')
    )
  })
  store
    .loadConversations()
    .then(() => {
      const s = useAppStore.getState()
      if (!s.activeConversationId && s.conversations[0]) {
        void s.setActiveConversation(s.conversations[0].id)
      } else if (s.activeConversationId) {
        // 断线重连补帧：当前会话仍打开时重拉一次，对齐断连期间错过的事件
        void resyncConversation(s.activeConversationId)
      }
    })
    .catch((err) => {
      notify.error(
        t('store.loadConvListFailed'),
        err instanceof Error ? err.message : t('errors.retry')
      )
    })
})
// 桥结构化错误（python 解析失败 / 超重启上限）：入 store 供 ConnectionBar 展示 + 全局 toast
wsClient.onError((reason) => {
  useAppStore.setState({ bridgeError: reason })
  notify.error(t('store.engineError'), reason)
})
wsClient.onEvent(handleWsEvent)
wsClient.connect()
