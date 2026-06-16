import { useMemo, useState } from 'react'
import {
  X,
  Plus,
  Lock,
  Archive,
  Check,
  Loader2,
  Users,
  Server,
  Sparkles,
  ScrollText
} from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import { useT } from '../../i18n'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { ResourcePicker } from '../manage/ResourcePicker'
import { GroupResourceModal } from '../manage/GroupResourceModal'
import { useMcpServers, useSkills, useRules, type Selection } from '../manage/mgmtData'
import type { Agent, Conversation } from '../../types'

/** 群聊资源选择：'all'（缺省/全选）/ 'off'（旧值，全不选）/ id 列表 */
function readSelection(v: unknown): Selection {
  if (v === 'off') return []
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return 'all'
}

/** settings.collab_intensity 协作强度：精简 / 标准 / 严格 */
type IntensityMode = 'lite' | 'standard' | 'strict'

function readIntensity(settings: Record<string, unknown>): IntensityMode {
  const v = settings['collab_intensity']
  return v === 'lite' || v === 'strict' ? v : 'standard'
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {children}
    </div>
  )
}

/** 成员头像格子：hover 浮现移除角标，Orchestrator 锁定不可移除 */
function MemberCell({
  agent,
  removable,
  onRemove
}: {
  agent: Agent
  removable: boolean
  onRemove: () => void
}): React.JSX.Element {
  const tr = useT()
  return (
    <div className="relative flex flex-col items-center gap-1 w-[52px] group">
      <div className="relative">
        <Avatar role={agent.role} size="md" />
        {removable ? (
          <button
            onClick={onRemove}
            title={tr('conv.group.remove', { name: agent.name })}
            className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full cursor-pointer border-none"
            style={{ background: 'var(--color-error)', color: '#fff' }}
          >
            <X size={9} strokeWidth={3} />
          </button>
        ) : (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full"
            style={{
              background: 'var(--color-bg-container)',
              boxShadow: '0 0 0 1px var(--color-border-light)',
              color: 'var(--color-text-tertiary)'
            }}
            title={tr('conv.group.owner')}
          >
            <Lock size={9} />
          </span>
        )}
      </div>
      <span
        className="w-full text-center text-[11px] truncate"
        style={{ color: 'var(--color-text-secondary)' }}
        title={agent.name}
      >
        {agent.name}
      </span>
    </div>
  )
}

