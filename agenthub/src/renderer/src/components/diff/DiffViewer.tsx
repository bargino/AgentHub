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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Highlighter } from 'shiki'
import { useT } from '../../i18n'
import type { DiffRecord } from '../../types'
import { extColor } from './fileExt'

/** ReactDiffViewer 配色映射到全站 design token（增删行/词级/gutter/标题），与聊天内
 *  CodeChangeCard、其余面板同源。行级底色用 token 自适应；词级高亮无专用 token，用
 *  color-mix 从语义色派生（不支持时回退 transparent，仅词级失色）。 */
const DIFF_VARS_BASE = {
  diffViewerBackground: 'var(--color-bg-container)',
  diffViewerColor: 'var(--color-text-primary)',
  addedBackground: 'var(--color-success-bg)',
  addedColor: 'var(--color-text-primary)',
  removedBackground: 'var(--color-error-bg)',
  removedColor: 'var(--color-text-primary)',
  addedGutterBackground: 'var(--color-success-bg)',
  removedGutterBackground: 'var(--color-error-bg)',
  gutterBackground: 'var(--color-bg-spotlight)',
  gutterBackgroundDark: 'var(--color-bg-spotlight)',
  gutterColor: 'var(--color-text-tertiary)',
  addedGutterColor: 'var(--color-success)',
  removedGutterColor: 'var(--color-error)',
  highlightBackground: 'var(--color-warning-bg)',
  highlightGutterBackground: 'var(--color-warning-bg)',
  codeFoldBackground: 'var(--color-bg-spotlight)',
  codeFoldGutterBackground: 'var(--color-bg-spotlight)',
  codeFoldContentColor: 'var(--color-text-tertiary)',
  emptyLineBackground: 'var(--color-bg-container)',
  diffViewerTitleBackground: 'var(--color-bg-spotlight)',
  diffViewerTitleColor: 'var(--color-text-secondary)',
  diffViewerTitleBorderColor: 'var(--color-border-light)'
}
// 词级高亮分主题调强：暗色深底 + shiki 语法色下，词级底色需更高 alpha（对齐 GitHub 暗色
// ~40%+ 词级 vs ~14% 行级）才能凸显改动词且不糊；亮色适当降低避免盖住文字。
const DIFF_VARS_LIGHT = {
  ...DIFF_VARS_BASE,
  wordAddedBackground: 'color-mix(in srgb, var(--color-success) 26%, transparent)',
  wordRemovedBackground: 'color-mix(in srgb, var(--color-error) 26%, transparent)'
}
const DIFF_VARS_DARK = {
  ...DIFF_VARS_BASE,
  wordAddedBackground: 'color-mix(in srgb, var(--color-success) 45%, transparent)',
  wordRemovedBackground: 'color-mix(in srgb, var(--color-error) 48%, transparent)'
}

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

/** 监听元素自身宽度（按容器而非视口做响应式：diff 嵌在可调宽右坞内）。 */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** 响应式读取暗色主题：随 [data-theme] 变化即时刷新（对齐 TitleBar/sonner 的 MutationObserver 口径）。
 *  diff 配色靠 token 自适应，但 shiki 语法高亮 theme 与 ReactDiffViewer useDarkTheme 需主动重渲。 */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark')
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

// 容器窄于此宽度时：文件树改为浮层抽屉、次级控件收为图标、强制 unified，避免横向挤压
const NARROW_WIDTH = 560

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

