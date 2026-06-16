export type MessageType = 'user' | 'agent' | 'thinking' | 'system' | 'tool' | 'approval' | 'error'
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'success'
  | 'failed'
  | 'cancelled'
export type AgentRole = string
export type RiskLevel = 'low' | 'medium' | 'high'
/** 右侧停靠区单实例 tab：审查（diff+审批合一）/ 任务 / Git / 预览 */
export type RightTab = 'review' | 'task' | 'git' | 'preview'

export interface Conversation {
  id: string
  title: string
  projectName: string
  projectPath?: string | null
  lastMessage: string
  lastTime: string
  /** 原始 ISO 时间（lastTime 为格式化展示值），供智能时间格式化 */
  rawTime?: string
  status: 'idle' | 'running' | 'waiting_approval'
  unread?: number
  /** 置顶（服务端按 pinned 优先排序） */
  pinned?: boolean
  /** 群聊成员（Agent id），空数组 = 全员 */
  memberAgentIds: string[]
  /** 群规则，注入该会话所有任务指令 */
  rules: string
  /** 会话级设置 { skills: 'all' | string[] | 'off' } */
  settings: Record<string, unknown>
}

export interface Message {
  id: string
  conversationId: string
  type: MessageType
  content: string
  agentRole?: AgentRole
  agentName?: string
  taskId?: string
  timestamp: string
  /** 原始 ISO 时间（timestamp 为格式化展示值），供消息流时间分组 */
  rawTimestamp?: string
  streaming?: boolean
  toolName?: string
  toolStatus?: 'running' | 'success' | 'failed'
  /** 扩展元数据：命令 { exitCode, durationMs, cwd }；思考 { thinkingMs } */
  meta?: {
    exitCode?: number
    durationMs?: number
    cwd?: string
    thinkingMs?: number
  }
  /** 多模态图片附件（前端用 base64 data URL 展示缩略图；当前会话内有效） */
  attachments?: { type: 'image'; url: string; filename?: string }[]
}

export interface Task {
  id: string
  conversationId: string
  title: string
  agentRole: AgentRole
  status: TaskStatus
  dependsOn: string[]
  result?: string
  startedAt?: string
  finishedAt?: string
}

export interface DiffFile {
  filename: string
  additions: number
  deletions: number
  oldContent: string
  newContent: string
}

export interface DiffRecord {
  id: string
  conversationId: string
  taskId: string
  agentId: string
  summary: string
  files: DiffFile[]
  status: 'pending' | 'approved' | 'rejected'
}

export interface Approval {
  id: string
  conversationId: string
  taskId: string
  /** 发起审批的 Agent（前端按 Agent 分组、各组独立提交） */
  agentRole?: string | null
  agentName?: string | null
  actionType: 'apply_diff' | 'run_command' | 'install_dependency' | 'deploy'
  summary: string
  riskLevel: RiskLevel
  status: 'pending' | 'approved' | 'rejected'
  /** 关联的代码变更 Diff（apply_diff 审批联动展示对应 diff）；其它动作为空 */
  diffId?: string | null
}

export interface ProviderConfig {
  baseUrl: string
  authToken: string
}

export interface Agent {
  id: string
  name: string
  role: AgentRole
  description: string
  skills: string
  group: string
  adapterType: string
  model: string
  providerConfig: ProviderConfig
  capabilities: Record<string, unknown>
  enabled: boolean
}
