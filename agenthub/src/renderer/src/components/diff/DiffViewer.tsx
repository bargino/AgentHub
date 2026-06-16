import {
  FileText,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  FoldVertical,
  WholeWord,
  Check
} from 'lucide-react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { useEffect, useMemo, useState } from 'react'
import type { Highlighter } from 'shiki'
import { useT } from '../../i18n'
import type { DiffRecord } from '../../types'

// 语法高亮：复用项目已有的 shiki 依赖。按需懒加载单例 highlighter（首个 diff 出现时才拉取），
// 仅装载本仓常见语言的语法，未知扩展名回退纯文本。
const HL_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'css',
  'scss',
  'python',
  'html',
  'markdown',
  'yaml',
  'bash',
  'sql'
]
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  py: 'python',
  html: 'html',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql'
}
// 超过此规模的文件跳过语法高亮，避免逐行 tokenize 拖慢大 diff（无虚拟化时的轻量护栏）
const HL_MAX_CHARS = 200_000
const HL_MAX_LINES = 2000

let highlighterPromise: Promise<Highlighter> | null = null
function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: ['github-dark', 'github-light'], langs: HL_LANGS })
    )
  }
  return highlighterPromise
}

function useHighlighter(): Highlighter | null {
  const [hl, setHl] = useState<Highlighter | null>(null)
  useEffect(() => {
    let alive = true
    void loadHighlighter()
      .then((h) => {
        if (alive) setHl(h)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return hl
}

/** 变更文件按目录分组（PR 式文件树 + 路径 + 搜索） */
type FileEntry = { idx: number; name: string; file: DiffRecord['files'][number] }
function groupByDir(files: DiffRecord['files']): { dir: string; items: FileEntry[] }[] {
  const map = new Map<string, FileEntry[]>()
  files.forEach((file, idx) => {
    const norm = file.filename.replace(/\\/g, '/')
    const i = norm.lastIndexOf('/')
    const dir = i >= 0 ? norm.slice(0, i) : ''
    const name = norm.slice(i + 1)
    const list = map.get(dir) ?? []
    list.push({ idx, name, file })
    map.set(dir, list)
  })
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, items]) => ({ dir, items }))
}

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
  const tr = useT()
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
      {(['unified', 'split'] as const).map((mode, i) => {
        const active = (i === 1) === split
        return (
          <button
            key={mode}
            onClick={() => onChange(i === 1)}
            className="relative z-10 px-2.5 py-0.5 text-[11px] border-none bg-transparent cursor-pointer"
            style={{
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontWeight: active ? 500 : 400,
              transition: 'color var(--transition-fast)'
            }}
          >
            {tr(`diff.${mode}`)}
          </button>
        )
      })}
    </div>
  )
}

/** 纯展示型 diff 渲染（无 store 耦合）：文件树+路径+搜索 / 仅看变更 / 并排切换。
 *  文件索引受控于父级（供审查中心 j/k 键盘跨文件导航）。 */
