import { create } from 'zustand'
import type { Conversation, Message, Task, DiffRecord, Approval, Agent, AgentRole } from '../types'
import * as api from '../services/api'
import { formatTime } from '../services/api'
import { wsClient, type WsServerFrame, type WsStatus } from '../services/websocket'

export type PageType = 'chat' | 'agents' | 'settings'

interface AppState {
  activePage: PageType
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Record<string, Message[]>
  tasks: Record<string, Task[]>
  agents: Agent[]
  activeDiff: DiffRecord | null
  /** 会话内全部待决审批（按创建时间升序），支持多 Agent 并发逐题确认 */
  pendingApprovals: Approval[]
  /** 暂存的逐题决策（approvalId -> 决策）：向导式先暂存，按 Agent 分组提交 */
  approvalDecisions: Record<string, 'approved' | 'rejected'>
  previewUrl: string | null
  draftMessage: string | null
  /** 引用回复目标（发送时拼为 Markdown 引用块前缀） */
  replyingTo: Message | null
  taskPanelOpen: boolean
  diffPanelOpen: boolean
  previewPanelOpen: boolean
  groupPanelOpen: boolean
  gitPanelOpen: boolean
  /** 新建项目弹窗（会话列表 + 聊天空态引导卡共用） */
  newProjectOpen: boolean
  /** 当前会话上下文用量（执行一轮结束后刷新） */
  contextUsage: api.ContextUsage | null
  wsStatus: WsStatus

  /** 是否可能还有更早的历史消息（按上次拉取是否满页推断） */
  hasMoreHistory: Record<string, boolean>
  loadingHistory: boolean

  loadConversations: () => Promise<void>
  loadAgents: () => Promise<void>
  setActiveConversation: (id: string) => Promise<void>
  loadOlderMessages: () => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopGeneration: () => Promise<void>
  rollbackTo: (messageId: string) => Promise<void>
  refreshContextUsage: () => Promise<void>
  approveDiff: () => Promise<void>
  rejectDiff: () => Promise<void>
  /** 暂存某条审批的决策（不发网络，向导式逐题选择，可回退修改） */
  setApprovalDecision: (approvalId: string, decision: 'approved' | 'rejected') => void
  /** 提交某个 Agent 分组的全部决策（各 Agent 独立提交，互不等待） */
  submitApprovalGroup: (agentKey: string) => Promise<void>
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
  setReplyingTo: (msg: Message | null) => void
  setNewProjectOpen: (open: boolean) => void
  setActivePage: (page: PageType) => void
  toggleTaskPanel: () => void
  toggleDiffPanel: () => void
  togglePreviewPanel: () => void
  toggleGroupPanel: () => void
  toggleGitPanel: () => void
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
  pendingApprovals: [],
  approvalDecisions: {},
  previewUrl: null,
  draftMessage: null,
  replyingTo: null,
  taskPanelOpen: false,
  diffPanelOpen: false,
  previewPanelOpen: false,
  groupPanelOpen: false,
  gitPanelOpen: false,
  newProjectOpen: false,
  contextUsage: null,
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
      pendingApprovals: [],
      approvalDecisions: {},
      replyingTo: null,
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    }))
    wsClient.subscribe(id)
    const [msgs, tasks, diff, approvals] = await Promise.all([
      api.getMessages(id, { limit: 100 }),
      api.getTasks(id),
      api.getDiff(id),
      api.getApprovals(id)
    ])
    set((s) => ({
      messages: { ...s.messages, [id]: msgs },
      tasks: { ...s.tasks, [id]: tasks },
      activeDiff: diff,
      pendingApprovals: approvals,
      hasMoreHistory: { ...s.hasMoreHistory, [id]: msgs.length >= 100 }
    }))
    void get().refreshContextUsage()
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

  sendMessage: async (content) => {
    const { activeConversationId, agents, conversations } = get()
    if (!activeConversationId) return

    // @提及只在当前群成员（空 = 全员）中解析角色，与后端路由口径一致
    const conv = conversations.find((c) => c.id === activeConversationId)
    const knownRoles = new Set(resolveMembers(conv, agents).map((a) => a.role))
    const match = content.match(/@([\w-]+)/)
    const targetAgent = match && knownRoles.has(match[1]) ? (match[1] as AgentRole) : undefined

    // 乐观插入用户消息，临时 id 待 message.created 事件替换
    appendMessage(activeConversationId, {
      id: `temp_${Date.now()}`,
      conversationId: activeConversationId,
      type: 'user',
      content,
      timestamp: now(),
      rawTimestamp: new Date().toISOString()
    })

    const ok = wsClient.sendMessage(activeConversationId, content, targetAgent)
    if (!ok)
      appendErrorMessage(
        activeConversationId,
        'WebSocket 未连接，消息发送失败，请确认 AgentHub Server 已启动'
      )
  },

  stopGeneration: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId) return
    try {
      await api.stopConversation(activeConversationId)
    } catch {
      appendErrorMessage(activeConversationId, '停止失败，请确认 AgentHub Server 已启动')
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
      appendErrorMessage(cid, '回退失败，请确认 AgentHub Server 已启动')
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
    set({ activeDiff: diff })
  },

  rejectDiff: async () => {
    const { activeDiff } = get()
    if (!activeDiff) return
    const diff = await api.rejectDiff(activeDiff.id)
    set({ activeDiff: diff })
  },

  setApprovalDecision: (approvalId, decision) => {
    set((s) => ({ approvalDecisions: { ...s.approvalDecisions, [approvalId]: decision } }))
  },

  submitApprovalGroup: async (agentKey) => {
    const { pendingApprovals, approvalDecisions, activeConversationId } = get()
    const group = pendingApprovals.filter((a) => (a.agentRole ?? '__unknown__') === agentKey)
    if (group.length === 0) return
    const submitted: string[] = []
    try {
      // 逐条 REST 决策：后端落库 + 回传适配器解除该任务阻塞，approval.resolved 事件回灌
      for (const a of group) {
        const decision = approvalDecisions[a.id]
        if (!decision) continue
        await api.resolveApproval(a.id, decision)
        submitted.push(a.id)
      }
    } catch {
      if (activeConversationId)
        appendErrorMessage(activeConversationId, '审批提交失败，请确认 AgentHub Server 已启动')
    }
    if (submitted.length > 0) {
      // 乐观移除已提交项（approval.resolved 事件亦会幂等清理）
      set((s) => {
        const nextDecisions = { ...s.approvalDecisions }
        for (const id of submitted) delete nextDecisions[id]
        return {
          pendingApprovals: s.pendingApprovals.filter((a) => !submitted.includes(a.id)),
          approvalDecisions: nextDecisions
        }
      })
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

  setReplyingTo: (msg) => set({ replyingTo: msg }),
  setNewProjectOpen: (open) => set({ newProjectOpen: open }),
  setActivePage: (page) => set({ activePage: page }),
  // 任务 / 群设置 / 文件三个右侧面板同侧互斥
  toggleTaskPanel: () =>
    set((s) => ({ taskPanelOpen: !s.taskPanelOpen, groupPanelOpen: false, gitPanelOpen: false })),
  toggleDiffPanel: () => set((s) => ({ diffPanelOpen: !s.diffPanelOpen })),
  togglePreviewPanel: () => set((s) => ({ previewPanelOpen: !s.previewPanelOpen })),
  toggleGroupPanel: () =>
    set((s) => ({ groupPanelOpen: !s.groupPanelOpen, taskPanelOpen: false, gitPanelOpen: false })),
  toggleGitPanel: () =>
    set((s) => ({ gitPanelOpen: !s.gitPanelOpen, taskPanelOpen: false, groupPanelOpen: false }))
}))

