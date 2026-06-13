import { useMemo, useState } from 'react'
import { FolderOpen, FilePlus, X, ArrowLeft, Check, Lock } from 'lucide-react'
import { useAppStore } from '../../store'
import { Avatar } from '../ui/Avatar'
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
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          邀请群成员
        </label>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          已选 {selected.size}/{agents.length}（全选 = 全员，新 Agent 自动入群）
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
      setError('选择目录失败')
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
      setError('创建项目失败，请确认后端服务已启动')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }

  const titleMap: Record<Step, string> = {
    choose: '新建项目',
    'blank-form': '新建空白项目',
    'folder-form': '打开项目文件夹'
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 100, background: 'rgba(0,0,0,0.4)' }}
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[440px] rounded-xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-float)', background: 'var(--color-bg-container)' }}
      >
        {/* header */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          {step !== 'choose' && (
            <button
              onClick={() => setStep('choose')}
              className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span
            className="flex-1 text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {titleMap[step]}
          </span>
          <button
            onClick={close}
            className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="px-5 py-4">
          {error && (
            <div
              className="mb-3 px-3 py-2 rounded-lg text-xs"
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
                  <div className="text-sm font-medium">使用现有文件夹</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    选择本地已有的项目目录
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
                  <div className="text-sm font-medium">新建空白项目</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    从零开始创建一个新项目
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
                <FolderOpen
                  size={16}
                  className="shrink-0"
                  style={{ color: 'var(--color-brand)' }}
                />
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
                创建项目
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
                  项目名称
                </label>
                <input
                  type="text"
                  value={blankName}
                  onChange={(e) => setBlankName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && blankName.trim()) handleCreate(blankName.trim())
                  }}
                  placeholder="输入项目名称"
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
                创建项目
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