/** GitHub 式 5 格增删占比条：按 增/删 比例填绿/红，余下中性。 */
function DiffStatBar({
  additions,
  deletions
}: {
  additions: number
  deletions: number
}): React.JSX.Element {
  const blocks = 5
  const total = additions + deletions
  let g = total ? Math.round((additions / total) * blocks) : 0
  let r = total ? Math.round((deletions / total) * blocks) : 0
  if (additions > 0 && g === 0) g = 1
  if (deletions > 0 && r === 0) r = 1
  while (g + r > blocks) {
    if (g > r) g--
    else r--
  }
  const cells = Array.from({ length: blocks }, (_, i) =>
    i < g ? 'var(--color-success)' : i < g + r ? 'var(--color-error)' : 'var(--color-border)'
  )
  return (
    <span className="flex items-center gap-0.5 shrink-0" title={`+${additions} -${deletions}`}>
      {cells.map((c, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 1, background: c }} />
      ))}
    </span>
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
  // 窄坞：树改浮层抽屉（treeOpen），默认收起让 diff 占满；宽坞：内联树（treeHidden 控制）
  const [rootRef, width] = useElementWidth<HTMLDivElement>()
  const narrow = width > 0 && width < NARROW_WIDTH
  const [treeOpen, setTreeOpen] = useState(false)
  // 窄坞强制 unified（split 在窄宽不可用，避免横向溢出）
  const effectiveSplit = splitView && !narrow
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

  // 全量增删汇总（工具条 GitHub 式总览：N files +A −B + 占比条）
  const totals = useMemo(
    () =>
      diff.files.reduce((acc, f) => ({ a: acc.a + f.additions, d: acc.d + f.deletions }), {
        a: 0,
        d: 0
      }),
    [diff.files]
  )

  const file = diff.files[fileIndex]
  const isDark = useIsDark()

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

  // 选中文件：窄坞下选完即关闭浮层抽屉
  const selectFile = (idx: number): void => {
    onFileIndexChange(idx)
    if (narrow) setTreeOpen(false)
  }

  // 文件树内容（搜索 + 分组列表），内联与浮层抽屉两种容器复用
  const treeBody = (
    <>
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
                  onClick={() => selectFile(idx)}
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
    </>
  )

  // 树按钮：窄坞开合浮层抽屉；宽坞开合内联树
  const treeShown = narrow ? treeOpen : !treeHidden
  const toggleTree = (): void => (narrow ? setTreeOpen((v) => !v) : setTreeHidden((v) => !v))

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      {/* 工具条：树折叠 / 文件数 / 仅看变更 / 视图切换（窄坞下次级控件收为图标） */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <button
          onClick={toggleTree}
          className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={tr(treeShown ? 'review.diff.hideTree' : 'review.diff.showTree')}
        >
          {treeShown ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <span
          className="text-xs tabular-nums shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {tr('diff.fileCount', { count: diff.files.length })}
        </span>
        {/* 总增删汇总：+A −B 文本（始终显示）+ 占比条（宽坞显示） */}
        <span className="flex items-center gap-1 text-[11px] tabular-nums shrink-0">
          <span style={{ color: 'var(--color-success)' }}>+{totals.a}</span>
          <span style={{ color: 'var(--color-error)' }}>-{totals.d}</span>
        </span>
        {!narrow && <DiffStatBar additions={totals.a} deletions={totals.d} />}
        {!narrow && diff.files.length > 1 && (
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
            className="btn-ghost flex items-center gap-1 px-2 h-7 rounded-md text-[11px] shrink-0"
            style={{ color: wordLevel ? 'var(--color-brand)' : 'var(--color-text-secondary)' }}
            title={tr('review.diff.compareMethod')}
          >
            <WholeWord size={13} />
            {!narrow && (wordLevel ? tr('review.diff.wordLevel') : tr('review.diff.lineLevel'))}
          </button>
          <button
            onClick={() => setDiffOnly((v) => !v)}
            className="btn-ghost flex items-center gap-1 px-2 h-7 rounded-md text-[11px] shrink-0"
            style={{ color: diffOnly ? 'var(--color-brand)' : 'var(--color-text-secondary)' }}
            title={tr('review.diff.collapseUnchanged')}
          >
            <FoldVertical size={13} />
            {!narrow && tr('review.diff.changesOnly')}
          </button>
          {!narrow && <ViewSegmented split={splitView} onChange={setSplitView} />}
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* 内联文件树（宽坞） */}
        {!narrow && treeShown && (
          <div
            className="flex flex-col shrink-0"
            style={{ width: 200, borderRight: '1px solid var(--color-border-light)' }}
          >
            {treeBody}
          </div>
        )}

        {/* 浮层文件树抽屉（窄坞）：不挤占 diff 宽度，点遮罩关闭 */}
        {narrow && treeOpen && (
          <>
            <div
              className="absolute inset-0 z-20"
              style={{ background: 'rgba(0,0,0,0.32)' }}
              onClick={() => setTreeOpen(false)}
            />
            <div
              className="absolute left-0 top-0 bottom-0 z-30 flex flex-col"
              style={{
                width: 'min(240px, 82%)',
                background: 'var(--color-bg-container)',
                borderRight: '1px solid var(--color-border-light)',
                boxShadow: 'var(--shadow-md)'
              }}
            >
              {treeBody}
            </div>
          </>
        )}

        {/* Diff 内容 */}
        <div className="flex-1 min-w-0 overflow-auto text-xs">
          {file ? (
            <ReactDiffViewer
              key={file.filename}
              oldValue={file.oldContent}
              newValue={file.newContent}
              splitView={effectiveSplit}
              compareMethod={wordLevel ? DiffMethod.WORDS : DiffMethod.LINES}
              showDiffOnly={diffOnly}
              extraLinesSurroundingDiff={3}
              useDarkTheme={isDark}
              {...(renderContent ? { renderContent } : {})}
              styles={{
                variables: { light: DIFF_VARS_LIGHT, dark: DIFF_VARS_DARK },
                line: { fontSize: '11px', fontFamily: 'var(--font-mono)' },
                wordAdded: { borderRadius: '2px', padding: '0 1px' },
                wordRemoved: { borderRadius: '2px', padding: '0 1px' }
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