/** 邀请弹层：列出未入群的 enabled Agent（带角色 + 模型徽标） */
function InviteList({
  candidates,
  onInvite,
  onClose
}: {
  candidates: Agent[]
  onInvite: (agent: Agent) => void
  onClose: () => void
}): React.JSX.Element {
  const tr = useT()
  return (
    <div
      className="absolute left-0 right-0 top-full mt-1.5 rounded-lg overflow-hidden animate-fade-in"
      style={{
        zIndex: 60,
        background: 'var(--color-bg-container)',
        boxShadow: 'var(--shadow-float)'
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('conv.group.inviteHeading')}
        </span>
        <button
          onClick={onClose}
          className="btn-ghost flex items-center justify-center w-5 h-5 rounded"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <X size={12} />
        </button>
      </div>
      <div className="max-h-[220px] overflow-y-auto py-1">
        {candidates.length === 0 ? (
          <div
            className="px-3 py-4 text-center text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {tr('conv.group.inviteEmpty')}
          </div>
        ) : (
          candidates.map((a) => (
            <button
              key={a.id}
              onClick={() => onInvite(a)}
              className="hover-spotlight flex items-center gap-2.5 w-full px-3 py-2 border-none bg-transparent cursor-pointer text-left"
            >
              <Avatar role={a.role} size="sm" />
              <div className="flex-1 min-w-0">
                <div
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {a.name}
                </div>
                <div
                  className="text-[11px] truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {a.role}
                  {a.model ? ` · ${a.model}` : ''}
                </div>
              </div>
              <Plus size={13} className="shrink-0" style={{ color: 'var(--color-brand)' }} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

const INTENSITY_OPTIONS: { value: IntensityMode; labelKey: string; descKey: string }[] = [
  {
    value: 'lite',
    labelKey: 'conv.group.intensity_lite',
    descKey: 'conv.group.intensity_liteDesc'
  },
  {
    value: 'standard',
    labelKey: 'conv.group.intensity_standard',
    descKey: 'conv.group.intensity_standardDesc'
  },
  {
    value: 'strict',
    labelKey: 'conv.group.intensity_strict',
    descKey: 'conv.group.intensity_strictDesc'
  }
]

const MCP_KIND_KEY: Record<string, string> = {
  local: 'conv.group.mcpKind.local',
  remote: 'conv.group.mcpKind.remote'
}
const RULE_KIND_KEY: Record<string, string> = {
  instruction: 'conv.group.ruleKind.instruction',
  permission: 'conv.group.ruleKind.permission'
}

export function GroupSettingsPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.groupPanelOpen)
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)

  const conv = conversations.find((c) => c.id === activeId)
  if (!open || !conv) return null

  // key 随会话切换重置：切换会话时本地编辑态随之重置
  return <PanelBody key={conv.id} conv={conv} />
}

function PanelBody({ conv }: { conv: Conversation }): React.JSX.Element {
  const tr = useT()
  const agents = useAppStore((s) => s.agents)
  const members = useMemo(() => resolveMembers(conv, agents), [conv, agents])
  const isAllMembers = (conv.memberAgentIds ?? []).length === 0

  const mcpServers = useMcpServers()
  const skills = useSkills()
  const rulesLib = useRules()

  const settings = conv.settings ?? {}
  const [showInvite, setShowInvite] = useState(false)
  const [rules, setRules] = useState(conv.rules ?? '')
  const [mcpSel, setMcpSel] = useState<Selection>(readSelection(settings['mcp']))
  const [skillSel, setSkillSel] = useState<Selection>(readSelection(settings['skills']))
  const [ruleSel, setRuleSel] = useState<Selection>(readSelection(settings['rules']))
  const [intensity, setIntensity] = useState<IntensityMode>(readIntensity(settings))
  const [modalTab, setModalTab] = useState<'mcp' | 'skills' | 'rules' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabledAgents = agents.filter((a) => a.enabled)
  const memberIdSet = new Set(members.map((m) => m.id))
  const candidates = enabledAgents.filter((a) => !memberIdSet.has(a.id))

  const mcpRows = mcpServers.map((m) => ({
    id: m.id,
    name: m.name || tr('conv.group.unnamedMcp'),
    sub:
      (MCP_KIND_KEY[m.kind] ? tr(MCP_KIND_KEY[m.kind]) : m.kind) +
      (m.description ? ` · ${m.description}` : ''),
    accent: 'var(--color-brand)'
  }))
  const skillRows = skills.map((s) => ({
    id: s.id,
    name: s.name || tr('conv.group.unnamedSkill'),
    sub: s.category || s.description || undefined,
    accent: 'var(--color-success)'
  }))
  const ruleRows = rulesLib.map((r) => ({
    id: r.id,
    name: r.name || tr('conv.group.unnamedRule'),
    sub: `${RULE_KIND_KEY[r.kind] ? tr(RULE_KIND_KEY[r.kind]) : r.kind}${r.description ? ` · ${r.description}` : ''}`,
    accent: 'var(--color-warning)'
  }))

  const goManage = (): void => {
    useAppStore.getState().setActivePage('manage')
    useAppStore.getState().toggleGroupPanel()
  }

  const patch = async (
    data: Parameters<ReturnType<typeof useAppStore.getState>['updateConversation']>[1]
  ): Promise<boolean> => {
    setError(null)
    try {
      await useAppStore.getState().updateConversation(conv.id, data)
      return true
    } catch {
      setError(tr('conv.group.saveError'))
      return false
    }
  }

  /** 提交成员列表；覆盖全部 enabled 时归一化为空数组（全员语义，新 Agent 自动入群） */
  const commitMembers = (ids: string[]): Promise<boolean> => {
    const everyEnabled = enabledAgents.every((a) => ids.includes(a.id))
    return patch({ memberAgentIds: everyEnabled ? [] : ids })
  }

  const handleRemove = (agent: Agent): void => {
    const next = members.filter((m) => m.id !== agent.id).map((m) => m.id)
    void commitMembers(next)
  }

  const handleInvite = (agent: Agent): void => {
    void commitMembers([...members.map((m) => m.id), agent.id])
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setSaved(false)
    const next: Record<string, unknown> = { ...settings }
    next['mcp'] = mcpSel
    next['skills'] = skillSel
    next['rules'] = ruleSel
    if (intensity === 'standard') delete next['collab_intensity']
    else next['collab_intensity'] = intensity
    const ok = await patch({ rules, settings: next })
    setSaving(false)
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleArchive = (): void => {
    if (!confirmArchive) {
      setConfirmArchive(true)
      setTimeout(() => setConfirmArchive(false), 3000)
      return
    }
    void patch({ archived: true })
  }

  return (
    <div
      className="relative flex flex-col shrink-0 panel-slide-right"
      style={{
        width: 'var(--right-panel-width)',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: 'var(--color-text-secondary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {tr('conv.group.title')}
          </span>
        </div>
        <button
          onClick={() => useAppStore.getState().toggleGroupPanel()}
          className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
        >
          <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
        {error && (
          <div
            className="px-3 py-2 rounded-lg text-xs"
            style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
          >
            {error}
          </div>
        )}

        {/* 群成员 */}
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <SectionTitle>{tr('conv.group.members', { count: members.length })}</SectionTitle>
            {isAllMembers && (
              <Badge variant="brand" size="sm">
                {tr('conv.group.allMembers')}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {members.map((m) => (
              <MemberCell
                key={m.id}
                agent={m}
                removable={m.role !== 'orchestrator'}
                onRemove={() => handleRemove(m)}
              />
            ))}
            <div className="flex flex-col items-center gap-1 w-[52px]">
              <button
                onClick={() => setShowInvite((v) => !v)}
                title={tr('conv.group.inviteAgent')}
                className="flex items-center justify-center w-9 h-9 rounded-full cursor-pointer transition-colors duration-150"
                style={{
                  background: 'transparent',
                  border: '1px dashed var(--color-border)',
                  color: 'var(--color-text-tertiary)'
                }}
              >
                <Plus size={16} />
              </button>
              <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                {tr('conv.group.invite')}
              </span>
            </div>
          </div>
          {showInvite && (
            <InviteList
              candidates={candidates}
              onInvite={(a) => handleInvite(a)}
              onClose={() => setShowInvite(false)}
            />
          )}
        </div>

        {/* 可用资源（从管理中心仓库勾选；不配置=全选） */}
        <ResourcePicker
          title={tr('conv.group.mcp')}
          icon={Server}
          items={mcpRows}
          selection={mcpSel}
          onChange={setMcpSel}
          emptyHint={tr('conv.group.mcpEmpty')}
          onManage={goManage}
          onExpand={() => setModalTab('mcp')}
        />
        <ResourcePicker
          title={tr('conv.group.skills')}
          icon={Sparkles}
          items={skillRows}
          selection={skillSel}
          onChange={setSkillSel}
          emptyHint={tr('conv.group.skillsEmpty')}
          onManage={goManage}
          onExpand={() => setModalTab('skills')}
        />
        <ResourcePicker
          title={tr('conv.group.rules')}
          icon={ScrollText}
          items={ruleRows}
          selection={ruleSel}
          onChange={setRuleSel}
          emptyHint={tr('conv.group.rulesEmpty')}
          onManage={goManage}
          onExpand={() => setModalTab('rules')}
        />

        {/* 附加自定义规则（可选自由文本） */}
        <div>
          <SectionTitle>{tr('conv.group.extraRules')}</SectionTitle>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={3}
            placeholder={tr('conv.group.extraRulesPlaceholder')}
            className="styled-input w-full resize-none leading-relaxed"
            style={{ fontSize: 'var(--font-size-sm)' }}
          />
        </div>

        {/* 协作强度 */}
        <div>
          <SectionTitle>{tr('conv.group.intensity')}</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {INTENSITY_OPTIONS.map((opt) => {
              const active = intensity === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setIntensity(opt.value)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-left transition-colors duration-150"
                  style={{
                    background: active ? 'var(--color-brand-bg)' : 'var(--color-bg-spotlight)',
                    border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border-light)'}`
                  }}
                >
                  <span
                    className="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
                    style={{
                      border: `1.5px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
                      background: 'var(--color-bg-container)'
                    }}
                  >
                    {active && (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: 'var(--color-brand)' }}
                      />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-medium"
                      style={{ color: active ? 'var(--color-brand)' : 'var(--color-text-primary)' }}
                    >
                      {tr(opt.labelKey)}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {tr(opt.descKey)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 保存 */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-brand flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : saved ? (
            <Check size={14} />
          ) : null}
          {saved ? tr('conv.group.saved') : tr('conv.group.save')}
        </button>

        {/* 危险区 */}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--color-border-light)' }}>
          <button
            onClick={handleArchive}
            className="btn-outline-error flex items-center justify-center gap-1.5 w-full h-9 rounded-lg text-sm font-medium"
          >
            <Archive size={14} />
            {confirmArchive ? tr('conv.archiveConfirm') : tr('conv.archive')}
          </button>
        </div>
      </div>

      {modalTab && (
        <GroupResourceModal
          conv={conv}
          initialTab={modalTab}
          initialSel={{ mcp: mcpSel, skills: skillSel, rules: ruleSel }}
          onClose={() => setModalTab(null)}
          onSaved={(sel) => {
            setMcpSel(sel.mcp)
            setSkillSel(sel.skills)
            setRuleSel(sel.rules)
          }}
        />
      )}
    </div>
  )
}
