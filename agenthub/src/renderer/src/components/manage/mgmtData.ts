import { useEffect, useRef, useSyncExternalStore } from 'react'
import { t } from '../../i18n'

// ----------------------------------------------------------------------------
// 管理中心数据层（前端本地存储 mock）—— 对齐 MiMo-Code / opencode 的资源模型。
// MCP / 技能库 / 规则 三类资源暂无后端接口，先以 localStorage 持久化，
// UI 与交互完整可用；后续接后端时只需替换 createCollection / checkMcpHealth 的实现。
// ----------------------------------------------------------------------------

// ---- MCP -------------------------------------------------------------------
/** 连接方式：本地进程(stdio) / 远程服务(http|sse) —— 对齐 opencode 的 local|remote */
export type McpKind = 'local' | 'remote'
/** 真状态机：连接中 / 已连接 / 失败 / 已禁用 / 需授权 / 需注册 */
export type McpStatus =
  | 'pending'
  | 'connected'
  | 'failed'
  | 'disabled'
  | 'needs_auth'
  | 'needs_client_registration'

export interface McpServer {
  id: string
  name: string
  /** 库级启用开关：禁用后该服务整体不可用 */
  enabled: boolean
  kind: McpKind
  /** local：命令与参数（每行一个 token，首行为可执行文件） */
  command: string
  /** local：环境变量（KEY=VALUE，每行一个） */
  environment: string
  /** remote：服务地址 */
  url: string
  /** remote：请求头（KEY=VALUE，每行一个） */
  headers: string
  /** remote：启用 OAuth 自动鉴权 */
  oauth: boolean
  /** 请求超时(ms)，留空使用默认 */
  timeout?: number
  description: string
  status: McpStatus
  /** status 为 failed 时的错误信息 */
  statusError?: string
  /** 最近探活时间（ISO） */
  lastChecked?: string
}

// ---- Skill -----------------------------------------------------------------
/** 技能文件夹中的单个文件（符合 Agent Skills 标准：SKILL.md + 附加文件） */
export interface SkillFile {
  path: string
  content: string
}

/** 技能来源（只读，创建/导入时确定）：手动创建 / 本地文件夹导入 / 远程 URL 导入 */
export type SkillOrigin = 'manual' | 'local' | 'remote'

export interface SkillItem {
  id: string
  name: string
  enabled: boolean
  category: string
  description: string
  /** 技能文件夹：至少含 SKILL.md，可附加脚本 / 参考 / 资源等（path 支持 "scripts/run.sh" 形式的嵌套） */
  files: SkillFile[]
  /** 技能来源（只读）：对齐 opencode skills.paths|urls */
  origin: SkillOrigin
  /** 来源引用：local=本地文件夹路径，remote=URL；manual 时为空 */
  originRef?: string
}

// ---- Rule ------------------------------------------------------------------
/** 规则类型：指令文件(markdown) / 工具权限(ask/allow/deny) */
export type RuleKind = 'instruction' | 'permission'
export type PermissionAction = 'ask' | 'allow' | 'deny'
/** 可配置权限的工具集合（对齐 opencode permission） */
export const PERMISSION_TOOLS = [
  'read',
  'edit',
  'bash',
  'webfetch',
  'websearch',
  'codesearch'
] as const
export type PermissionTool = (typeof PERMISSION_TOOLS)[number]

export interface RuleItem {
  id: string
  name: string
  enabled: boolean
  kind: RuleKind
  description: string
  /** instruction：markdown 正文（注入会话指令） */
  content: string
  /** permission：工具 -> 动作 */
  permissions: Record<string, PermissionAction>
}

