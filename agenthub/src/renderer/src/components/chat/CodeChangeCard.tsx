import { FileDiff, FileText } from 'lucide-react'
import type { DiffFile, DiffRecord } from '../../types'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { extColor } from '../diff/fileExt'

/** 拆分文件路径：返回 [目录(含末尾/), 文件名]，用于弱化目录、强调文件名 */
function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/')
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)]
}

/** 单行变更统计：文件名 + 增删行数（对标 Cursor / Windsurf） */
function ChangeRow({ file, onOpen }: { file: DiffFile; onOpen: () => void }): React.JSX.Element {
  const [dir, name] = splitPath(file.filename)
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2 w-full px-2 py-1 border-none bg-transparent cursor-pointer hover-spotlight text-left"
    >
      <FileText size={12} className="shrink-0" style={{ color: extColor(file.filename) }} />
      <span
        className="flex-1 min-w-0 truncate text-[11px]"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {dir && <span style={{ color: 'var(--color-text-tertiary)' }}>{dir}</span>}
        <span style={{ color: 'var(--color-text-primary)' }}>{name}</span>
      </span>
      {file.additions > 0 && (
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--color-success)' }}
        >
          +{file.additions}
        </span>
      )}
      {file.deletions > 0 && (
        <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--color-error)' }}>
          -{file.deletions}
        </span>
      )}
    </button>
  )
}

/** 代码修改聚合卡：列出本次任务产生的 Diff 文件及增删行数，点击进入右侧审查面板。
 *  数据源为 store.diffsById 中匹配当前任务的 DiffRecord（由 buildFeed/AgentTurnCard 传入）。 */
export function CodeChangeCard({ diffs }: { diffs: DiffRecord[] }): React.JSX.Element | null {
  const tr = useT()
  if (diffs.length === 0) return null

  // 展开为「文件 -> 所属 Diff 记录」，点击行打开该记录所在的审查界面
  const rows = diffs.flatMap((d) => d.files.map((f) => ({ file: f, record: d })))
  if (rows.length === 0) return null

  const additions = rows.reduce((n, r) => n + r.file.additions, 0)
  const deletions = rows.reduce((n, r) => n + r.file.deletions, 0)

  const openReview = (record: DiffRecord): void => {
    useAppStore.setState({ activeDiff: record, rightTab: 'review', groupPanelOpen: false })
  }

  return (
    <div
      className="rounded-lg overflow-hidden mb-1"
      style={{
        border: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-spotlight)'
      }}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <FileDiff size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('chat.changes.title')}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('chat.changes.files', { count: rows.length })}
        </span>
        <span className="flex-1" />
        {additions > 0 && (
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-success)' }}>
            +{additions}
          </span>
        )}
        {deletions > 0 && (
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-error)' }}>
            -{deletions}
          </span>
        )}
      </div>
      <div
        className="flex flex-col px-1 pb-1"
        style={{ borderTop: '1px solid var(--color-border-light)' }}
      >
        {rows.map((r, i) => (
          <ChangeRow
            key={`${r.record.id}_${r.file.filename}_${i}`}
            file={r.file}
            onOpen={() => openReview(r.record)}
          />
        ))}
      </div>
    </div>
  )
}
