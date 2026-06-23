import { deleteJson, getJson, patchJson, postJson } from './http'
import { t as translate } from '../i18n'
import type {
  Agent,
  Conversation,
  Message,
  Task,
  DiffRecord,
  Approval,
  Deployment,
  ProviderConfigMap,
  ProviderScan
} from '../types'

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
  if (t >= startOfToday - 86_400_000) return translate('common.yesterday')
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
  const dto = await patchJson<ConversationDTO>(`/conversations/${conversationId}`, data)
  return adaptConversation(dto)
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await deleteJson(`/conversations/${conversationId}`)
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

/** 计划确认门禁（Phase 1b）：批准/拒绝待执行的 pipeline 任务计划 */
export async function confirmPlan(
  conversationId: string,
  approved: boolean
): Promise<{ ok: boolean; approved: boolean }> {
  return postJson<{ ok: boolean; approved: boolean }>(
    `/conversations/${conversationId}/plan/confirm`,
    { approved }
  )
}

/** 计划修改门禁（A）：提交修改意见，后端取消旧计划并据此重新规划 */
export async function revisePlan(
  conversationId: string,
  feedback: string
): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`/conversations/${conversationId}/plan/revise`, { feedback })
}

export async function rollbackConversation(
  conversationId: string,
  messageId: string
): Promise<{ deleted: number }> {
  return postJson<{ deleted: number }>(`/conversations/${conversationId}/rollback`, {
    messageId
  })
}

// ---- 计划（spec-driven · Spec Kit 三件套 + 合并版，item 2）----
export interface PlanFile {
  name: string
  path: string
  size: number
  mtime: string
}

/** 列出该会话的计划文件（无 workspace 时返回 []） */
export async function listPlans(conversationId: string): Promise<PlanFile[]> {
  return getJson<PlanFile[]>(`/conversations/${conversationId}/plans`)
}

/** 读取单个计划文件内容（路径限定在 plans 根内） */
export async function getPlanFile(
  conversationId: string,
  path: string
): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ path })
  return getJson<{ path: string; content: string }>(
    `/conversations/${conversationId}/plans/file?${params.toString()}`
  )
}

/** 保存单个计划文件（文件级逐条编辑落盘） */
export async function savePlanFile(
  conversationId: string,
  path: string,
  content: string
): Promise<{ ok: boolean; path: string }> {
  return patchJson<{ ok: boolean; path: string }>(`/conversations/${conversationId}/plans/file`, {
    path,
    content
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

/** 按 id 取单条 diff（审查界面按 approval.diffId 联动拉取历史会话的关联 diff） */
export async function getDiffById(diffId: string): Promise<DiffRecord> {
  return getJson<DiffRecord>(`/diffs/${diffId}`)
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

// ---- 工作区文件浏览（只读 Explorer，404 = workspace 尚未创建） ----
export interface WsTreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  children?: WsTreeNode[]
  truncated?: boolean
}

export interface WsFileContent {
  path: string
  content: string
  size: number
  binary: boolean
  truncated?: boolean
  tooLarge?: boolean
}

export async function getWorkspaceTree(conversationId: string): Promise<WsTreeNode> {
  return getJson<WsTreeNode>(`/conversations/${conversationId}/workspace/tree`)
}

export async function getWorkspaceFile(
  conversationId: string,
  path: string
): Promise<WsFileContent> {
  return getJson<WsFileContent>(
    `/conversations/${conversationId}/workspace/file?path=${encodeURIComponent(path)}`
  )
}

// ---- 预览（dev server 启停） ----
export interface PreviewStartResult {
  previewUrl: string
  port: number
  projectType: string
}

export async function startPreview(conversationId: string): Promise<PreviewStartResult> {
  return postJson<PreviewStartResult>(`/conversations/${conversationId}/preview/start`)
}

export async function stopPreview(conversationId: string): Promise<{ stopped: boolean }> {
  return postJson<{ stopped: boolean }>(`/conversations/${conversationId}/preview/stop`)
}

// ---- 部署：创建计划（可选 provider/config）→ 审批（人工确认）→ 后台执行 ----
export async function createDeployment(
  conversationId: string,
  opts?: { provider?: string; config?: Record<string, unknown> }
): Promise<Deployment> {
  return postJson<Deployment>(`/conversations/${conversationId}/deployments`, opts)
}

/** 审批部署：approved=true 执行模拟部署并返回 success 记录；false 置为 rejected */
export async function decideDeployment(
  deploymentId: string,
  approved: boolean
): Promise<Deployment> {
  return postJson<Deployment>(`/deployments/${deploymentId}/approve`, { approved })
}

export async function getDeployment(deploymentId: string): Promise<Deployment> {
  return getJson<Deployment>(`/deployments/${deploymentId}`)
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
  providerConfig?: ProviderConfigMap
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
    providerConfig?: ProviderConfigMap
    enabled?: boolean
  }
): Promise<Agent> {
  return patchJson<Agent>(`/agents/${agentId}`, data)
}

/** 扫描本地 codex / claude-code 配置，供「默认」供应商模式回显检测到的供应商。 */
export async function scanProvider(adapter: string): Promise<ProviderScan> {
  return getJson<ProviderScan>(`/agents/provider-scan?adapter=${encodeURIComponent(adapter)}`)
}