function appendMessage(conversationId: string, msg: Message): void {
  useAppStore.setState((s) => {
    const prev = s.messages[conversationId] ?? []
    return { messages: { ...s.messages, [conversationId]: [...prev, msg] } }
  })
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
          next[i] = msg
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
    case 'diff.generated': {
      const diff = (frame.data as { diff: DiffRecord }).diff
      if (cid && cid === activeConversationId) {
        useAppStore.setState({ activeDiff: diff, diffPanelOpen: true })
      }
      return
    }
    case 'approval.required': {
      const approval = (frame.data as { approval: Approval }).approval
      if (cid && cid === activeConversationId) {
        useAppStore.setState((s) =>
          s.pendingApprovals.some((a) => a.id === approval.id)
            ? s
            : { pendingApprovals: [...s.pendingApprovals, approval] }
        )
      }
      return
    }
    case 'approval.resolved': {
      // data 可能是 {approval}（动作审批）或 {diff}（Diff 审批），分别处理
      const data = frame.data as { approval?: Approval; diff?: DiffRecord }
      const { activeDiff } = useAppStore.getState()
      if (data.approval) {
        const resolvedId = data.approval.id
        useAppStore.setState((s) => {
          if (!s.pendingApprovals.some((a) => a.id === resolvedId)) return s
          const nextDecisions = { ...s.approvalDecisions }
          delete nextDecisions[resolvedId]
          return {
            pendingApprovals: s.pendingApprovals.filter((a) => a.id !== resolvedId),
            approvalDecisions: nextDecisions
          }
        })
      }
      if (data.diff && activeDiff && activeDiff.id === data.diff.id) {
        useAppStore.setState({ activeDiff: data.diff })
      }
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
      useAppStore.setState((s) => {
        const prev = s.tasks[tcid] ?? []
        const idx = prev.findIndex((t) => t.id === task.id)
        const next = idx >= 0 ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task]
        return { tasks: { ...s.tasks, [tcid]: next } }
      })
      return
    }
    case 'preview.started': {
      const d = frame.data as { previewUrl: string }
      if (cid && cid === activeConversationId) {
        useAppStore.setState({ previewUrl: d.previewUrl, previewPanelOpen: true })
      }
      return
    }
    case 'error': {
      const d = frame.data as { error?: string; message?: string }
      const target = cid || activeConversationId
      if (target) appendErrorMessage(target, d.error ?? d.message ?? '未知错误')
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
  const store = useAppStore.getState()
  store.loadAgents().catch(() => {})
  store
    .loadConversations()
    .then(() => {
      const s = useAppStore.getState()
      if (!s.activeConversationId && s.conversations[0]) {
        void s.setActiveConversation(s.conversations[0].id)
      }
    })
    .catch(() => {})
})
wsClient.onEvent(handleWsEvent)
wsClient.connect()