export function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function lines(v: string): string[] {
  return v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

// ---- MCP JSON 解析 / 序列化（opencode mcp 格式，兼容 mcpServers）--------------
function recordToLines(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${typeof val === 'string' ? val : JSON.stringify(val)}`)
      .join('\n')
  }
  return str(v)
}

function linesToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || !t.includes('=')) continue
    const idx = t.indexOf('=')
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim()
  }
  return out
}

interface ParsedMcp {
  name: string
  kind: McpKind
  command: string
  environment: string
  url: string
  headers: string
  oauth: boolean
  timeout?: number
  description: string
}

function isServerLike(e: Record<string, unknown>): boolean {
  return 'type' in e || 'command' in e || 'url' in e
}

/** 把任意输入收敛成 { name, entry } 列表；兼容 {mcp}、{mcpServers}、单条、数组、name->config 映射 */
function collectEntries(parsed: unknown): { name: string; e: Record<string, unknown> }[] {
  const out: { name: string; e: Record<string, unknown> }[] = []
  if (Array.isArray(parsed)) {
    for (const it of parsed) {
      if (it && typeof it === 'object') {
        const r = it as Record<string, unknown>
        out.push({ name: str(r.name, 'mcp'), e: r })
      }
    }
    return out
  }
  if (parsed && typeof parsed === 'object') {
    const rec = parsed as Record<string, unknown>
    const map =
      rec.mcp && typeof rec.mcp === 'object'
        ? (rec.mcp as Record<string, unknown>)
        : rec.mcpServers && typeof rec.mcpServers === 'object'
          ? (rec.mcpServers as Record<string, unknown>)
          : null
    if (map) {
      for (const [name, e] of Object.entries(map)) {
        if (e && typeof e === 'object') out.push({ name, e: e as Record<string, unknown> })
      }
      return out
    }
    if (isServerLike(rec)) {
      out.push({ name: str(rec.name, 'mcp'), e: rec })
      return out
    }
    for (const [name, e] of Object.entries(rec)) {
      if (e && typeof e === 'object') out.push({ name, e: e as Record<string, unknown> })
    }
  }
  return out
}

function entryToParsed(name: string, e: Record<string, unknown>): ParsedMcp {
  const type = str(e.type)
  const hasCommand = e.command !== undefined
  const kind: McpKind =
    type === 'remote' || type === 'http' || type === 'streamable-http' || type === 'sse'
      ? 'remote'
      : type === 'local' || type === 'stdio' || hasCommand
        ? 'local'
        : e.url !== undefined
          ? 'remote'
          : 'local'
  const command = Array.isArray(e.command)
    ? e.command.map((x) => String(x)).join('\n')
    : str(e.command)
  return {
    name,
    kind,
    command,
    environment: recordToLines(e.environment ?? e.env),
    url: str(e.url),
    headers: recordToLines(e.headers),
    oauth: e.oauth !== undefined && e.oauth !== false,
    timeout: typeof e.timeout === 'number' ? e.timeout : undefined,
    description: str(e.description)
  }
}

/** 单条服务 -> opencode mcp 内层配置对象 */
function mcpInner(s: McpServer): Record<string, unknown> {
  const inner: Record<string, unknown> = {}
  if (s.kind === 'local') {
    inner.type = 'local'
    inner.command = lines(s.command)
    const env = linesToRecord(s.environment)
    if (Object.keys(env).length) inner.environment = env
  } else {
    inner.type = 'remote'
    inner.url = s.url
    const h = linesToRecord(s.headers)
    if (Object.keys(h).length) inner.headers = h
    if (s.oauth) inner.oauth = {}
  }
  if (!s.enabled) inner.enabled = false
  if (typeof s.timeout === 'number') inner.timeout = s.timeout
  if (s.description) inner.description = s.description
  return inner
}

/** 把整库 MCP 序列化成 opencode 标准 { mcp: { name: {...} } } JSON */
export function serializeMcpRepo(servers: McpServer[]): string {
  const out: Record<string, unknown> = {}
  for (const s of servers) out[s.name || 'server'] = mcpInner(s)
  return JSON.stringify({ mcp: out }, null, 2)
}

/**
 * 解析整库 MCP JSON，返回完整服务列表（按名字保留原 id / enabled）。
 * JSON 非法时返回 null（与「空仓库」区分）。
 */
export function parseMcpRepo(raw: string, existing: McpServer[]): McpServer[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const byName = new Map(existing.map((srv) => [srv.name, srv]))
  return collectEntries(parsed).map(({ name, e }) => {
    const p = entryToParsed(name, e)
    const prev = byName.get(name)
    const enabled = e.enabled === false ? false : (prev?.enabled ?? true)
    return {
      id: prev?.id ?? newId(),
      name,
      enabled,
      kind: p.kind,
      command: p.command,
      environment: p.environment,
      url: p.url,
      headers: p.headers,
      oauth: p.oauth,
      timeout: p.timeout,
      description: p.description,
      status: (enabled ? 'pending' : 'disabled') as McpStatus
    }
  })
}

/** 解析导入文本（兼容标准格式），返回不含 id 的服务列表（用于批量新增） */
export function parseMcpImport(raw: string): Omit<McpServer, 'id'>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  return collectEntries(parsed).map(({ name, e }) => {
    const p = entryToParsed(name, e)
    const enabled = e.enabled !== false
    return {
      name,
      enabled,
      kind: p.kind,
      command: p.command,
      environment: p.environment,
      url: p.url,
      headers: p.headers,
      oauth: p.oauth,
      timeout: p.timeout,
      description: p.description,
      status: (enabled ? 'pending' : 'disabled') as McpStatus
    }
  })
}

/**
 * 探活（mock）：后端就绪后替换为真实握手请求（@modelcontextprotocol/sdk 客户端）。
 * 现以配置完整性 + 模拟延迟近似真状态机。
 */
export function checkMcpHealth(s: McpServer): Promise<{ status: McpStatus; error?: string }> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (s.kind === 'local') {
        const cmd = lines(s.command)
        resolve(
          cmd.length > 0
            ? { status: 'connected' }
            : { status: 'failed', error: t('manage.data.cmdEmpty') }
        )
        return
      }
      const url = s.url.trim()
      if (!/^https?:\/\//.test(url)) {
        resolve({ status: 'failed', error: t('manage.data.urlInvalid') })
        return
      }
      if (s.oauth) {
        resolve({ status: 'needs_auth' })
        return
      }
      resolve({ status: 'connected' })
    }, 600)
  })
}

// ---- 迁移：兼容旧版本 localStorage 数据 ------------------------------------
function migrateMcp(r: Record<string, unknown>): McpServer {
  const hasNew = r.kind === 'local' || r.kind === 'remote'
  const kind: McpKind = hasNew
    ? (r.kind as McpKind)
    : r.transport === 'sse' || r.transport === 'http'
      ? 'remote'
      : 'local'

  let command = str(r.command)
  if (!hasNew && kind === 'local') {
    const argLines = str(r.args) ? lines(str(r.args)) : []
    command = [command, ...argLines].filter(Boolean).join('\n')
  }

  const enabled = r.enabled !== false
  const rawStatus = r.status
  const mappedStatus: McpStatus =
    rawStatus === 'connected' ||
    rawStatus === 'pending' ||
    rawStatus === 'failed' ||
    rawStatus === 'needs_auth' ||
    rawStatus === 'needs_client_registration'
      ? rawStatus
      : rawStatus === 'online'
        ? 'connected'
        : rawStatus === 'offline'
          ? 'failed'
          : 'pending'

  return {
    id: str(r.id) || newId(),
    name: str(r.name),
    enabled,
    kind,
    command,
    environment: str(r.environment) || str(r.env),
    url: str(r.url),
    headers: str(r.headers),
    oauth: r.oauth === true || (!!r.oauth && typeof r.oauth === 'object'),
    timeout: typeof r.timeout === 'number' ? r.timeout : undefined,
    description: str(r.description),
    status: enabled ? mappedStatus : 'disabled',
    statusError: str(r.statusError) || undefined,
    lastChecked: typeof r.lastChecked === 'string' ? r.lastChecked : undefined
  }
}

function migrateSkill(r: Record<string, unknown>): SkillItem {
  let files: SkillFile[] = []
  if (Array.isArray(r.files)) {
    files = r.files
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({ path: str(f.path, 'untitled'), content: str(f.content) }))
  }
  if (files.length === 0) {
    files = [{ path: 'SKILL.md', content: str(r.content) }]
  }
  if (!files.some((f) => f.path.toLowerCase() === 'skill.md')) {
    files.unshift({ path: 'SKILL.md', content: '' })
  }
  // 来源：优先新字段 origin，其次由旧 url/path 推导，默认手动创建
  const legacyPath = str(r.path)
  const legacyUrl = str(r.url)
  const rawOrigin = r.origin
  const origin: SkillOrigin =
    rawOrigin === 'local' || rawOrigin === 'remote' || rawOrigin === 'manual'
      ? rawOrigin
      : legacyUrl
        ? 'remote'
        : legacyPath
          ? 'local'
          : 'manual'
  const originRef =
    str(r.originRef) ||
    (origin === 'remote' ? legacyUrl : origin === 'local' ? legacyPath : '') ||
    undefined
  return {
    id: str(r.id) || newId(),
    name: str(r.name),
    enabled: r.enabled !== false,
    category: str(r.category),
    description: str(r.description),
    files,
    origin,
    originRef: origin === 'manual' ? undefined : originRef
  }
}

/** 从本地路径或 URL 推导一个默认技能名（取末段、去扩展名） */
function deriveSkillName(ref?: string): string {
  if (!ref) return t('manage.data.newSkill')
  const trimmed = ref
    .trim()
    .replace(/[#?].*$/, '')
    .replace(/[/\\]+$/, '')
  const seg = trimmed.split(/[/\\]/).pop() || trimmed
  return seg.replace(/\.[^.]+$/, '') || t('manage.data.newSkill')
}

/** 创建一个新技能（仅含 SKILL.md）；origin 决定来源徽标，originRef 记录路径/URL。 */
export function newSkill(
  origin: SkillOrigin = 'manual',
  originRef?: string,
  name?: string
): SkillItem {
  const ref = origin === 'manual' ? undefined : originRef?.trim() || undefined
  return {
    id: newId(),
    name: name?.trim() || (origin === 'manual' ? t('manage.data.newSkill') : deriveSkillName(ref)),
    enabled: true,
    category: '',
    description: '',
    origin,
    originRef: ref,
    files: [{ path: 'SKILL.md', content: '' }]
  }
}

/** 解析技能导入文本（单个对象或数组）；复用 migrateSkill 归一化文件与来源。 */
export function parseSkillImport(raw: string): SkillItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((r) => {
      const sk = migrateSkill({ ...r, id: undefined })
      return sk.name ? sk : { ...sk, name: t('manage.data.importSkill') }
    })
}

function migrateRule(r: Record<string, unknown>): RuleItem {
  const permissions: Record<string, PermissionAction> = {}
  if (r.permissions && typeof r.permissions === 'object') {
    for (const [k, v] of Object.entries(r.permissions as Record<string, unknown>)) {
      if (v === 'ask' || v === 'allow' || v === 'deny') permissions[k] = v
    }
  }
  return {
    id: str(r.id) || newId(),
    name: str(r.name),
    enabled: r.enabled !== false,
    kind: r.kind === 'permission' ? 'permission' : 'instruction',
    description: str(r.description),
    content: str(r.content),
    permissions
  }
}

// ---- Collection ------------------------------------------------------------
interface Collection<T extends { id: string }> {
  subscribe: (listener: () => void) => () => void
  get: () => T[]
  add: (item: T) => void
  update: (id: string, patch: Partial<T>) => void
  remove: (id: string) => void
  /** 整体替换（用于整库 JSON 应用） */
  set: (items: T[]) => void
}

function createCollection<T extends { id: string }>(
  key: string,
  seed: T[],
  migrate?: (raw: Record<string, unknown>) => T
): Collection<T> {
  const listeners = new Set<() => void>()
  let data: T[] = (() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const arr = JSON.parse(raw) as unknown[]
        if (Array.isArray(arr)) {
          return migrate
            ? arr
                .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
                .map(migrate)
            : (arr as T[])
        }
      }
    } catch {
      /* ignore */
    }
    return seed
  })()

  const persist = (): void => {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l())
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => data,
    add(item) {
      data = [item, ...data]
      persist()
    },
    update(id, patch) {
      data = data.map((d) => (d.id === id ? { ...d, ...patch } : d))
      persist()
    },
    remove(id) {
      data = data.filter((d) => d.id !== id)
      persist()
    },
    set(items) {
      data = items
      persist()
    }
  }
}

export const mcpStore = createCollection<McpServer>(
  'ah:mgmt:mcp:v2',
  [
    {
      id: 'seed-mcp-fs',
      name: 'filesystem',
      enabled: true,
      kind: 'local',
      command: 'npx\n-y\n@modelcontextprotocol/server-filesystem\n.',
      environment: '',
      url: '',
      headers: '',
      oauth: false,
      description: t('manage.data.seedMcpDesc'),
      status: 'pending'
    }
  ],
  migrateMcp
)

export const skillStore = createCollection<SkillItem>(
  'ah:mgmt:skills:v2',
  [
    {
      id: 'seed-skill-review',
      name: t('manage.data.seedSkillName'),
      enabled: true,
      category: t('manage.data.seedSkillCategory'),
      description: t('manage.data.seedSkillDesc'),
      origin: 'manual',
      files: [
        {
          path: 'SKILL.md',
          content: t('manage.data.seedSkillContent')
        }
      ]
    }
  ],
  migrateSkill
)

export const ruleStore = createCollection<RuleItem>(
  'ah:mgmt:rules:v2',
  [
    {
      id: 'seed-rule-style',
      name: t('manage.data.seedRuleStyleName'),
      enabled: true,
      kind: 'instruction',
      description: t('manage.data.seedRuleStyleDesc'),
      content: t('manage.data.seedRuleStyleContent'),
      permissions: {}
    },
    {
      id: 'seed-rule-perm',
      name: t('manage.data.seedRulePermName'),
      enabled: true,
      kind: 'permission',
      description: t('manage.data.seedRulePermDesc'),
      content: '',
      permissions: { bash: 'ask', edit: 'ask', webfetch: 'allow' }
    }
  ],
  migrateRule
)

// ----------------------------------------------------------------------------
// 群聊选择语义：'all'（缺省/全选，新资源自动生效）或明确的 id 列表
// ----------------------------------------------------------------------------
export type Selection = 'all' | string[]

export function isSelected(sel: Selection | undefined, id: string): boolean {
  if (sel === undefined || sel === 'all') return true
  return sel.includes(id)
}

export function selectionCount(sel: Selection | undefined, total: number): number {
  if (sel === undefined || sel === 'all') return total
  return sel.length
}

/** 切换某 id 的选中态；若结果覆盖全部 id 则归一化为 'all'，否则返回按库顺序排列的 id 列表。 */
export function toggleSelection(
  sel: Selection | undefined,
  id: string,
  allIds: string[]
): Selection {
  const current =
    sel === undefined || sel === 'all'
      ? new Set(allIds)
      : new Set(sel.filter((i) => allIds.includes(i)))
  if (current.has(id)) current.delete(id)
  else current.add(id)
  if (current.size === allIds.length && allIds.every((i) => current.has(i))) return 'all'
  return allIds.filter((i) => current.has(i))
}

function useCollection<T extends { id: string }>(store: Collection<T>): T[] {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useMcpServers(): McpServer[] {
  return useCollection(mcpStore)
}

export function useSkills(): SkillItem[] {
  return useCollection(skillStore)
}

export function useRules(): RuleItem[] {
  return useCollection(ruleStore)
}

// ---- MCP 状态展示与自动探活（非组件，供管理中心各编辑器复用）-------------------
export const MCP_STATUS: Record<McpStatus, { labelKey: string; color: string }> = {
  pending: { labelKey: 'manage.status.pending', color: 'var(--color-brand)' },
  connected: { labelKey: 'manage.status.connected', color: 'var(--color-success)' },
  failed: { labelKey: 'manage.status.failed', color: 'var(--color-error)' },
  disabled: { labelKey: 'manage.status.disabled', color: 'var(--color-text-tertiary)' },
  needs_auth: { labelKey: 'manage.status.needs_auth', color: 'var(--color-warning)' },
  needs_client_registration: {
    labelKey: 'manage.status.needs_client_registration',
    color: 'var(--color-warning)'
  }
}

/** 请求重测：置为 pending，由 useMcpAutoCheck 统一探活 */
export function requestMcpCheck(server: McpServer): void {
  if (server.enabled) mcpStore.update(server.id, { status: 'pending' })
}

/**
 * 自动探活 + 状态校正：
 * - 禁用的服务 -> disabled；重新启用 -> pending
 * - pending 的服务自动探活，落定为 connected/failed/needs_auth 等
 * 配置变更时编辑器会把 status 重置为 pending，从而自动重测。
 */
export function useMcpAutoCheck(): void {
  const servers = useMcpServers()
  const running = useRef<Set<string>>(new Set())
  useEffect(() => {
    servers.forEach((srv) => {
      if (!srv.enabled) {
        if (srv.status !== 'disabled') mcpStore.update(srv.id, { status: 'disabled' })
        return
      }
      if (srv.status === 'disabled') {
        mcpStore.update(srv.id, { status: 'pending' })
        return
      }
      if (srv.status === 'pending' && !running.current.has(srv.id)) {
        running.current.add(srv.id)
        void checkMcpHealth(srv).then((r) => {
          mcpStore.update(srv.id, {
            status: r.status,
            statusError: r.error,
            lastChecked: new Date().toISOString()
          })
          running.current.delete(srv.id)
        })
      }
    })
  }, [servers])
}
