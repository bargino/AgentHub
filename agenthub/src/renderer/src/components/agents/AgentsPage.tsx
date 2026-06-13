import { useEffect, useState } from 'react'
import { Bot, Plus, Settings, Power, X, Check, Lock } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { getRoleColor } from '../ui/role'
import { getAgents, updateAgent, createAgent } from '../../services/api'
import { useAppStore } from '../../store'
import type { Agent } from '../../types'

import codexLogo from '../../assets/logos/codex.webp'
import claudeLogo from '../../assets/logos/claude.png'

const ADAPTER_LOGO: Record<string, string> = {
  'claude-code': claudeLogo,
  codex: codexLogo
}

// 内置角色的默认描述（agent.description 为空时回退展示）
const ROLE_DESC: Record<string, string> = {
  orchestrator: '编排中心，自动拆解需求并调度其他 Agent 协作完成任务。',
  planner: '分析项目结构，制定实现方案，输出详细的技术规划。',
  coder: '根据规划执行代码修改、新增功能、修复 Bug，输出可执行的 Diff。',
  reviewer: '对 Coder 输出的代码进行审查，发现潜在问题并提出改进建议。',
  deployer: '将代码构建并部署到目标环境，需用户审批后执行。'
}

const BUILTIN_ROLES = ['planner', 'coder', 'reviewer', 'deployer']
const ADAPTER_TYPES = ['claude-code', 'codex']

// 各适配器的常见模型建议（datalist，可手填任意模型名；空 = SDK 默认模型）
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  'claude-code': ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  codex: ['gpt-5-codex', 'gpt-5', 'o3']
}

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg outline-none border transition-all duration-150 bg-[var(--color-bg-spotlight)] focus:bg-[var(--color-bg-container)] focus:border-[var(--color-brand)]'
const inputStyle = {
  color: 'var(--color-text-primary)',
  borderColor: 'var(--color-border-light)'
} as const

interface AgentFormValue {
  name: string
  role: string
  description: string
  skills: string
  group: string
  adapterType: string
  model: string
  baseUrl: string
  authToken: string
}

