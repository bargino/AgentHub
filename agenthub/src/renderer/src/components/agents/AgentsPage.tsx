import { useEffect, useState } from 'react'
import { Bot, Plus, Settings, Power, X, Check, Lock } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { getRoleColor } from '../ui/role'
import { updateAgent, createAgent } from '../../services/api'
import { useAppStore } from '../../store'
import { notify } from '../../services/notify'
import { useT } from '../../i18n'
import { Modal } from '../ui/Modal'
import { StateView } from '../ui/StateView'
import type { Agent } from '../../types'

import codexLogo from '../../assets/logos/codex.webp'
import claudeLogo from '../../assets/logos/claude.png'

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

const ADAPTER_LOGO: Record<string, string> = {
  'claude-code': claudeLogo,
  codex: codexLogo
}

// 内置角色的默认描述 key（agent.description 为空时回退展示）
const ROLE_DESC_KEY: Record<string, string> = {
  orchestrator: 'agents.roleDesc.orchestrator',
  planner: 'agents.roleDesc.planner',
  coder: 'agents.roleDesc.coder',
  reviewer: 'agents.roleDesc.reviewer',
  deployer: 'agents.roleDesc.deployer'
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
  const tr = useT()
  return (
    <>
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {tr('agents.form.name')}
        </label>
        <input
          type="text"
          value={value.name}
          autoFocus={autoFocusName}
          placeholder={tr('agents.form.namePlaceholder')}
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
          {tr('agents.form.role')} {roleLocked && <Lock size={10} className="inline ml-1" />}
        </label>
        <input
          type="text"
          value={value.role}
          disabled={roleLocked}
          placeholder={tr('agents.form.rolePlaceholder')}
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
          {tr('agents.form.desc')}
        </label>
        <textarea
          value={value.description}
          rows={2}
          placeholder={tr('agents.form.descPlaceholder')}
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
          {tr('agents.form.skills')}
        </label>
        <input
          type="text"
          value={value.skills}
          placeholder={tr('agents.form.skillsPlaceholder')}
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
            {tr('agents.form.group')}
          </label>
          <input
            type="text"
            value={value.group}
            placeholder={tr('agents.form.groupPlaceholder')}
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
            {tr('agents.form.adapter')}
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
          {tr('agents.form.model')}
        </label>
        <input
          type="text"
          value={value.model}
          placeholder={tr('agents.form.modelPlaceholder')}
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
            {tr('agents.form.provider')}
          </span>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
            {tr('agents.form.providerHint', {
              adapter: value.adapterType === 'codex' ? 'Codex' : 'Claude Code'
            })}
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
                ? tr('agents.form.baseUrlPlaceholderCodex')
                : tr('agents.form.baseUrlPlaceholderClaude')
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
  const tr = useT()
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
    } catch (err) {
      notify.error(tr('agents.notify.saveFailed'), errText(err, tr('agents.notify.retryLater')))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={tr('agents.modal.configTitle', { name: agent.name })}
      onClose={onClose}
      closeOnOverlay={false}
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
            <X size={15} /> {tr('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.role.trim()}
            className="btn-brand flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium"
            style={{ opacity: saving || !form.name.trim() || !form.role.trim() ? 0.5 : 1 }}
          >
            <Check size={15} /> {tr('common.save')}
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
    </Modal>
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
  const tr = useT()
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
    } catch (err) {
      notify.error(tr('agents.notify.createFailed'), errText(err, tr('agents.notify.retryLater')))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={tr('agents.modal.addTitle')}
      onClose={onClose}
      closeOnOverlay={false}
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
            <X size={15} /> {tr('common.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="btn-brand flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium"
            style={{ opacity: !canCreate || saving ? 0.5 : 1 }}
          >
            <Plus size={15} /> {tr('common.create')}
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
          {tr('agents.modal.orchestratorLocked')}
        </p>
      )}
    </Modal>
  )
}

export function AgentsPage(): React.JSX.Element {
  const tr = useT()
  // 单一数据源：直接读 store.agents，增删改后调 loadAgents() 重拉，不再维护本地副本
  const agents = useAppStore((s) => s.agents)
  const loadAgents = useAppStore((s) => s.loadAgents)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [configAgent, setConfigAgent] = useState<Agent | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = (): void => {
    loadAgents()
      .then(() => setLoadError(false))
      .catch((err) => {
        setLoadError(true)
        notify.error(tr('agents.notify.loadFailed'), errText(err, tr('agents.notify.engineReady')))
      })
      .finally(() => setLoading(false))
  }

  // 重试入口（事件处理器内可安全置 loading）
  const refresh = (): void => {
    setLoading(true)
    load()
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 现有角色 + 内置角色作为「角色标识」输入建议
  const roleSuggestions = Array.from(
    new Set([...BUILTIN_ROLES, ...agents.map((a) => a.role).filter((r) => r !== 'orchestrator')])
  )

  const handleToggle = async (agent: Agent): Promise<void> => {
    if (agent.role === 'orchestrator') return
    try {
      await updateAgent(agent.id, { enabled: !agent.enabled })
      await loadAgents()
    } catch (err) {
      notify.error(
        agent.enabled ? tr('agents.notify.disableFailed') : tr('agents.notify.enableFailed'),
        errText(err, tr('agents.notify.retryLater'))
      )
    }
  }

  const handleSaved = (): void => {
    void loadAgents()
  }

  const handleCreated = (): void => {
    void loadAgents()
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
            {tr('agents.page.title')}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {tr('agents.page.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-brand flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg"
        >
          <Plus size={14} /> {tr('agents.page.add')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loadError ? (
          <StateView
            kind="error"
            icon={Bot}
            title={tr('agents.page.loadErrorTitle')}
            description={tr('agents.page.loadErrorDesc')}
            action={
              <button onClick={refresh} className="btn-brand flex items-center gap-1.5 text-sm">
                <Plus size={14} className="rotate-45" /> {tr('agents.page.retry')}
              </button>
            }
          />
        ) : loading && agents.length === 0 ? (
          <StateView kind="loading" title={tr('agents.page.loading')} />
        ) : agents.length === 0 ? (
          <StateView
            kind="empty"
            icon={Bot}
            title={tr('agents.page.emptyTitle')}
            description={tr('agents.page.emptyDesc')}
          />
        ) : (
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
                          {agent.enabled ? tr('agents.page.enabled') : tr('agents.page.disabled')}
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
                      {agent.description ||
                        (ROLE_DESC_KEY[agent.role] ? tr(ROLE_DESC_KEY[agent.role]) : '') ||
                        tr('agents.page.customRole', { role: agent.role })}
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
                        {agent.providerConfig?.baseUrl
                          ? `\u3000${tr('agents.page.independentProvider')}`
                          : ''}
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
                        <Settings size={12} /> {tr('agents.page.config')}
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
                          <Power size={12} />{' '}
                          {agent.enabled ? tr('agents.page.disable') : tr('agents.page.enable')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
