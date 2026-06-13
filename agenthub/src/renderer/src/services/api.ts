import { getJson, postJson } from './http'
import type { Agent, Conversation, Message, Task, DiffRecord, Approval } from '../types'

// 后端 DTO 与前端 types 仅在时间字段上有差异：ConversationOut.lastTime 与
// MessageOut.timestamp 为 ISO 8601 字符串，需在本层格式化为 HH:mm 后再入 store，
// 以保持组件零改动。其余字段（含 DiffOut.files、ApprovalOut）形状已对齐 camelCase。
type ConversationDTO = Omit<Conversation, 'lastTime'> & { lastTime: string }
type MessageDTO = Omit<Message, 'timestamp'> & { timestamp: string }

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })
}

/** 智能时间：今天 HH:mm / 昨天 / MM-DD（会话列表用） */
export function formatSmartTime(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return formatTime(iso)
  if (t >= startOfToday - 86_400_000) return '昨天'
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function adaptConversation(dto: ConversationDTO): Conversation {
  return { ...dto, lastTime: formatTime(dto.lastTime), rawTime: dto.lastTime }
}

function adaptMessage(dto: MessageDTO): Message {
  return { ...dto, timestamp: formatTime(dto.timestamp), rawTimestamp: dto.timestamp }
}

// ---- 会话 ----
export async function getConversations(): Promise<Conversation[]> {
  const list = await getJson<ConversationDTO[]>('/conversations')
  return list.map(adaptConversation)
}

export async function createConversation(
  title: string,
  projectName: string,
  projectPath?: string | null,
  memberAgentIds?: string[]
): Promise<Conversation> {
  const dto = await postJson<ConversationDTO>('/conversations', {
    title,
    projectName,
    ...(projectPath ? { projectPath } : {}),
    ...(memberAgentIds?.length ? { memberAgentIds } : {})
  })
  return adaptConversation(dto)
}

export async function updateConversation(
  conversationId: string,
  data: {
    title?: string
    pinned?: boolean
    archived?: boolean
    memberAgentIds?: string[]
    rules?: string
    settings?: Record<string, unknown>
  }
): Promise<Conversation> {
  const res = await fetch(
    `${(await import('./http')).getServerBaseUrl()}/api/v1/conversations/${conversationId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  )
  if (!res.ok) throw new Error(`PATCH /conversations/${conversationId} ${res.status}`)
  return adaptConversation((await res.json()) as ConversationDTO)
}

// ---- 消息 ----
export async function getMessages(
  conversationId: string,
  options?: { limit?: number; before?: string }
): Promise<Message[]> {
  const params = new URLSearchParams({ limit: String(options?.limit ?? 100) })
  if (options?.before) params.set('before', options.before)
  const list = await getJson<MessageDTO[]>(
    `/conversations/${conversationId}/messages?${params.toString()}`
  )
  return list.map(adaptMessage)
}

// ---- 会话控制 ----
export async function stopConversation(conversationId: string): Promise<{ stopped: boolean }> {
  return postJson<{ stopped: boolean }>(`/conversations/${conversationId}/stop`)
}

export async function rollbackConversation(
  conversationId: string,
  messageId: string
): Promise<{ deleted: number }> {
  return postJson<{ deleted: number }>(`/conversations/${conversationId}/rollback`, {
    messageId
  })
}

export interface ContextUsage {
  usedTokens: number
  windowTokens: number
  pressureLevel: number
}

export async function getContextUsage(conversationId: string): Promise<ContextUsage> {
  return getJson<ContextUsage>(`/conversations/${conversationId}/context`)
}

// ---- 任务 ----
export async function getTasks(conversationId: string): Promise<Task[]> {
  return getJson<Task[]>(`/conversations/${conversationId}/tasks`)
}

export async function retryTask(taskId: string): Promise<Task> {
  return postJson<Task>(`/tasks/${taskId}/retry`)
}

// ---- Diff ----
export async function getDiff(conversationId: string): Promise<DiffRecord | null> {
  return getJson<DiffRecord | null>(`/conversations/${conversationId}/diff`)
}

export async function approveDiff(diffId: string): Promise<DiffRecord> {
  return postJson<DiffRecord>(`/diffs/${diffId}/approve`)
}

export async function rejectDiff(diffId: string): Promise<DiffRecord> {
  return postJson<DiffRecord>(`/diffs/${diffId}/reject`)
}

// ---- 审批 ----
export async function getApproval(conversationId: string): Promise<Approval | null> {
  return getJson<Approval | null>(`/conversations/${conversationId}/approval`)
}

/** 会话内全部待决审批（支持多 Agent 并发、向导式逐题确认） */
export async function getApprovals(conversationId: string): Promise<Approval[]> {
  return getJson<Approval[]>(`/conversations/${conversationId}/approvals`)
}

export async function resolveApproval(
  approvalId: string,
  decision: 'approved' | 'rejected'
): Promise<Approval> {
  return postJson<Approval>(`/approvals/${approvalId}/resolve`, {
    approved: decision === 'approved'
  })
}

// ---- Git 面板（只读，404 = workspace 尚未创建） ----
export interface GitStatusFile {
  staged: string
  unstaged: string
  path: string
}

export interface GitStatus {
  available: boolean
  error?: string
  branch?: string
  files?: GitStatusFile[]
  clean?: boolean
}

export interface GitCommit {
  hash: string
  author: string
  date: string
  subject: string
}

export interface GitDiff {
  available: boolean
  error?: string
  diff: string
}

export async function getGitStatus(conversationId: string): Promise<GitStatus> {
  return getJson<GitStatus>(`/conversations/${conversationId}/git/status`)
}

export async function getGitDiff(conversationId: string): Promise<GitDiff> {
  return getJson<GitDiff>(`/conversations/${conversationId}/git/diff`)
}

export async function getGitLog(conversationId: string): Promise<GitCommit[]> {
  return getJson<GitCommit[]>(`/conversations/${conversationId}/git/log`)
}

// ---- Agent ----
export async function getAgents(): Promise<Agent[]> {
  return getJson<Agent[]>('/agents')
}

export async function createAgent(data: {
  name: string
  role: string
  description?: string
  skills?: string
  group?: string
  adapterType?: string
  model?: string
  providerConfig?: { baseUrl: string; authToken: string }
}): Promise<Agent> {
  return postJson<Agent>('/agents', data)
}

export async function updateAgent(
  agentId: string,
  data: {
    name?: string
    role?: string
    description?: string
    skills?: string
    group?: string
    adapterType?: string
    model?: string
    providerConfig?: { baseUrl: string; authToken: string }
    enabled?: boolean
  }
): Promise<Agent> {
  const url = `/agents/${agentId}`
  const res = await fetch(`${(await import('./http')).getServerBaseUrl()}/api/v1${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
  return JSON.parse(text) as Agent
}
