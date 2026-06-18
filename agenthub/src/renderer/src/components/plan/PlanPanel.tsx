import { useCallback, useEffect, useState } from 'react'
import { FileText, RefreshCw, Save, Loader2, ChevronLeft, Check } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { listPlans, getPlanFile, savePlanFile, type PlanFile } from '../../services/api'

/** 计划查看/编辑面板（item 2）：列出 spec-driven 三件套 + 合并版，支持逐文件查看与编辑落盘。 */
export function PlanPanel(): React.JSX.Element {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)

  const [files, setFiles] = useState<PlanFile[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [selected, setSelected] = useState<PlanFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const loadList = useCallback(async (): Promise<void> => {
    if (!activeId) return
    setListLoading(true)
    try {
      setFiles(await listPlans(activeId))
    } catch {
      setFiles([])
    } finally {
      setListLoading(false)
    }
  }, [activeId])

  // 会话切换 / 面板打开 → 重新拉列表，并退回列表视图
  useEffect(() => {
    setSelected(null)
    void loadList()
  }, [loadList])

  const openFile = async (f: PlanFile): Promise<void> => {
    setSelected(f)
    setFileLoading(true)
    setSaveState('idle')
    setDirty(false)
    try {
      const r = await getPlanFile(activeId as string, f.path)
      setContent(r.content)
    } catch {
      setContent('')
    } finally {
      setFileLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!activeId || !selected || saveState === 'saving') return
    setSaveState('saving')
    try {
      await savePlanFile(activeId, selected.path, content)
      setSaveState('saved')
      setDirty(false)
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  if (!activeId) {
    return (
      <div
        className="flex items-center justify-center h-full text-sm"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {tr('plan.noConversation')}
      </div>
    )
  }

  // 详情视图：查看 / 编辑单个计划文件
  if (selected) {
    return (
      <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--color-bg-container)' }}>
        <div
          className="flex items-center gap-2 shrink-0"
          style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-light)' }}
        >
          <button
            onClick={() => setSelected(null)}
            className="btn-ghost flex items-center justify-center rounded-md shrink-0"
            style={{ width: 26, height: 26, color: 'var(--color-text-secondary)' }}
            title={tr('common.back')}
          >
            <ChevronLeft size={16} />
          </button>
          <span
            className="text-xs font-medium truncate flex-1"
            style={{ color: 'var(--color-text-primary)' }}
            title={selected.path}
          >
            {selected.path}
          </span>
          <button
            onClick={handleSave}
            disabled={saveState === 'saving' || !dirty}
            className="flex items-center gap-1 px-2 h-7 rounded-md text-xs shrink-0 transition-colors"
            style={{
              color: saveState === 'error' ? 'var(--color-error)' : 'var(--color-brand)',
              background: dirty ? 'var(--color-brand-bg)' : 'transparent',
              opacity: saveState === 'saving' || !dirty ? 0.5 : 1,
              cursor: saveState === 'saving' || !dirty ? 'not-allowed' : 'pointer'
            }}
          >
            {saveState === 'saving' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : saveState === 'saved' ? (
              <Check size={13} />
            ) : (
              <Save size={13} />
            )}
            <span>
              {saveState === 'saved'
                ? tr('plan.saved')
                : saveState === 'error'
                  ? tr('plan.saveFailed')
                  : tr('plan.save')}
            </span>
          </button>
        </div>

        {fileLoading ? (
          <div className="flex items-center justify-center flex-1" style={{ color: 'var(--color-text-tertiary)' }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
            }}
            spellCheck={false}
            className="flex-1 min-h-0 w-full resize-none outline-none"
            style={{
              padding: '12px 14px',
              background: 'var(--color-bg-base)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              lineHeight: 1.6,
              border: 'none'
            }}
          />
        )}
      </div>
    )
  }

  // 列表视图：会话下全部计划文件
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--color-bg-container)' }}>
      <div
        className="flex items-center gap-2 shrink-0"
        style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-light)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('rightDock.plan')}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          {files.length}
        </span>
        <button
          onClick={() => void loadList()}
          className="btn-ghost flex items-center justify-center rounded-md ml-auto"
          style={{ width: 26, height: 26, color: 'var(--color-text-tertiary)' }}
          title={tr('plan.refresh')}
        >
          <RefreshCw size={13} className={listLoading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '6px 0' }}>
        {files.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-1.5 text-sm"
            style={{ color: 'var(--color-text-secondary)', paddingTop: 56, paddingBottom: 56 }}
          >
            <FileText size={24} style={{ color: 'var(--color-text-tertiary)', opacity: 0.6 }} />
            <span>{tr('plan.empty')}</span>
          </div>
        ) : (
          files.map((f) => (
            <button
              key={f.path}
              onClick={() => void openFile(f)}
              className="flex items-center gap-2.5 w-full text-left transition-colors"
              style={{ padding: '8px 16px', color: 'var(--color-text-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-bg-spotlight)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <FileText size={15} className="shrink-0" style={{ color: 'var(--color-brand)' }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{f.name}</div>
                <div
                  className="text-[11px] truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  title={f.path}
                >
                  {f.path}
                </div>
              </div>
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                {f.mtime?.slice(11, 16)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
