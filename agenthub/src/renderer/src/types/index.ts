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
/** 右侧工作区单实例 tab：概览 / 任务 / 审查(diff) / 预览 / 部署 / spec / Git */
export type RightTab = 'overview' | 'task' | 'review' | 'preview' | 'deploy' | 'spec' | 'git'

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
    /** 规划期澄清（Phase 1a）：Orchestrator 发问 + 候选项，前端渲染为快捷按钮 */
    clarify?: { question?: string; options: string[]; recommended?: number }
    /** spec 确认门禁（Phase 1b）：pipeline 任务 spec 待用户批准/取消 */
    specConfirm?: { goal?: string; taskCount?: number }
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
  /** EARS 验收标准（Phase 2）：当 X，系统应 Y */
  acceptance?: string
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

export type DeployStatus = 'planned' | 'deploying' | 'success' | 'failed' | 'rejected'

export interface DeployStep {
  name: string
  command: string
}

/** 部署计划（后端 deploy provider build_plan 的形状） */
export interface DeployPlan {
  target: string
  steps: DeployStep[]
  rollback: string
  project: string
  /** 真实 provider 配置不足回退 mock 时的说明（后端写入） */
  fallbackNote?: string
}

/** 部署记录（后端 DeploymentRecord）：创建计划 → 审批 → 执行（mock/docker/remote） */
export interface Deployment {
  id: string
  conversationId: string
  status: DeployStatus
  /** 部署目标 provider：mock（默认）/ docker / remote */
  provider?: string
  plan: DeployPlan
  logs: string
  resultUrl: string | null
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

export type ProviderMode = 'default' | 'custom' | 'profile'

/** 单个适配器的供应商配置。default=走本地 CLI 登录态；custom=内联 baseUrl/authToken；
 *  profile=引用命名供应商档案（profileId）。model 与该适配器供应商绑定（按适配器各自保存）。 */
export interface ProviderConfig {
  mode: ProviderMode
  baseUrl: string
  authToken: string
  model: string
  profileId: string
}

/** 命名供应商档案（参照 cc-switch）：某工具(claude-code/codex)的完整供应商配置，供 Agent 引用。 */
export interface ProviderProfile {
  id: string
  tool: string
  name: string
  config: Record<string, string>
  isPreset: boolean
  sortOrder: number
}

/** 按适配器类型分组的供应商配置（codex / claude-code 各自独立）。 */
export type ProviderConfigMap = Record<string, ProviderConfig>

/** 本地 codex/claude-code 配置扫描结果（默认模式回显检测到的供应商）。 */
export interface ProviderScan {
  adapter: string
  detected: boolean
  baseUrl: string
  model: string
  authSource: string
  configPath: string
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
  providerConfig: ProviderConfigMap
  capabilities: Record<string, unknown>
  enabled: boolean
}