export function DiffView({
  diff,
  fileIndex,
  onFileIndexChange
}: {
  diff: DiffRecord
  fileIndex: number
  onFileIndexChange: (i: number) => void
}): React.JSX.Element {
  const tr = useT()
  const [splitView, setSplitView] = useState(false)
  const [diffOnly, setDiffOnly] = useState(true)
  const [wordLevel, setWordLevel] = useState(true)
  const [query, setQuery] = useState('')
  const [treeHidden, setTreeHidden] = useState(false)
  // 逐文件「已查看」标记（PR 式审查辅助，纯前端状态）：切换 diff 时复位
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [viewedKey, setViewedKey] = useState(diff.id)
  if (diff.id !== viewedKey) {
    setViewedKey(diff.id)
    setViewed(new Set())
  }

  const groups = useMemo(() => {
    const all = groupByDir(diff.files)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all
      .map((g) => ({
        dir: g.dir,
        items: g.items.filter((it) => it.file.filename.toLowerCase().includes(q))
      }))
      .filter((g) => g.items.length > 0)
  }, [diff.files, query])

  const file = diff.files[fileIndex]
  const isDark = document.documentElement.dataset.theme === 'dark'

  // 语法高亮 renderContent：高亮器就绪 + 语言已知 + 文件不过大时逐行 tokenize；否则回退纯文本
  const highlighter = useHighlighter()
  const lang = file ? LANG_BY_EXT[file.filename.split('.').pop()?.toLowerCase() ?? ''] : undefined
  const tooLargeToHighlight = file
    ? file.oldContent.length + file.newContent.length > HL_MAX_CHARS ||
      file.oldContent.split('\n').length + file.newContent.split('\n').length > HL_MAX_LINES
    : false
  const renderContent = useMemo(() => {
    if (!highlighter || !lang || tooLargeToHighlight) return undefined
    return (source: string): React.JSX.Element => {
      try {
        const html = highlighter.codeToHtml(source, {
          lang,
          theme: isDark ? 'github-dark' : 'github-light',
          structure: 'inline'
        })
        return <span dangerouslySetInnerHTML={{ __html: html }} />
      } catch {
        return <span>{source}</span>
      }
    }
  }, [highlighter, lang, isDark, tooLargeToHighlight])

  // 当前查看的文件自动标记为已查看（GitHub 式：看过即标记）。渲染期同步推进，
  // 沿用本仓 prevKey 模式，避免在 effect 内 setState 触发级联渲染。
  const currentName = file?.filename
  const [prevName, setPrevName] = useState<string | undefined>(currentName)
  if (currentName && currentName !== prevName) {
    setPrevName(currentName)
    if (!viewed.has(currentName)) {
      const next = new Set(viewed)
      next.add(currentName)
      setViewed(next)
    }
  }

  const toggleViewed = (name: string): void =>
    setViewed((v) => {
      const next = new Set(v)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具条：树折叠 / 文件数 / 仅看变更 / 视图切换 */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <button
          onClick={() => setTreeHidden((v) => !v)}
          className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={tr(treeHidden ? 'review.diff.showTree' : 'review.diff.hideTree')}
        >
          {treeHidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('diff.fileCount', { count: diff.files.length })}
        </span>
        {diff.files.length > 1 && (
          <span
            className="text-xs tabular-nums"
            style={{
              color:
                viewed.size >= diff.files.length
                  ? 'var(--color-success)'
                  : 'var(--color-text-tertiary)'
            }}
          >
            {tr('review.diff.viewed', { done: viewed.size, total: diff.files.length })}
          </span>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setWordLevel((v) => !v)}
            className="btn-ghost flex items-center gap-1 px-2 h-7 rounded-md text-[11px]"
            style={{ color: wordLevel ? 'var(--color-brand)' : 'var(--color-text-secondary)' }}
            title={tr('review.diff.compareMethod')}
          >
            <WholeWord size={13} />
            {wordLevel ? tr('review.diff.wordLevel') : tr('review.diff.lineLevel')}
          </button>
          <button
            onClick={() => setDiffOnly((v) => !v)}
            className="btn-ghost flex items-center gap-1 px-2 h-7 rounded-md text-[11px]"
            style={{ color: diffOnly ? 'var(--color-brand)' : 'var(--color-text-secondary)' }}
            title={tr('review.diff.collapseUnchanged')}
          >
            <FoldVertical size={13} />
            {tr('review.diff.changesOnly')}
          </button>
          <ViewSegmented split={splitView} onChange={setSplitView} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {!treeHidden && (
          <div
            className="flex flex-col shrink-0"
            style={{ width: 200, borderRight: '1px solid var(--color-border-light)' }}
          >
            {/* 搜索 */}
            <div className="px-2 py-2 shrink-0">
              <div
                className="flex items-center gap-1.5 px-2 rounded-md"
                style={{
                  background: 'var(--color-bg-spotlight)',
                  border: '1px solid var(--color-border-light)'
                }}
              >
                <Search size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr('review.diff.searchFiles')}
                  className="flex-1 bg-transparent border-none outline-none text-xs py-1.5"
                  style={{ color: 'var(--color-text-primary)' }}
                />
              </div>
            </div>
            {/* 文件树（按目录分组 + 完整路径 tooltip） */}
            <div className="flex-1 overflow-y-auto pb-2">
              {groups.map(({ dir, items }) => (
                <div key={dir || '.'} className="mb-0.5">
                  <div
                    className="flex items-center gap-1 px-3 py-1 text-[11px] truncate"
                    style={{ color: 'var(--color-text-tertiary)' }}
                    title={dir || tr('git.rootDir')}
                  >
                    {dir || tr('git.rootDir')}
                  </div>
                  {items.map(({ idx, name, file: f }) => {
                    const active = idx === fileIndex
                    const isViewed = viewed.has(f.filename)
                    return (
                      <button
                        key={f.filename}
                        onClick={() => onFileIndexChange(idx)}
                        title={f.filename}
                        className={`relative flex items-center gap-2 w-full pl-3 pr-3 py-1.5 text-left transition-colors ${
                          active ? 'bg-[var(--color-brand-bg)]' : 'hover-spotlight'
                        }`}
                        style={{ opacity: isViewed && !active ? 0.55 : 1 }}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                            style={{ width: 3, height: 16, background: 'var(--color-brand)' }}
                          />
                        )}
                        <span
                          role="checkbox"
                          aria-checked={isViewed}
                          title={tr('review.diff.markViewed')}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleViewed(f.filename)
                          }}
                          className="flex items-center justify-center shrink-0 rounded"
                          style={{
                            width: 14,
                            height: 14,
                            border: `1.5px solid ${isViewed ? 'var(--color-success)' : 'var(--color-border)'}`,
                            background: isViewed ? 'var(--color-success)' : 'transparent'
                          }}
                        >
                          {isViewed && <Check size={10} color="#fff" strokeWidth={3} />}
                        </span>
                        <FileText
                          size={12}
                          className="shrink-0"
                          style={{ color: extColor(f.filename) }}
                        />
                        <span
                          className="flex-1 text-xs truncate"
                          style={{
                            color: active ? 'var(--color-brand)' : 'var(--color-text-primary)',
                            fontWeight: active ? 500 : 400,
                            textDecoration: isViewed ? 'line-through' : undefined
                          }}
                        >
                          {name}
                        </span>
                        <span className="text-[11px] shrink-0 tabular-nums">
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
              ))}
            </div>
          </div>
        )}

        {/* Diff 内容 */}
        <div className="flex-1 overflow-auto text-xs">
          {file ? (
            <ReactDiffViewer
              key={file.filename}
              oldValue={file.oldContent}
              newValue={file.newContent}
              splitView={splitView}
              compareMethod={wordLevel ? DiffMethod.WORDS : DiffMethod.LINES}
              showDiffOnly={diffOnly}
              extraLinesSurroundingDiff={3}
              useDarkTheme={isDark}
              {...(renderContent ? { renderContent } : {})}
              styles={{
                line: { fontSize: '11px', fontFamily: 'var(--font-mono)' }
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center h-full text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {tr('review.diff.noFile')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
