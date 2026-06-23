import { useCallback, useEffect, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  X,
  RefreshCw,
  FileX
} from 'lucide-react'
import {
  getWorkspaceTree,
  getWorkspaceFile,
  type WsTreeNode,
  type WsFileContent
} from '../../services/api'
import { HttpError } from '../../services/http'
import { useT } from '../../i18n'

/** 文件扩展名 -> 类型色（与 DiffViewer 保持一致的 IDE 配色） */
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#e8a33d',
  jsx: '#e8a33d',
  mjs: '#e8a33d',
  css: '#9d6fe0',
  scss: '#9d6fe0',
  json: '#f59e0b',
  py: '#3572a5',
  html: '#e34c26',
  md: '#6b7280',
  txt: '#6b7280',
  yaml: '#cb4b16',
  yml: '#cb4b16'
}

function extColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? 'var(--color-text-tertiary)'
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpen
}: {
  node: WsTreeNode
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}): React.JSX.Element {
  // 顶层目录默认展开，深层默认折叠，避免一进来就铺满
  const [open, setOpen] = useState(depth < 1)
  const pad = 8 + depth * 12

  if (node.type === 'file') {
    const active = activePath === node.path
    return (
      <button
        onClick={() => onOpen(node.path)}
        className={`flex items-center gap-1.5 w-full py-1 pr-2 text-left border-none cursor-pointer ${
          active ? 'bg-[var(--color-brand-bg)]' : 'bg-transparent hover-spotlight'
        }`}
        style={{ paddingLeft: pad + 14 }}
        title={node.path}
      >
        <FileText size={13} className="shrink-0" style={{ color: extColor(node.name) }} />
        <span
          className="text-xs truncate"
          style={{
            color: active ? 'var(--color-brand)' : 'var(--color-text-primary)',
            fontWeight: active ? 500 : 400
          }}
        >
          {node.name}
        </span>
      </button>
    )
  }

  const children = node.children ?? []
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full py-1 pr-2 text-left border-none bg-transparent cursor-pointer hover-spotlight"
        style={{ paddingLeft: pad }}
        title={node.path || node.name}
      >
        {open ? (
          <ChevronDown
            size={12}
            className="shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        ) : (
          <ChevronRight
            size={12}
            className="shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        )}
        {open ? (
          <FolderOpen size={13} className="shrink-0" style={{ color: 'var(--color-brand)' }} />
        ) : (
          <Folder size={13} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
        )}
        <span className="text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>
          {node.name}
        </span>
      </button>
      {open &&
        children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            activePath={activePath}
            onOpen={onOpen}
          />
        ))}
    </>
  )
}

export function WorkspaceExplorer({ cid }: { cid: string }): React.JSX.Element {
  const tr = useT()
  const [tree, setTree] = useState<WsTreeNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<WsFileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const loadTree = useCallback(async (): Promise<void> => {
    try {
      const t = await getWorkspaceTree(cid)
      setTree(t)
      setNoWorkspace(false)
      setError(null)
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        setNoWorkspace(true)
        setTree(null)
      } else {
        setError(tr('git.loadError'))
      }
    } finally {
      setLoading(false)
    }
  }, [cid, tr])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTree()
  }, [loadTree])

  const openPath = useCallback(
    async (path: string): Promise<void> => {
      setActivePath(path)
      setFileLoading(true)
      try {
        const f = await getWorkspaceFile(cid, path)
        setOpenFile(f)
      } catch {
        setOpenFile({ path, content: '', size: 0, binary: false, truncated: true })
      } finally {
        setFileLoading(false)
      }
    },
    [cid]
  )

  return (
    <div className="relative h-full flex flex-col">
      {/* explorer 工具条 */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('explorer.title')}
        </span>
        <button
          onClick={() => {
            setLoading(true)
            void loadTree()
          }}
          title={tr('git.refresh')}
          className="btn-ghost flex items-center justify-center w-6 h-6 rounded"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && !tree ? (
          <div className="flex items-center justify-center py-12">
            <Loader2
              size={18}
              className="animate-spin"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
          </div>
        ) : noWorkspace ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <Folder size={26} style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('git.noWorkspace')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('git.noWorkspaceSub')}
            </span>
          </div>
        ) : error ? (
          <div
            className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
          >
            {error}
          </div>
        ) : tree && (tree.children?.length ?? 0) > 0 ? (
          <>
            {tree.children!.map((c) => (
              <TreeNode key={c.path} node={c} depth={0} activePath={activePath} onOpen={openPath} />
            ))}
            {tree.truncated && (
              <div
                className="px-3 py-2 text-[11px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {tr('explorer.truncated')}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <Folder size={26} style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('explorer.empty')}
            </span>
          </div>
        )}
      </div>

      {/* 文件内容浮层 */}
      {(openFile || fileLoading) && (
        <div
          className="absolute inset-0 flex flex-col animate-fade-in"
          style={{ background: 'var(--color-bg-container)' }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 shrink-0"
            style={{ borderBottom: '1px solid var(--color-border-light)' }}
          >
            <FileText
              size={13}
              className="shrink-0"
              style={{ color: openFile ? extColor(openFile.path) : 'var(--color-text-tertiary)' }}
            />
            <span
              className="flex-1 text-xs truncate"
              style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}
              title={openFile?.path}
            >
              {openFile?.path ?? activePath}
            </span>
            <button
              onClick={() => {
                setOpenFile(null)
                setActivePath(null)
              }}
              className="btn-ghost flex items-center justify-center w-6 h-6 rounded shrink-0"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={tr('common.close')}
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-auto" style={{ background: 'var(--color-bg-code)' }}>
            {fileLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  size={18}
                  className="animate-spin"
                  style={{ color: 'var(--color-text-tertiary)' }}
                />
              </div>
            ) : openFile?.binary ? (
              <FileStateHint icon={FileX} text={tr('explorer.binary')} />
            ) : openFile?.tooLarge ? (
              <FileStateHint icon={FileX} text={tr('explorer.tooLarge')} />
            ) : (
              <pre
                className="text-[11px] leading-[1.7] whitespace-pre px-3 py-2.5 m-0"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-code)' }}
              >
                {openFile?.content || ''}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FileStateHint({
  icon: Icon,
  text
}: {
  icon: typeof FileX
  text: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
      <Icon size={26} style={{ color: 'var(--color-text-tertiary)' }} />
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </span>
    </div>
  )
}
