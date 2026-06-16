import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw,
  GitBranch,
  FileText,
  FolderOpen,
  FolderTree,
  History,
  FileDiff,
  Loader2,
  Check
} from 'lucide-react'
import { useAppStore } from '../../store'
import { HttpError } from '../../services/http'
import { t, useT } from '../../i18n'
import {
  getGitStatus,
  getGitDiff,
  getGitLog,
  type GitStatus,
  type GitStatusFile,
  type GitCommit
} from '../../services/api'
import { WorkspaceExplorer } from './WorkspaceExplorer'

type Tab = 'explorer' | 'changes' | 'diff' | 'log'

const TABS: { key: Tab; labelKey: string; icon: typeof FileText }[] = [
  { key: 'explorer', labelKey: 'git.tab.explorer', icon: FolderTree },
  { key: 'changes', labelKey: 'git.tab.changes', icon: FileText },
  { key: 'diff', labelKey: 'Diff', icon: FileDiff },
  { key: 'log', labelKey: 'git.tab.log', icon: History }
]

/** porcelain 两位状态码 -> 视觉（优先未暂存位） */
function fileBadge(f: GitStatusFile): { label: string; color: string } {
  const code = f.unstaged || f.staged
  switch (code) {
    case 'M':
      return { label: 'M', color: 'var(--color-warning)' }
    case 'A':
    case '?':
      return { label: code === '?' ? 'U' : 'A', color: 'var(--color-success)' }
    case 'D':
      return { label: 'D', color: 'var(--color-error)' }
    case 'R':
      return { label: 'R', color: 'var(--color-brand)' }
    default:
      return { label: code || 'M', color: 'var(--color-text-secondary)' }
  }
}

/** 变更文件按目录分组（目录 -> 文件名列表），形成轻量文件树 */
function groupByDir(files: GitStatusFile[]): { dir: string; items: GitStatusFile[] }[] {
  const map = new Map<string, GitStatusFile[]>()
  for (const f of files) {
    const norm = f.path.replace(/\\/g, '/')
    const idx = norm.lastIndexOf('/')
    const dir = idx >= 0 ? norm.slice(0, idx) : ''
    const list = map.get(dir) ?? []
    list.push(f)
    map.set(dir, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, items]) => ({ dir, items }))
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.split('/').pop() ?? p
}