function AgentFormFields({
  value,
  onChange,
  roleSuggestions,
  roleLocked,
  autoFocusName
}: {
  value: AgentFormValue
  onChange: (v: AgentFormValue) => void
  roleSuggestions: string[]
  roleLocked: boolean
  autoFocusName?: boolean
}): React.JSX.Element {
  return (
    <>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          名称
        </label>
        <input
          type="text"
          value={value.name}
          autoFocus={autoFocusName}
          placeholder="Agent 名称"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className={inputCls}
          style={inputStyle}
        />
      </div>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          角色标识 {roleLocked && <Lock size={10} className="inline ml-1" />}
        </label>
        <input
          type="text"
          value={value.role}
          disabled={roleLocked}
          placeholder="如 coder、tester、doc-writer（自定义）"
          list="agent-role-suggestions"
          onChange={(e) => onChange({ ...value, role: e.target.value.trim().toLowerCase() })}
          className={inputCls}
          style={{ ...inputStyle, opacity: roleLocked ? 0.6 : 1 }}
        />
        <datalist id="agent-role-suggestions">
          {roleSuggestions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          描述
        </label>
        <textarea
          value={value.description}
          rows={2}
          placeholder="该 Agent 的职责说明，将注入其 system prompt"
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          className={`${inputCls} resize-none`}
          style={inputStyle}
        />
      </div>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          技能
        </label>
        <input
          type="text"
          value={value.skills}
          placeholder="逗号分隔，如 React, 单元测试, SQL 优化"
          onChange={(e) => onChange({ ...value, skills: e.target.value })}
          className={inputCls}
          style={inputStyle}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            分组标签
          </label>
          <input
            type="text"
            value={value.group}
            placeholder="如 core、前端组"
            onChange={(e) => onChange({ ...value, group: e.target.value })}
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div className="flex-1">
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            适配器类型
          </label>
          <select
            value={value.adapterType}
            onChange={(e) => onChange({ ...value, adapterType: e.target.value })}
            className={inputCls}
            style={inputStyle}
          >
            {ADAPTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          模型
        </label>
        <input
          type="text"
          value={value.model}
          placeholder="留空使用 SDK 默认模型"
          list="agent-model-suggestions"
          onChange={(e) => onChange({ ...value, model: e.target.value.trim() })}
          className={inputCls}
          style={inputStyle}
        />
        <datalist id="agent-model-suggestions">
          {(MODEL_SUGGESTIONS[value.adapterType] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <div
        className="flex flex-col gap-3 p-3 rounded-lg"
        style={{
          background: 'var(--color-bg-spotlight)',
          border: '1px dashed var(--color-border-light)'
        }}
      >
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            API 供应商（可选）
          </span>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
            留空走本地 {value.adapterType === 'codex' ? 'Codex' : 'Claude Code'} 登录态；填写后仅该
            Agent 使用此供应商，互不影响
          </p>
        </div>
        <div>
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Base URL
          </label>
          <input
            type="text"
            value={value.baseUrl}
            placeholder={
              value.adapterType === 'codex'
                ? '如 https://api.deepseek.com/v1'
                : '如 https://api.moonshot.cn/anthropic'
            }
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value.trim() })}
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            API Key
          </label>
          <input
            type="password"
            value={value.authToken}
            placeholder="sk-..."
            onChange={(e) => onChange({ ...value, authToken: e.target.value.trim() })}
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>
    </>
  )
}

function ModalShell({
  title,
  onClose,
  children,
  footer
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 100,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)'
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[440px] rounded-xl overflow-hidden animate-menu-pop"
        style={{ boxShadow: 'var(--shadow-float)', background: 'var(--color-bg-container)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md cursor-pointer"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)'
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">{children}</div>
        <div
          className="flex gap-3 px-5 pt-3 pb-4"
          style={{ borderTop: '1px solid var(--color-border-light)' }}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}

function ConfigModal({
  agent,
  roleSuggestions,
  onClose,
  onSaved
}: {
  agent: Agent
  roleSuggestions: string[]
  onClose: () => void
  onSaved: (a: Agent) => void
}): React.JSX.Element {
  const isOrchestrator = agent.role === 'orchestrator'
  const [form, setForm] = useState<AgentFormValue>({
    name: agent.name,
    role: agent.role,
    description: agent.description ?? '',
    skills: agent.skills ?? '',
    group: agent.group ?? '',
    adapterType: agent.adapterType,
    model: agent.model ?? '',
    baseUrl: agent.providerConfig?.baseUrl ?? '',
    authToken: agent.providerConfig?.authToken ?? ''
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim() || !form.role.trim()) return
    setSaving(true)
    try {
      const updated = await updateAgent(agent.id, {
        name: form.name.trim(),
        ...(isOrchestrator ? {} : { role: form.role.trim() }),
        description: form.description.trim(),
        skills: form.skills.trim(),
        group: form.group.trim(),
        adapterType: form.adapterType,
        model: form.model,
        providerConfig: { baseUrl: form.baseUrl, authToken: form.authToken }
      })
      onSaved(updated)
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`配置 ${agent.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)'
            }}
          >
            <X size={15} /> 取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.role.trim()}
            className="btn-brand flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium"
            style={{ opacity: saving || !form.name.trim() || !form.role.trim() ? 0.5 : 1 }}
          >
            <Check size={15} /> 保存
          </button>
        </>
      }
    >
      <AgentFormFields
        value={form}
        onChange={setForm}
        roleSuggestions={roleSuggestions}
        roleLocked={isOrchestrator}
      />
    </ModalShell>
  )
}

function AddAgentModal({
  roleSuggestions,
  onClose,
  onCreated
}: {
  roleSuggestions: string[]
  onClose: () => void
  onCreated: (a: Agent) => void
}): React.JSX.Element {
  const [form, setForm] = useState<AgentFormValue>({
    name: '',
    role: 'coder',
    description: '',
    skills: '',
    group: '',
    adapterType: 'claude-code',
    model: '',
    baseUrl: '',
    authToken: ''
  })
  const [saving, setSaving] = useState(false)

  const canCreate = !!form.name.trim() && !!form.role.trim() && form.role.trim() !== 'orchestrator'

  const handleCreate = async (): Promise<void> => {
    if (!canCreate) return
    setSaving(true)
    try {
      const agent = await createAgent({
        name: form.name.trim(),
        role: form.role.trim(),
        description: form.description.trim(),
        skills: form.skills.trim(),
        group: form.group.trim(),
        adapterType: form.adapterType,
        model: form.model,
        providerConfig: { baseUrl: form.baseUrl, authToken: form.authToken }
      })
      onCreated(agent)
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="添加 Agent"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)'
            }}
          >
            <X size={15} /> 取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="btn-brand flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium"
            style={{ opacity: !canCreate || saving ? 0.5 : 1 }}
          >
            <Plus size={15} /> 创建
          </button>
        </>
      }
    >
      <AgentFormFields
        value={form}
        onChange={setForm}
        roleSuggestions={roleSuggestions}
        roleLocked={false}
        autoFocusName
      />
      {form.role.trim() === 'orchestrator' && (
        <p className="text-xs" style={{ color: 'var(--color-error, #ff4d4f)' }}>
          orchestrator 为系统固定角色，不可新增
        </p>
      )}
    </ModalShell>
  )
}

export function AgentsPage(): React.JSX.Element {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loadError, setLoadError] = useState(false)
  const [configAgent, setConfigAgent] = useState<Agent | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const refreshGlobalAgents = useAppStore((s) => s.loadAgents)

  useEffect(() => {
    getAgents()
      .then((list) => {
        setAgents(list)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
  }, [])

  // 现有角色 + 内置角色作为「角色标识」输入建议
  const roleSuggestions = Array.from(
    new Set([...BUILTIN_ROLES, ...agents.map((a) => a.role).filter((r) => r !== 'orchestrator')])
  )

  const syncGlobal = (): void => {
    refreshGlobalAgents().catch(() => {})
  }

  const handleToggle = async (agent: Agent): Promise<void> => {
    if (agent.role === 'orchestrator') return
    try {
      const updated = await updateAgent(agent.id, { enabled: !agent.enabled })
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      syncGlobal()
    } catch {
      // 静默处理
    }
  }

  const handleSaved = (updated: Agent): void => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    syncGlobal()
  }

  const handleCreated = (agent: Agent): void => {
    setAgents((prev) => [...prev, agent])
    syncGlobal()
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{
          background: 'var(--color-bg-elevated, #fff)',
          borderBottom: '1px solid var(--color-border-light)'
        }}
      >
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Agent 管理
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            查看和配置协作 Agent，支持自定义角色、技能与分组
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-brand flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg"
        >
          <Plus size={14} /> 添加 Agent
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div
            className="text-sm text-center py-12"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            无法连接 AgentHub Server，请确认后端已启动
          </div>
        )}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {agents.map((agent) => {
            const isOrchestrator = agent.role === 'orchestrator'
            const roleColor = getRoleColor(agent.role)
            const skillChips = agent.skills
              ? agent.skills
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 6)
              : []
            return (
              <div
                key={agent.id}
                className="card-hover rounded-lg overflow-hidden"
                style={{
                  background: 'var(--color-bg-elevated, #fff)',
                  border: '1px solid var(--color-border-light)'
                }}
              >
                {/* 角色色渐变带 + 悬浮大头像 */}
                <div
                  style={{
                    height: 32,
                    background: `linear-gradient(135deg, ${roleColor}33 0%, ${roleColor}0d 70%, transparent 100%)`
                  }}
                />
                <div className="px-4 pb-4" style={{ marginTop: -18 }}>
                  <div className="flex items-end justify-between gap-2 mb-2">
                    <span
                      className="rounded-full"
                      style={{
                        padding: 2,
                        background: 'var(--color-bg-elevated, #fff)',
                        boxShadow: 'var(--shadow-sm)'
                      }}
                    >
                      <Avatar role={agent.role} size="md" />
                    </span>
                    <div className="flex items-center gap-1.5 pb-0.5">
                      {agent.group && <Badge variant="default">{agent.group}</Badge>}
                      <Badge variant={agent.enabled ? 'success' : 'default'}>
                        {agent.enabled ? '已启用' : '未启用'}
                      </Badge>
                    </div>
                  </div>

                  <span
                    className="text-sm font-semibold flex items-center gap-1.5"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {agent.name}
                    <span className="text-[11px] font-normal" style={{ color: roleColor }}>
                      {agent.role}
                    </span>
                    {isOrchestrator && (
                      <Lock size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                    )}
                  </span>
                  <p
                    className="text-xs mt-1 leading-relaxed"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {agent.description || ROLE_DESC[agent.role] || `自定义角色：${agent.role}`}
                  </p>

                  {/* 技能 chips */}
                  {skillChips.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {skillChips.map((skill) => (
                        <span
                          key={skill}
                          className="px-1.5 py-0.5 text-[10px] rounded"
                          style={{
                            background: 'var(--color-bg-spotlight)',
                            border: '1px solid var(--color-border-light)',
                            color: 'var(--color-text-secondary)'
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-2">
                    {ADAPTER_LOGO[agent.adapterType] ? (
                      <img
                        src={ADAPTER_LOGO[agent.adapterType]}
                        alt={agent.adapterType}
                        className="w-3.5 h-3.5 rounded-sm object-contain"
                      />
                    ) : (
                      <Bot size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                    )}
                    <span
                      className="text-xs truncate"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {agent.adapterType}
                      {agent.model ? `\u3000${agent.model}` : ''}
                      {agent.providerConfig?.baseUrl ? '\u3000独立供应商' : ''}
                    </span>
                  </div>

                  <div
                    className="flex gap-2 mt-3 pt-3"
                    style={{ borderTop: '1px solid var(--color-border-light)' }}
                  >
                    <button
                      onClick={() => setConfigAgent(agent)}
                      className="btn-ghost btn-press flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      <Settings size={12} /> 配置
                    </button>
                    {!isOrchestrator && (
                      <button
                        onClick={() => handleToggle(agent)}
                        className="btn-ghost btn-press flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg"
                        style={{
                          color: agent.enabled
                            ? 'var(--color-error, #ff4d4f)'
                            : 'var(--color-brand)'
                        }}
                      >
                        <Power size={12} /> {agent.enabled ? '停用' : '启用'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {configAgent && (
        <ConfigModal
          agent={configAgent}
          roleSuggestions={roleSuggestions}
          onClose={() => setConfigAgent(null)}
          onSaved={handleSaved}
        />
      )}
      {showAdd && (
        <AddAgentModal
          roleSuggestions={roleSuggestions}
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
