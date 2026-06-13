import { useMemo, useState } from 'react'
import { X, Plus, Lock, Archive, Check, Loader2, Users } from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { ResizeHandle } from '../ui/ResizeHandle'
import type { Agent, Conversation } from '../../types'

/** settings.skills 四态：跟随全局（缺省）/ 全部加载 / 自定义列表 / 关闭 */
type SkillMode = 'inherit' | 'all' | 'custom' | 'off'

function readSkillMode(settings: Record<string, unknown>): { mode: SkillMode; list: string } {
  const v = settings['skills']
  if (v === 'all') return { mode: 'all', list: '' }
  if (v === 'off') return { mode: 'off', list: '' }
  if (Array.isArray(v)) return { mode: 'custom', list: v.join(', ') }
  return { mode: 'inherit', list: '' }
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
  return (
    <div className="relative flex flex-col items-center gap-1 w-[52px] group">
      <div className="relative">
        <Avatar role={agent.role} size="md" />
        {removable ? (
          <button
            onClick={onRemove}
            title={`移除 ${agent.name}`}
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
            title="群主（不可移除）"
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
          邀请 Agent 入群
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
            所有已启用的 Agent 均已在群中
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

const SKILL_OPTIONS: { value: SkillMode; label: string; desc: string }[] = [
  { value: 'inherit', label: '跟随全局', desc: '使用全局技能配置' },
  { value: 'all', label: '全部加载', desc: '加载全部可用技能' },
  { value: 'custom', label: '自定义列表', desc: '仅加载指定技能' },
  { value: 'off', label: '关闭', desc: '本群不加载技能' }
]

const INTENSITY_OPTIONS: { value: IntensityMode; label: string; desc: string }[] = [
  { value: 'lite', label: '精简', desc: '尽量直接回答或单步完成，少拆任务' },
  { value: 'standard', label: '标准', desc: '由编排器按需判断协作深度' },
  { value: 'strict', label: '严格', desc: '复杂任务自动加审查收尾' }
]

export function GroupSettingsPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.groupPanelOpen)
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)

  const conv = conversations.find((c) => c.id === activeId)
  if (!open || !conv) return null

  // key 随会话切换重置：切换会话时本地编辑态（规则/技能草稿）随之重置
  return <PanelBody key={conv.id} conv={conv} />
}

function PanelBody({ conv }: { conv: Conversation }): React.JSX.Element {
  const agents = useAppStore((s) => s.agents)
  const members = useMemo(() => resolveMembers(conv, agents), [conv, agents])
  const isAllMembers = (conv.memberAgentIds ?? []).length === 0

  const initialSkill = readSkillMode(conv.settings ?? {})
  const [showInvite, setShowInvite] = useState(false)
  const [rules, setRules] = useState(conv.rules ?? '')
  const [skillMode, setSkillMode] = useState<SkillMode>(initialSkill.mode)
  const [skillList, setSkillList] = useState(initialSkill.list)
  const [intensity, setIntensity] = useState<IntensityMode>(readIntensity(conv.settings ?? {}))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabledAgents = agents.filter((a) => a.enabled)
  const memberIdSet = new Set(members.map((m) => m.id))
  const candidates = enabledAgents.filter((a) => !memberIdSet.has(a.id))

  const patch = async (
    data: Parameters<ReturnType<typeof useAppStore.getState>['updateConversation']>[1]
  ): Promise<boolean> => {
    setError(null)
    try {
      await useAppStore.getState().updateConversation(conv.id, data)
      return true
    } catch {
      setError('保存失败，请确认 AgentHub Server 已启动')
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
    const settings: Record<string, unknown> = { ...(conv.settings ?? {}) }
    if (skillMode === 'inherit') delete settings['skills']
    else if (skillMode === 'custom')
      settings['skills'] = skillList
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
    else settings['skills'] = skillMode
    // 协作强度：标准为默认，不落库（缺省即标准）
    if (intensity === 'standard') delete settings['collab_intensity']
    else settings['collab_intensity'] = intensity
    const ok = await patch({ rules, settings })
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
      <ResizeHandle />
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: 'var(--color-text-secondary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            群设置
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
            <SectionTitle>群成员（{members.length}）</SectionTitle>
            {isAllMembers && (
              <Badge variant="brand" size="sm">
                全员
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
            {/* 邀请按钮 */}
            <div className="flex flex-col items-center gap-1 w-[52px]">
              <button
                onClick={() => setShowInvite((v) => !v)}
                title="邀请 Agent"
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
                邀请
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

        {/* 群规则 */}
        <div>
          <SectionTitle>群规则</SectionTitle>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={4}
            placeholder={'注入本会话所有任务指令，例如：\n本项目用 pnpm；禁止修改 CI 配置'}
            className="styled-input w-full resize-none leading-relaxed"
            style={{ fontSize: 'var(--font-size-sm)' }}
          />
        </div>

        {/* 协作强度 */}
        <div>
          <SectionTitle>协作强度</SectionTitle>
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
                      {opt.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {opt.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 群技能 */}
        <div>
          <SectionTitle>群技能</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {SKILL_OPTIONS.map((opt) => {
              const active = skillMode === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setSkillMode(opt.value)}
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
                      {opt.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {opt.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          {skillMode === 'custom' && (
            <input
              type="text"
              value={skillList}
              onChange={(e) => setSkillList(e.target.value)}
              placeholder="逗号分隔技能名，如 code-audit, ui-design"
              className="styled-input w-full mt-2"
            />
          )}
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
          {saved ? '已保存' : '保存群规则与技能'}
        </button>

        {/* 危险区 */}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--color-border-light)' }}>
          <button
            onClick={handleArchive}
            className="btn-outline-error flex items-center justify-center gap-1.5 w-full h-9 rounded-lg text-sm font-medium"
          >
            <Archive size={14} />
            {confirmArchive ? '再次点击确认归档' : '归档会话'}
          </button>
        </div>
      </div>
    </div>
  )
}
