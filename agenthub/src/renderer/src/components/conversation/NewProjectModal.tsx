import { useMemo, useState } from 'react'
import { FolderOpen, FilePlus, Check, Lock } from 'lucide-react'
import { useAppStore } from '../../store'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'
import { useT } from '../../i18n'
import type { Agent } from '../../types'

type Step = 'choose' | 'blank-form' | 'folder-form'

interface Props {
  open: boolean
  onClose: () => void
}

function basename(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  return p.split(sep).filter(Boolean).pop() ?? p
}

/** 邀请群成员多选：默认全选（全选 = 全员语义），Orchestrator 锁定 */
function MemberPicker({
  agents,
  selected,
  onToggle
}: {
  agents: Agent[]
  selected: Set<string>
  onToggle: (agent: Agent) => void
}): React.JSX.Element {
  const tr = useT()
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('conv.newProjectModal.invite')}
        </label>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('conv.newProjectModal.selected', { sel: selected.size, total: agents.length })}
        </span>
      </div>
      <div
        className="max-h-[180px] overflow-y-auto rounded-lg py-1"
        style={{
          border: '1px solid var(--color-border-light)',
          background: 'var(--color-bg-spotlight)'
        }}
      >
        {agents.map((a) => {
          const locked = a.role === 'orchestrator'
          const checked = selected.has(a.id)
          return (
            <button
              key={a.id}
              onClick={() => !locked && onToggle(a)}
              disabled={locked}
              className="flex items-center gap-2.5 w-full px-3 py-1.5 border-none bg-transparent text-left transition-colors duration-150"
              style={{ cursor: locked ? 'default' : 'pointer' }}
            >
              <span
                className="flex items-center justify-center w-4 h-4 rounded shrink-0"
                style={{
                  border: `1.5px solid ${checked ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  background: checked ? 'var(--color-brand)' : 'var(--color-bg-container)'
                }}
              >
                {checked && <Check size={11} color="#fff" strokeWidth={3} />}
              </span>
              <Avatar role={a.role} size="sm" />
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs font-medium truncate flex items-center gap-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {a.name}
                  {locked && <Lock size={9} style={{ color: 'var(--color-text-tertiary)' }} />}
                </span>
                <div
                  className="text-[11px] truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {a.role}
                  {a.model ? ` · ${a.model}` : ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function NewProjectModal({ open, onClose }: Props): React.JSX.Element | null {
  const tr = useT()
  const agents = useAppStore((s) => s.agents)
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  const [step, setStep] = useState<Step>('choose')
  const [blankName, setBlankName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  // 默认全选（含锁定的 orchestrator）
  const selected = selectedIds ?? new Set(enabledAgents.map((a) => a.id))

  const reset = (): void => {
    setStep('choose')
    setBlankName('')
    setFolderPath('')
    setSelectedIds(null)
    setLoading(false)
    setError(null)
  }

  const close = (): void => {
    reset()
    onClose()
  }

  const toggleMember = (agent: Agent): void => {
    const next = new Set(selected)
    if (next.has(agent.id)) next.delete(agent.id)
    else next.add(agent.id)
    setSelectedIds(next)
  }

  /** 全选提交 undefined（后端空数组 = 全员）；部分选提交所选 id */
  const membersPayload = (): string[] | undefined =>
    selected.size === enabledAgents.length ? undefined : [...selected]

  const handlePickFolder = async (): Promise<void> => {
    setError(null)
    try {
      const path = await window.api.dialog.selectDirectory()
      if (!path) return
      setFolderPath(path)
      setStep('folder-form')
    } catch {
      setError(tr('conv.newProjectModal.pickDirError'))
    }
  }

  const handleCreate = async (title: string, projectPath?: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await useAppStore
        .getState()
        .createConversation(title, title, projectPath ?? null, membersPayload())
      close()
    } catch {
      setLoading(false)
      setError(tr('conv.newProjectModal.createError'))
    }
  }

  const titleMap: Record<Step, string> = {
    choose: tr('conv.newProjectModal.titleChoose'),
    'blank-form': tr('conv.newProjectModal.titleBlank'),
    'folder-form': tr('conv.newProjectModal.titleFolder')
  }

  return (
    <Modal
      title={titleMap[step]}
      onClose={close}
      onBack={step !== 'choose' ? () => setStep('choose') : undefined}
      closeOnOverlay={false}
    >
      {error && (
        <div
          className="px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
        >
          {error}
        </div>
      )}

      {step === 'choose' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={handlePickFolder}
            disabled={loading}
            className="flex items-center gap-3 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150"
            style={{
              background: 'var(--color-bg-spotlight)',
              border: '1px solid var(--color-border-light)',
              color: 'var(--color-text-primary)',
              opacity: loading ? 0.6 : 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.background = 'var(--color-brand-bg)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border-light)'
              e.currentTarget.style.background = 'var(--color-bg-spotlight)'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
              style={{ background: 'var(--color-brand-bg)' }}
            >
              <FolderOpen size={20} style={{ color: 'var(--color-brand)' }} />
            </div>
            <div className="text-left">
              <div className="text-sm font-medium">{tr('conv.newProjectModal.useExisting')}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                {tr('conv.newProjectModal.useExistingDesc')}
              </div>
            </div>
          </button>

          <button
            onClick={() => setStep('blank-form')}
            disabled={loading}
            className="flex items-center gap-3 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150"
            style={{
              background: 'var(--color-bg-spotlight)',
              border: '1px solid var(--color-border-light)',
              color: 'var(--color-text-primary)',
              opacity: loading ? 0.6 : 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.background = 'var(--color-brand-bg)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border-light)'
              e.currentTarget.style.background = 'var(--color-bg-spotlight)'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
              style={{ background: 'var(--color-brand-bg)' }}
            >
              <FilePlus size={20} style={{ color: 'var(--color-brand)' }} />
            </div>
            <div className="text-left">
              <div className="text-sm font-medium">{tr('conv.newProjectModal.blank')}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                {tr('conv.newProjectModal.blankDesc')}
              </div>
            </div>
          </button>
        </div>
      )}

      {step === 'folder-form' && (
        <div className="flex flex-col gap-4">
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"
            style={{
              background: 'var(--color-bg-spotlight)',
              border: '1px solid var(--color-border-light)'
            }}
          >
            <FolderOpen size={16} className="shrink-0" style={{ color: 'var(--color-brand)' }} />
            <div className="flex-1 min-w-0">
              <div
                className="text-xs font-medium truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {basename(folderPath)}
              </div>
              <div
                className="text-[11px] truncate"
                style={{ color: 'var(--color-text-tertiary)' }}
                title={folderPath}
              >
                {folderPath}
              </div>
            </div>
          </div>

          <MemberPicker agents={enabledAgents} selected={selected} onToggle={toggleMember} />

          <button
            onClick={() => handleCreate(basename(folderPath), folderPath)}
            disabled={loading}
            className="btn-brand flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium w-full"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {tr('conv.newProjectModal.create')}
          </button>
        </div>
      )}

      {step === 'blank-form' && (
        <div className="flex flex-col gap-4">
          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {tr('conv.newProjectModal.projectName')}
            </label>
            <input
              type="text"
              value={blankName}
              onChange={(e) => setBlankName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && blankName.trim()) handleCreate(blankName.trim())
              }}
              placeholder={tr('conv.newProjectModal.projectNamePlaceholder')}
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg outline-none border transition-all duration-150 bg-[var(--color-bg-spotlight)] focus:bg-[var(--color-bg-container)] focus:border-[var(--color-brand)] focus:shadow-[0_0_0_3px_var(--color-brand-bg)]"
              style={{
                color: 'var(--color-text-primary)',
                borderColor: 'var(--color-border-light)'
              }}
            />
          </div>

          <MemberPicker agents={enabledAgents} selected={selected} onToggle={toggleMember} />

          <button
            onClick={() => handleCreate(blankName.trim())}
            disabled={!blankName.trim() || loading}
            className="btn-brand flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium w-full"
            style={{ opacity: !blankName.trim() || loading ? 0.5 : 1 }}
          >
            {tr('conv.newProjectModal.create')}
          </button>
        </div>
      )}
    </Modal>
  )
}
