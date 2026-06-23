import { useEffect, useState } from 'react'
import { Bot, Plus, Settings, Power, X, Check, Lock, RefreshCw, ShieldCheck } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { getRoleColor } from '../ui/role'
import { updateAgent, createAgent, scanProvider } from '../../services/api'
import { useAppStore } from '../../store'
import { notify } from '../../services/notify'
import { useT } from '../../i18n'
import { Modal } from '../ui/Modal'
import { StateView } from '../ui/StateView'
import type { Agent, ProviderConfig, ProviderConfigMap, ProviderScan } from '../../types'

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

function emptyProvider(): ProviderConfig {
  return { mode: 'default', baseUrl: '', authToken: '', model: '' }
}

/** 补全为「按适配器分组」的完整 map（两个适配器槽都在），兼容后端归一化后的数据。
 *  legacyAdapter+legacyModel：把旧的顶层 model 归并到对应适配器槽（仅当该槽无 model）。 */
function normalizeProviders(
  pc: ProviderConfigMap | undefined,
  legacyAdapter?: string,
  legacyModel?: string
): ProviderConfigMap {
  const out: ProviderConfigMap = {}
  for (const k of ADAPTER_TYPES) {
    const e = pc?.[k]
    out[k] = {
      mode: e?.mode === 'custom' ? 'custom' : 'default',
      baseUrl: e?.baseUrl ?? '',
      authToken: e?.authToken ?? '',
      model: e?.model ?? ''
    }
  }
  if (legacyModel && legacyAdapter && out[legacyAdapter] && !out[legacyAdapter].model) {
    out[legacyAdapter] = { ...out[legacyAdapter], model: legacyModel }
  }
  return out
}

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
  /** 按适配器分组的供应商配置（含 model，codex / claude-code 各自独立保存） */
  providers: ProviderConfigMap
}

/** 单个适配器的供应商配置区：默认（扫描本地 CLI 配置回显）/ 自定义（填 base_url+apikey）。 */
function ProviderSection({
  adapter,
  entry,
  onChange
}: {
  adapter: string
  entry: ProviderConfig
  onChange: (e: ProviderConfig) => void
}): React.JSX.Element {
  const tr = useT()
  const [scan, setScan] = useState<ProviderScan | null>(null)
  const [scanning, setScanning] = useState(false)

  const runScan = (): void => {
    setScanning(true)
    scanProvider(adapter)
      .then((r) => setScan(r))
      .catch(() => setScan(null))
      .finally(() => setScanning(false))
  }

  // 切换适配器时重新扫描本地配置（仅用于「默认」模式回显）
  useEffect(() => {
    let cancelled = false
    setScan(null)
    setScanning(true)
    scanProvider(adapter)
      .then((r) => !cancelled && setScan(r))
      .catch(() => !cancelled && setScan(null))
      .finally(() => !cancelled && setScanning(false))
    return () => {
      cancelled = true
    }
  }, [adapter])

  const adapterLabel = adapter === 'codex' ? 'Codex' : 'Claude Code'
  const authSourceLabel = (src: string): string =>
    src ? tr(`agents.form.authSource.${src}`) : tr('agents.form.authSource.none')

  return (
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
          <span style={{ color: 'var(--color-text-tertiary)' }}>（{adapterLabel}）</span>
        </span>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('agents.form.providerHint', { adapter: adapterLabel })}
        </p>
      </div>

      {/* 模型名（与该适配器供应商绑定，按适配器各自保存） */}
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {tr('agents.form.model')}
        </label>
        <input
          type="text"
          value={entry.model}
          list="agent-model-suggestions"
          placeholder={
            entry.mode === 'default' && scan?.model
              ? tr('agents.form.modelLocalPlaceholder', { model: scan.model })
              : tr('agents.form.modelPlaceholder')
          }
          onChange={(e) => onChange({ ...entry, model: e.target.value.trim() })}
          className={inputCls}
          style={inputStyle}
        />
        <datalist id="agent-model-suggestions">
          {(MODEL_SUGGESTIONS[adapter] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {/* 模式切换：默认（本地配置）/ 自定义 */}
      <div className="flex gap-2">
        {(['default', 'custom'] as const).map((m) => {
          const on = entry.mode === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...entry, mode: m })}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: on ? 'var(--color-brand-bg)' : 'var(--color-bg-container)',
                color: on ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-border-light)'}`,
                cursor: 'pointer'
              }}
            >
              {m === 'default'
                ? tr('agents.form.providerModeDefault')
                : tr('agents.form.providerModeCustom')}
            </button>
          )
        })}
      </div>

      {entry.mode === 'default' ? (
        <div
          className="text-xs rounded-lg p-2.5"
          style={{ background: 'var(--color-bg-container)', border: '1px solid var(--color-border-light)' }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('agents.form.localConfig')}
            </span>
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md"
              style={{
                background: 'var(--color-bg-spotlight)',
                border: '1px solid var(--color-border-light)',
                color: 'var(--color-text-secondary)',
                cursor: scanning ? 'default' : 'pointer'
              }}
            >
              <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} />
              {tr('agents.form.rescan')}
            </button>
          </div>
          {scanning ? (
            <span style={{ color: 'var(--color-text-tertiary)' }}>{tr('agents.form.scanning')}</span>
          ) : scan?.detected ? (
            <div className="flex flex-col gap-1">
              {scan.baseUrl ? (
                <div className="flex gap-2">
                  <span style={{ color: 'var(--color-text-tertiary)', minWidth: 64 }}>Base URL</span>
                  <span className="font-mono truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {scan.baseUrl}
                  </span>
                </div>
              ) : null}
              {scan.model ? (
                <div className="flex gap-2">
                  <span style={{ color: 'var(--color-text-tertiary)', minWidth: 64 }}>
                    {tr('agents.form.model')}
                  </span>
                  <span className="font-mono truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {scan.model}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5" style={{ color: 'var(--color-success)' }}>
                <ShieldCheck size={12} />
                {authSourceLabel(scan.authSource)}
              </div>
              {scan.configPath ? (
                <span
                  className="font-mono truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  title={scan.configPath}
                >
                  {scan.configPath}
                </span>
              ) : null}
            </div>
          ) : (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('agents.form.notDetected', { adapter: adapterLabel })}
            </span>
          )}
        </div>
      ) : (
        <>
          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Base URL
            </label>
            <input
              type="text"
              value={entry.baseUrl}
              placeholder={
                adapter === 'codex'
                  ? tr('agents.form.baseUrlPlaceholderCodex')
                  : tr('agents.form.baseUrlPlaceholderClaude')
              }
              onChange={(e) => onChange({ ...entry, baseUrl: e.target.value.trim() })}
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
              value={entry.authToken}
              placeholder="sk-..."
              onChange={(e) => onChange({ ...entry, authToken: e.target.value.trim() })}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </>
      )}
    </div>
  )
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
      <ProviderSection
        adapter={value.adapterType}
        entry={value.providers[value.adapterType] ?? emptyProvider()}
        onChange={(entry) =>
          onChange({
            ...value,
            providers: { ...value.providers, [value.adapterType]: entry }
          })
        }
      />
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
    providers: normalizeProviders(agent.providerConfig, agent.adapterType, agent.model)
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
        providerConfig: form.providers
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
    providers: normalizeProviders(undefined)
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
        providerConfig: form.providers
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
                        {agent.providerConfig?.[agent.adapterType]?.mode === 'custom'
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
