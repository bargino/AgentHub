import { X, Check, XCircle, MessageSquare, FileText } from 'lucide-react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { useState } from 'react'
import { useAppStore } from '../../store'
import { Badge } from '../ui/Badge'

/** 文件扩展名 -> 类型色（大厂 IDE 惯例配色） */
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#e8a33d',
  jsx: '#e8a33d',
  css: '#9d6fe0',
  scss: '#9d6fe0',
  json: '#f59e0b',
  py: '#3572a5',
  html: '#e34c26',
  md: '#6b7280',
  yaml: '#cb4b16',
  yml: '#cb4b16'
}

function extColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? 'var(--color-text-tertiary)'
}

/** split / unified 滑块式切换 */
function ViewSegmented({
  split,
  onChange
}: {
  split: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div
      className="relative flex items-center rounded-md p-0.5 select-none"
      style={{
        background: 'var(--color-bg-spotlight)',
        border: '1px solid var(--color-border-light)'
      }}
    >
      <span
        className="absolute rounded"
        style={{
          width: 'calc(50% - 2px)',
          top: 2,
          bottom: 2,
          left: split ? 'calc(50% + 0px)' : 2,
          background: 'var(--color-bg-container)',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--duration-base) var(--ease-spring)'
        }}
      />
      {(['统一', '对照'] as const).map((label, i) => {
        const active = (i === 1) === split
        return (
          <button
            key={label}
            onClick={() => onChange(i === 1)}
            className="relative z-10 px-2.5 py-0.5 text-[11px] border-none bg-transparent cursor-pointer"
            style={{
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontWeight: active ? 500 : 400,
              transition: 'color var(--transition-fast)'
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function DiffViewer(): React.JSX.Element | null {
  const open = useAppStore((s) => s.diffPanelOpen)
  const diff = useAppStore((s) => s.activeDiff)
  const toggle = (): void => useAppStore.getState().toggleDiffPanel()
  const approveDiff = (): void => {
    void useAppStore.getState().approveDiff()
  }
  const rejectDiff = (): void => {
    void useAppStore.getState().rejectDiff()
  }
  const requestRevision = (): void => {
    void useAppStore.getState().rejectDiff()
    useAppStore.getState().toggleDiffPanel()
    const files = diff?.files.map((f) => f.filename).join(', ') ?? ''
    useAppStore.setState({ draftMessage: `@reviewer 请修改以下文件的变更：${files}\n修改要求：` })
  }
  const [selectedFile, setSelectedFile] = useState(0)
  const [splitView, setSplitView] = useState(false)

  if (!open || !diff) return null

  const file = diff.files[selectedFile]
  const isPending = diff.status === 'pending'

  return (
    <div
      className="flex flex-col animate-slide-in-right"
      style={{
        width: 560,
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            代码变更
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
            {diff.files.length} 个文件
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ViewSegmented split={splitView} onChange={setSplitView} />
          <button
            onClick={toggle}
            className="btn-ghost w-6 h-6 flex items-center justify-center rounded"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 摘要 */}
      <div
        className="px-4 py-2 text-xs"
        style={{
          background: 'var(--color-bg-spotlight)',
          borderBottom: '1px solid var(--color-border-light)',
          color: 'var(--color-text-secondary)'
        }}
      >
        {diff.summary}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 文件列表 */}
        <div
          className="flex flex-col py-2 overflow-y-auto shrink-0"
          style={{ width: 180, borderRight: '1px solid var(--color-border-light)' }}
        >
          {diff.files.map((f, i) => {
            const active = i === selectedFile
            return (
              <button
                key={f.filename}
                onClick={() => setSelectedFile(i)}
                className={`relative flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[var(--color-brand-bg)]' : 'hover-spotlight'
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                    style={{ width: 3, height: 16, background: 'var(--color-brand)' }}
                  />
                )}
                <FileText size={12} className="shrink-0" style={{ color: extColor(f.filename) }} />
                <span
                  className="text-xs truncate"
                  style={{
                    color: active ? 'var(--color-brand)' : 'var(--color-text-primary)',
                    fontWeight: active ? 500 : 400
                  }}
                >
                  {f.filename.split('/').pop()}
                </span>
                <span className="ml-auto text-xs shrink-0">
                  <span style={{ color: 'var(--color-success)' }}>+{f.additions}</span>
                  <span className="mx-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    /
                  </span>
                  <span style={{ color: 'var(--color-error)' }}>-{f.deletions}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Diff 内容 */}
        <div className="flex-1 overflow-auto text-xs">
          {file && (
            <ReactDiffViewer
              oldValue={file.oldContent}
              newValue={file.newContent}
              splitView={splitView}
              compareMethod={DiffMethod.LINES}
              useDarkTheme={document.documentElement.dataset.theme === 'dark'}
              styles={{
                line: { fontSize: '11px', fontFamily: 'var(--font-mono)' }
              }}
            />
          )}
        </div>
      </div>

      {/* 操作栏 */}
      {isPending ? (
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--color-border-light)' }}
        >
          <button
            onClick={approveDiff}
            className="btn-press flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md"
            style={{
              border: 'none',
              color: '#fff',
              background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
              boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
              cursor: 'pointer'
            }}
          >
            <Check size={14} /> 批准
          </button>
          <button
            onClick={rejectDiff}
            className="btn-press btn-outline-error flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md"
          >
            <XCircle size={14} /> 拒绝
          </button>
          <button
            onClick={requestRevision}
            className="btn-press btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md ml-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <MessageSquare size={14} /> 要求修改
          </button>
        </div>
      ) : (
        <div
          className="flex items-center justify-center px-4 py-3"
          style={{ borderTop: '1px solid var(--color-border-light)' }}
        >
          <Badge variant={diff.status === 'approved' ? 'success' : 'error'} size="md">
            {diff.status === 'approved' ? '已批准' : '已拒绝'}
          </Badge>
        </div>
      )}
    </div>
  )
}