/** unified diff 按行着色渲染 */
function DiffText({ text }: { text: string }): React.JSX.Element {
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <div
      className="text-[11px] leading-[1.7] whitespace-pre overflow-x-auto px-3 py-2.5"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {lines.map((line, i) => {
        let color = 'var(--color-text-secondary)'
        let bg = 'transparent'
        if (line.startsWith('+') && !line.startsWith('+++')) {
          color = 'var(--color-success)'
          bg = 'var(--color-success-bg)'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          color = 'var(--color-error)'
          bg = 'var(--color-error-bg)'
        } else if (line.startsWith('@@')) {
          color = 'var(--color-brand)'
        } else if (line.startsWith('diff --git') || line.startsWith('index ')) {
          color = 'var(--color-text-primary)'
        }
        return (
          <div key={i} style={{ color, background: bg }}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return t('git.time.justNow')
  if (sec < 3600) return t('git.time.minutesAgo', { n: Math.floor(sec / 60) })
  if (sec < 86400) return t('git.time.hoursAgo', { n: Math.floor(sec / 3600) })
  return t('git.time.daysAgo', { n: Math.floor(sec / 86400) })
}

function EmptyHint({
  icon: Icon,
  text,
  sub
}: {
  icon: typeof FileText
  text: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
      <Icon size={28} style={{ color: 'var(--color-text-tertiary)' }} />
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

export function GitPanel(): React.JSX.Element | null {
  const activeId = useAppStore((s) => s.activeConversationId)

  if (!activeId) return null

  // key 重挂载：切换会话时加载态与数据随之重置
  return <GitPanelBody key={activeId} cid={activeId} />
}

function GitPanelBody({ cid }: { cid: string }): React.JSX.Element {
  const tr = useT()
  const [tab, setTab] = useState<Tab>('explorer')
  const [loading, setLoading] = useState(true)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [diff, setDiff] = useState('')
  const [commits, setCommits] = useState<GitCommit[]>([])

  // 全部 setState 位于 await 之后（异步回调段），不在 effect 同步段触发级联渲染
  const fetchAll = useCallback(async (): Promise<void> => {
    try {
      const [st, df, lg] = await Promise.all([getGitStatus(cid), getGitDiff(cid), getGitLog(cid)])
      setStatus(st)
      setDiff(df.available ? df.diff : '')
      setCommits(lg)
      setError(null)
      setNoWorkspace(false)
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        // workspace 在首次执行任务时才创建
        setNoWorkspace(true)
        setStatus(null)
        setDiff('')
        setCommits([])
      } else {
        setError(t('git.loadError'))
      }
    } finally {
      setLoading(false)
    }
  }, [cid])

  useEffect(() => {
    // 异步数据加载：setState 均在网络响应回调段执行，不在 effect 同步段（规则对 async 穿透误报）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll()
  }, [fetchAll])

  const handleRefresh = (): void => {
    setLoading(true)
    setError(null)
    void fetchAll()
  }

  const files = status?.files ?? []
  const groups = groupByDir(files)

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--color-bg-container)' }}
    >
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-sm font-semibold shrink-0"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {tr('git.files')}
          </span>
          {status?.available && status.branch && (
            <span
              className="flex items-center gap-1 text-xs truncate"
              style={{ color: 'var(--color-text-secondary)' }}
              title={tr('git.branch', { name: status.branch })}
            >
              <GitBranch size={12} className="shrink-0" />
              {status.branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleRefresh}
            title={tr('git.refresh')}
            className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div
        className="flex items-center gap-1 px-3 pt-2 pb-0 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        {TABS.map(({ key, labelKey, icon: Icon }) => {
          const active = tab === key
          const count = key === 'changes' && files.length > 0 ? ` ${files.length}` : ''
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer border-none bg-transparent"
              style={{
                color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                borderBottom: `2px solid ${active ? 'var(--color-brand)' : 'transparent'}`,
                marginBottom: -1,
                transition: 'color var(--transition-fast)'
              }}
            >
              <Icon size={13} />
              {labelKey === 'Diff' ? 'Diff' : tr(labelKey)}
              {count}
            </button>
          )
        })}
      </div>

      {/* body：explorer 自管滚动与数据，其余 git 标签共用下方容器 */}
      {tab === 'explorer' ? (
        <div className="flex-1 overflow-hidden">
          <WorkspaceExplorer cid={cid} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div
              className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
            >
              {error}
            </div>
          )}

          {noWorkspace ? (
            <EmptyHint
              icon={FolderOpen}
              text={tr('git.noWorkspace')}
              sub={tr('git.noWorkspaceSub')}
            />
          ) : !status && loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2
                size={18}
                className="animate-spin"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
            </div>
          ) : status && !status.available ? (
            <EmptyHint icon={GitBranch} text={tr('git.notGitRepo')} sub={status.error} />
          ) : (
            <>
              {tab === 'changes' &&
                (files.length === 0 ? (
                  <EmptyHint icon={Check} text={tr('git.clean')} sub={tr('git.cleanSub')} />
                ) : (
                  <div className="py-2">
                    {groups.map(({ dir, items }) => (
                      <div key={dir || '.'} className="mb-1">
                        <div
                          className="flex items-center gap-1.5 px-4 py-1 text-[11px] truncate"
                          style={{ color: 'var(--color-text-tertiary)' }}
                          title={dir || tr('git.rootDir')}
                        >
                          <FolderOpen size={11} className="shrink-0" />
                          {dir || tr('git.rootDir')}
                        </div>
                        {items.map((f) => {
                          const badge = fileBadge(f)
                          return (
                            <div
                              key={f.path}
                              className="hover-spotlight flex items-center gap-2 pl-8 pr-4 py-1.5 cursor-default"
                              title={f.path}
                            >
                              <FileText
                                size={12}
                                className="shrink-0"
                                style={{ color: 'var(--color-text-tertiary)' }}
                              />
                              <span
                                className="flex-1 text-xs truncate"
                                style={{ color: 'var(--color-text-primary)' }}
                              >
                                {basename(f.path)}
                              </span>
                              <span
                                className="shrink-0 text-[11px] font-semibold w-4 text-center"
                                style={{ color: badge.color }}
                              >
                                {badge.label}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                ))}

              {tab === 'diff' &&
                (diff.trim() === '' ? (
                  <EmptyHint icon={FileDiff} text={tr('git.noDiff')} sub={tr('git.noDiffSub')} />
                ) : (
                  <DiffText text={diff} />
                ))}

              {tab === 'log' &&
                (commits.length === 0 ? (
                  <EmptyHint icon={History} text={tr('git.noCommits')} />
                ) : (
                  <div className="py-2">
                    {commits.map((c) => (
                      <div key={c.hash} className="hover-spotlight px-4 py-2 cursor-default">
                        <div
                          className="text-xs truncate"
                          style={{ color: 'var(--color-text-primary)' }}
                          title={c.subject}
                        >
                          {c.subject}
                        </div>
                        <div
                          className="flex items-center gap-2 mt-0.5 text-[11px]"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          <span
                            className="px-1 rounded"
                            style={{
                              fontFamily: "'JetBrains Mono', Consolas, monospace",
                              background: 'var(--color-bg-spotlight)'
                            }}
                          >
                            {c.hash}
                          </span>
                          <span className="truncate">{c.author}</span>
                          <span className="ml-auto shrink-0">{timeAgo(c.date)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
