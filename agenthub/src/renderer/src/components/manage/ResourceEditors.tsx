import { useEffect, useRef, useState } from 'react'
import {
  Plug,
  FileCode,
  FileText,
  Plus,
  Trash2,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderInput,
  Link2,
  PencilLine,
  FilePlus2,
  type LucideIcon
} from 'lucide-react'
import { Field } from './MasterDetail'
import { fieldInputClass, fieldInputStyle } from './formStyles'
import { useT } from '../../i18n'
import {
  useMcpServers,
  mcpStore,
  skillStore,
  ruleStore,
  serializeMcpRepo,
  parseMcpRepo,
  newSkill,
  PERMISSION_TOOLS,
  MCP_STATUS,
  requestMcpCheck,
  type McpServer,
  type McpStatus,
  type McpKind,
  type SkillItem,
  type SkillFile,
  type SkillOrigin,
  type RuleItem,
  type RuleKind,
  type PermissionAction
} from './mgmtData'

export function McpStatusDot({ status }: { status: McpStatus }): React.JSX.Element {
  const pulsing = status === 'pending'
  return (
    <span
      className={`inline-block shrink-0 rounded-full${pulsing ? ' animate-pulse' : ''}`}
      style={{ width: 7, height: 7, background: MCP_STATUS[status].color }}
    />
  )
}

export function SegButtons<V extends string>({
  options,
  value,
  onChange,
  labelOf
}: {
  options: V[]
  value: V
  onChange: (v: V) => void
  labelOf?: (v: V) => string
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      {options.map((o) => {
        const on = value === o
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: on ? 'var(--color-brand-bg)' : 'var(--color-bg-spotlight)',
              color: on ? 'var(--color-brand)' : 'var(--color-text-secondary)',
              border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-border-light)'}`,
              cursor: 'pointer'
            }}
          >
            {labelOf ? labelOf(o) : o}
          </button>
        )
      })}
    </div>
  )
}

const KIND_KEY: Record<McpKind, string> = {
  local: 'manage.mcpKind.local',
  remote: 'manage.mcpKind.remote'
}

export function McpEditor({ item }: { item: McpServer }): React.JSX.Element {
  const tr = useT()
  const update = (p: Partial<McpServer>): void => mcpStore.update(item.id, p)
  const meta = MCP_STATUS[item.status]
  return (
    <>
      {/* 状态行：自动探活结果 + 手动重测 */}
      <div className="flex items-center justify-between mb-4">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: meta.color }}>
          <McpStatusDot status={item.status} />
          {tr(meta.labelKey)}
          {item.status === 'failed' && item.statusError ? (
            <span style={{ color: 'var(--color-text-tertiary)' }}>· {item.statusError}</span>
          ) : item.lastChecked && item.status === 'connected' ? (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              · {tr('manage.mcpEditor.autoCheck')}
            </span>
          ) : null}
        </span>
        <button
          onClick={() => requestMcpCheck(item)}
          disabled={!item.enabled || item.status === 'pending'}
          className="btn-press flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg"
          style={{
            background: 'var(--color-bg-spotlight)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            cursor: !item.enabled || item.status === 'pending' ? 'default' : 'pointer',
            opacity: item.enabled ? 1 : 0.5
          }}
        >
          <Plug size={13} />
          {tr('manage.mcpEditor.recheck')}
        </button>
      </div>

      <Field label={tr('manage.mcpEditor.connection')}>
        <SegButtons
          options={['local', 'remote'] as McpKind[]}
          value={item.kind}
          onChange={(kind) => update({ kind, status: 'pending' })}
          labelOf={(k) => tr(KIND_KEY[k])}
        />
      </Field>

      {item.kind === 'local' ? (
        <>
          <Field label={tr('manage.mcpEditor.command')} hint={tr('manage.mcpEditor.commandHint')}>
            <textarea
              value={item.command}
              onChange={(e) => update({ command: e.target.value, status: 'pending' })}
              rows={4}
              placeholder={'npx\n-y\n@modelcontextprotocol/server-filesystem\n.'}
              className={`${fieldInputClass} resize-y font-mono`}
              style={fieldInputStyle}
              spellCheck={false}
            />
          </Field>
          <Field label={tr('manage.mcpEditor.env')} hint={tr('manage.mcpEditor.envHint')}>
            <textarea
              value={item.environment}
              onChange={(e) => update({ environment: e.target.value })}
              rows={2}
              placeholder={'API_KEY=xxxx'}
              className={`${fieldInputClass} resize-y font-mono`}
              style={fieldInputStyle}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={tr('manage.mcpEditor.url')}>
            <input
              value={item.url}
              onChange={(e) => update({ url: e.target.value, status: 'pending' })}
              placeholder="https://example.com/mcp"
              className={fieldInputClass}
              style={fieldInputStyle}
            />
          </Field>
          <Field label={tr('manage.mcpEditor.headers')} hint={tr('manage.mcpEditor.envHint')}>
            <textarea
              value={item.headers}
              onChange={(e) => update({ headers: e.target.value })}
              rows={2}
              placeholder={'Authorization=Bearer xxxx'}
              className={`${fieldInputClass} resize-y font-mono`}
              style={fieldInputStyle}
            />
          </Field>
          <Field label={tr('manage.mcpEditor.oauth')} hint={tr('manage.mcpEditor.oauthHint')}>
            <SegButtons
              options={['off', 'on']}
              value={item.oauth ? 'on' : 'off'}
              onChange={(v) => update({ oauth: v === 'on', status: 'pending' })}
              labelOf={(v) => (v === 'on' ? tr('manage.mcpEditor.on') : tr('manage.mcpEditor.off'))}
            />
          </Field>
        </>
      )}

      <Field label={tr('manage.mcpEditor.timeout')} hint={tr('manage.mcpEditor.timeoutHint')}>
        <input
          value={item.timeout ?? ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            update({ timeout: e.target.value.trim() && Number.isFinite(n) ? n : undefined })
          }}
          inputMode="numeric"
          placeholder="5000"
          className={fieldInputClass}
          style={fieldInputStyle}
        />
      </Field>
      <Field label={tr('manage.mcpEditor.desc')}>
        <input
          value={item.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={tr('manage.mcpEditor.descPlaceholder')}
          className={fieldInputClass}
          style={fieldInputStyle}
        />
      </Field>
    </>
  )
}

/** 整库 MCP JSON 编辑器（opencode mcp 格式，应用即整库替换） */
export function McpRepoJson({ onBack }: { onBack: () => void }): React.JSX.Element {
  const tr = useT()
  const servers = useMcpServers()
  const [text, setText] = useState(() => serializeMcpRepo(servers))
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  const apply = (): void => {
    const next = parseMcpRepo(text, servers)
    if (next === null) {
      setErr(true)
      setMsg(tr('manage.mcpRepo.parseError'))
      return
    }
    mcpStore.set(next)
    setErr(false)
    setMsg(tr('manage.mcpRepo.applied', { count: next.length }))
  }

  const reset = (): void => {
    setText(serializeMcpRepo(servers))
    setErr(false)
    setMsg(tr('manage.mcpRepo.reverted'))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onBack}
          className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs rounded-lg"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <ArrowLeft size={13} /> {tr('manage.mcpRepo.back')}
        </button>
        <span className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
          {tr('manage.mcpRepo.heading')}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="px-3 h-7 rounded-lg text-xs font-medium"
            style={{
              background: 'var(--color-bg-spotlight)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer'
            }}
          >
            {tr('manage.mcpRepo.revert')}
          </button>
          <button onClick={apply} className="btn-brand h-7 px-3 rounded-lg text-xs font-medium">
            {tr('manage.mcpRepo.apply')}
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full resize-none outline-none px-4 py-3 text-xs font-mono leading-relaxed"
        style={{
          background: 'var(--color-bg-layout)',
          color: 'var(--color-text-primary)',
          border: 'none'
        }}
      />
      {msg && (
        <div
          className="px-4 py-2 text-xs shrink-0"
          style={{
            borderTop: '1px solid var(--color-border)',
            color: err ? 'var(--color-error)' : 'var(--color-text-secondary)'
          }}
        >
          {msg}
        </div>
      )}
    </div>
  )
}

// ---- Skill：文件夹模型 -----------------------------------------------------
function isSkillMd(path: string): boolean {
  return path.toLowerCase() === 'skill.md'
}

/** 规范化用户输入的文件路径：去首部斜杠、折叠连续斜杠 */
function normPath(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+/g, '/')
}

const ORIGIN_META: Record<SkillOrigin, { labelKey: string; icon: LucideIcon }> = {
  manual: { labelKey: 'manage.skillOrigin.manual', icon: PencilLine },
  local: { labelKey: 'manage.skillOrigin.local', icon: FolderInput },
  remote: { labelKey: 'manage.skillOrigin.remote', icon: Link2 }
}

/** 技能来源只读小徽标 */
function SkillSourceBadge({
  origin,
  originRef
}: {
  origin: SkillOrigin
  originRef?: string
}): React.JSX.Element {
  const tr = useT()
  const meta = ORIGIN_META[origin]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-1.5 mb-3 min-w-0">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] shrink-0"
        style={{
          background: 'var(--color-bg-spotlight)',
          border: '1px solid var(--color-border-light)',
          color: 'var(--color-text-secondary)'
        }}
      >
        <Icon size={11} /> {tr(meta.labelKey)}
      </span>
      {originRef ? (
        <span
          className="text-[11px] truncate font-mono"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={originRef}
        >
          {originRef}
        </span>
      ) : null}
    </div>
  )
}

interface SkillTreeNode {
  name: string
  /** 完整相对路径：文件夹为前缀（如 "scripts"），文件为全路径（如 "scripts/run.sh"） */
  fullPath: string
  isFile: boolean
  children: SkillTreeNode[]
}

/** 由扁平的 files 路径构建文件夹树（SKILL.md 单独置顶，不进树） */
function buildSkillTree(files: SkillFile[]): SkillTreeNode[] {
  const root: SkillTreeNode = { name: '', fullPath: '', isFile: false, children: [] }
  for (const f of files) {
    if (isSkillMd(f.path)) continue
    const parts = f.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let node = root
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1
      const full = parts.slice(0, i + 1).join('/')
      let child = node.children.find((c) => c.name === part && c.isFile === isLeaf)
      if (!child) {
        child = { name: part, fullPath: full, isFile: isLeaf, children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  const sortNodes = (nodes: SkillTreeNode[]): void => {
    nodes.sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(root.children)
  return root.children
}

/** 文件树中的一行（文件或文件夹），按层级缩进 */
function SkillTreeRow({
  depth,
  active,
  locked,
  icon,
  chevron,
  label,
  onClick
}: {
  depth: number
  active: boolean
  locked?: boolean
  icon: React.ReactNode
  chevron?: 'right' | 'down' | null
  label: string
  onClick: () => void
}): React.JSX.Element {
  const tr = useT()
  return (
    <button
      onClick={onClick}
      className={`group/row w-full flex items-center gap-1 pr-2 py-1 text-xs text-left transition-colors${
        active ? '' : ' hover:bg-[var(--color-bg-spotlight)]'
      }`}
      style={{
        paddingLeft: 8 + depth * 12,
        background: active ? 'var(--color-brand-bg)' : 'transparent',
        color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
        border: 'none',
        cursor: 'pointer'
      }}
    >
      <span
        className="shrink-0 w-3 flex items-center justify-center"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {chevron === 'right' ? (
          <ChevronRight size={12} />
        ) : chevron === 'down' ? (
          <ChevronDown size={12} />
        ) : null}
      </span>
      <span className="shrink-0 flex items-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {locked ? (
        <span
          className="ml-auto shrink-0 text-[10px]"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {tr('manage.skillEditor.locked')}
        </span>
      ) : null}
    </button>
  )
}

/** 递归渲染文件夹树 */
function SkillTree({
  nodes,
  depth,
  activePath,
  collapsed,
  onToggleFolder,
  onSelect
}: {
  nodes: SkillTreeNode[]
  depth: number
  activePath: string
  collapsed: Set<string>
  onToggleFolder: (path: string) => void
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) =>
        node.isFile ? (
          <SkillTreeRow
            key={node.fullPath}
            depth={depth}
            active={activePath === node.fullPath}
            icon={<FileCode size={12} />}
            label={node.name}
            onClick={() => onSelect(node.fullPath)}
          />
        ) : (
          <div key={node.fullPath}>
            <SkillTreeRow
              depth={depth}
              active={false}
              icon={collapsed.has(node.fullPath) ? <Folder size={12} /> : <FolderOpen size={12} />}
              chevron={collapsed.has(node.fullPath) ? 'right' : 'down'}
              label={node.name}
              onClick={() => onToggleFolder(node.fullPath)}
            />
            {collapsed.has(node.fullPath) ? null : (
              <SkillTree
                nodes={node.children}
                depth={depth + 1}
                activePath={activePath}
                collapsed={collapsed}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
              />
            )}
          </div>
        )
      )}
    </>
  )
}

export function SkillEditor({ item }: { item: SkillItem }): React.JSX.Element {
  const tr = useT()
  const [activePath, setActivePath] = useState<string>('SKILL.md')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  // 切换技能（item.id 变化）时重置编辑态：渲染期同步复位，避免 effect 内同步 setState 的反模式
  const [prevItemId, setPrevItemId] = useState(item.id)
  if (item.id !== prevItemId) {
    setPrevItemId(item.id)
    setActivePath('SKILL.md')
    setAdding(false)
    setNewName('')
  }

  const files = item.files
  const skillMd = files.find((f) => isSkillMd(f.path)) ?? null
  const active = files.find((f) => f.path === activePath) ?? skillMd ?? files[0] ?? null
  const tree = buildSkillTree(files)

  const writeFiles = (next: SkillFile[]): void => skillStore.update(item.id, { files: next })

  const setContent = (content: string): void => {
    if (!active) return
    writeFiles(files.map((f) => (f.path === active.path ? { ...f, content } : f)))
  }

  const renameActive = (raw: string): void => {
    if (!active || isSkillMd(active.path)) return
    const path = normPath(raw)
    if (!path || isSkillMd(path) || files.some((f) => f.path === path && f !== active)) return
    writeFiles(files.map((f) => (f.path === active.path ? { ...f, path } : f)))
    setActivePath(path)
  }

  const expandAncestors = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      const segs = path.split('/').filter(Boolean)
      for (let i = 1; i < segs.length; i++) next.delete(segs.slice(0, i).join('/'))
      return next
    })

  const addFileAt = (raw: string): void => {
    const path = normPath(raw)
    if (!path || isSkillMd(path) || files.some((f) => f.path === path)) {
      setAdding(false)
      setNewName('')
      return
    }
    writeFiles([...files, { path, content: '' }])
    expandAncestors(path)
    setActivePath(path)
    setAdding(false)
    setNewName('')
  }

  const removeActive = (): void => {
    if (!active || isSkillMd(active.path)) return
    const next = files.filter((f) => f.path !== active.path)
    writeFiles(next)
    setActivePath(next.find((f) => isSkillMd(f.path))?.path ?? next[0]?.path ?? 'SKILL.md')
  }

  const toggleFolder = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <>
      <SkillSourceBadge origin={item.origin} originRef={item.originRef} />
      <Field label={tr('manage.skillEditor.descLabel')} hint={tr('manage.skillEditor.descHint')}>
        <input
          value={item.description}
          onChange={(e) => skillStore.update(item.id, { description: e.target.value })}
          placeholder={tr('manage.skillEditor.descPlaceholder')}
          className={fieldInputClass}
          style={fieldInputStyle}
        />
      </Field>
      <Field label={tr('manage.skillEditor.category')}>
        <input
          value={item.category}
          onChange={(e) => skillStore.update(item.id, { category: e.target.value })}
          placeholder={tr('manage.skillEditor.categoryPlaceholder')}
          className={fieldInputClass}
          style={fieldInputStyle}
        />
      </Field>

      <div className="mt-1">
        <div
          className="text-xs font-medium mb-1.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {tr('manage.skillEditor.folder')}
        </div>
        <div
          className="flex rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border-light)', height: 360 }}
        >
          {/* 左：文件树（SKILL.md 置顶锁定 + 子目录可折叠） */}
          <div
            className="shrink-0 overflow-y-auto py-1"
            style={{
              width: 208,
              borderRight: '1px solid var(--color-border-light)',
              background: 'var(--color-bg-spotlight)'
            }}
          >
            <SkillTreeRow
              depth={0}
              active={!!active && isSkillMd(active.path)}
              locked
              icon={<FileText size={12} />}
              label="SKILL.md"
              onClick={() => setActivePath(skillMd?.path ?? 'SKILL.md')}
            />
            <SkillTree
              nodes={tree}
              depth={0}
              activePath={active && !isSkillMd(active.path) ? active.path : ''}
              collapsed={collapsed}
              onToggleFolder={toggleFolder}
              onSelect={setActivePath}
            />
            {adding ? (
              <div className="px-2 py-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => addFileAt(newName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addFileAt(newName)
                    if (e.key === 'Escape') {
                      setAdding(false)
                      setNewName('')
                    }
                  }}
                  placeholder="scripts/run.sh"
                  className="w-full px-2 py-1 text-xs rounded-md outline-none border font-mono"
                  style={{
                    background: 'var(--color-bg-container)',
                    borderColor: 'var(--color-brand)',
                    color: 'var(--color-text-primary)'
                  }}
                  spellCheck={false}
                />
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-[var(--color-bg-container)]"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-tertiary)',
                  cursor: 'pointer'
                }}
              >
                <Plus size={12} /> {tr('manage.skillEditor.newFile')}
              </button>
            )}
          </div>

          {/* 右：选中文件编辑 */}
          <div
            className="flex-1 flex flex-col min-w-0"
            style={{ background: 'var(--color-bg-container)' }}
          >
            {active ? (
              <>
                <div
                  className="flex items-center gap-2 px-2.5 py-2 shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border-light)' }}
                >
                  <input
                    value={active.path}
                    onChange={(e) => renameActive(e.target.value)}
                    disabled={isSkillMd(active.path)}
                    title={
                      isSkillMd(active.path)
                        ? tr('manage.skillEditor.skillMdNoRename')
                        : tr('manage.skillEditor.pathHint')
                    }
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg outline-none border font-mono"
                    style={{
                      background: isSkillMd(active.path)
                        ? 'var(--color-bg-layout)'
                        : 'var(--color-bg-spotlight)',
                      borderColor: 'var(--color-border-light)',
                      color: 'var(--color-text-primary)'
                    }}
                    spellCheck={false}
                  />
                  <button
                    onClick={removeActive}
                    disabled={isSkillMd(active.path)}
                    title={
                      isSkillMd(active.path)
                        ? tr('manage.skillEditor.skillMdNoDelete')
                        : tr('manage.skillEditor.deleteFile')
                    }
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{
                      background: 'var(--color-bg-spotlight)',
                      border: '1px solid var(--color-border)',
                      color: isSkillMd(active.path)
                        ? 'var(--color-text-tertiary)'
                        : 'var(--color-error)',
                      cursor: isSkillMd(active.path) ? 'not-allowed' : 'pointer',
                      opacity: isSkillMd(active.path) ? 0.5 : 1
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <textarea
                  value={active.content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={
                    isSkillMd(active.path)
                      ? tr('manage.skillEditor.skillMdPlaceholder')
                      : tr('manage.skillEditor.filePlaceholder')
                  }
                  className="flex-1 w-full px-3 py-2.5 text-xs outline-none resize-none font-mono leading-relaxed"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-primary)'
                  }}
                  spellCheck={false}
                />
              </>
            ) : (
              <div
                className="flex-1 flex items-center justify-center text-xs px-6 text-center"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {tr('manage.skillEditor.pickFile')}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ---- 添加技能：三选一来源菜单（新建空技能 / 本地文件夹 / URL）------------------
/** + 按钮 + 下拉：选择技能来源后回调创建好的 SkillItem（来源仅在此处录入，之后只读） */
export function AddSkillMenu({
  onCreate
}: {
  onCreate: (skill: SkillItem) => void
}): React.JSX.Element {
  const tr = useT()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'local' | 'remote'>('menu')
  const [value, setValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const close = (): void => {
    setOpen(false)
    setMode('menu')
    setValue('')
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pickManual = (): void => {
    onCreate(newSkill('manual'))
    close()
  }
  const confirmImport = (origin: 'local' | 'remote'): void => {
    const ref2 = value.trim()
    if (!ref2) return
    onCreate(newSkill(origin, ref2))
    close()
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title={tr('manage.addSkill.title')}
        className="btn-press w-7 h-7 rounded-lg flex items-center justify-center text-white"
        style={{ background: 'var(--gradient-brand)', boxShadow: 'var(--shadow-sm)' }}
      >
        <Plus size={15} />
      </button>
      {open ? (
        <div
          className="absolute right-0 mt-1 rounded-xl p-1"
          style={{
            width: 248,
            zIndex: 300,
            background: 'var(--color-bg-elevated, #fff)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-float)'
          }}
        >
          {mode === 'menu' ? (
            <>
              <AddSkillMenuRow
                icon={<FilePlus2 size={14} />}
                title={tr('manage.addSkill.blank')}
                sub={tr('manage.addSkill.blankSub')}
                onClick={pickManual}
              />
              <AddSkillMenuRow
                icon={<FolderInput size={14} />}
                title={tr('manage.addSkill.fromLocal')}
                sub={tr('manage.addSkill.fromLocalSub')}
                onClick={() => setMode('local')}
              />
              <AddSkillMenuRow
                icon={<Link2 size={14} />}
                title={tr('manage.addSkill.fromUrl')}
                sub={tr('manage.addSkill.fromUrlSub')}
                onClick={() => setMode('remote')}
              />
            </>
          ) : (
            <div className="p-1.5 flex flex-col gap-2">
              <div
                className="text-[11px] font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {mode === 'local'
                  ? tr('manage.addSkill.localPath')
                  : tr('manage.addSkill.remoteUrl')}
              </div>
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmImport(mode)
                  if (e.key === 'Escape') setMode('menu')
                }}
                placeholder={
                  mode === 'local' ? '~/.agents/skills/foo' : 'https://example.com/skills/foo'
                }
                className="w-full px-2 py-1.5 text-xs rounded-lg outline-none border font-mono"
                style={{
                  background: 'var(--color-bg-spotlight)',
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text-primary)'
                }}
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode('menu')}
                  className="flex-1 h-7 rounded-md text-xs"
                  style={{
                    background: 'var(--color-bg-spotlight)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  {tr('manage.addSkill.back')}
                </button>
                <button
                  onClick={() => confirmImport(mode)}
                  disabled={!value.trim()}
                  className="btn-brand flex-1 h-7 rounded-md text-xs font-medium"
                  style={{ opacity: value.trim() ? 1 : 0.5 }}
                >
                  {tr('manage.addSkill.import')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function AddSkillMenuRow({
  icon,
  title,
  sub,
  onClick
}: {
  icon: React.ReactNode
  title: string
  sub: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-[var(--color-bg-spotlight)]"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
    >
      <span
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg"
        style={{ background: 'var(--color-bg-spotlight)', color: 'var(--color-brand)' }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        <span
          className="block text-[11px] truncate"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {sub}
        </span>
      </span>
    </button>
  )
}

// ---- Rule：指令文件 / 工具权限 ---------------------------------------------
const RULE_KIND_KEY: Record<RuleKind, string> = {
  instruction: 'manage.ruleKind.instruction',
  permission: 'manage.ruleKind.permission'
}
const ACTION_KEY: Record<PermissionAction, string> = {
  allow: 'manage.actionLabel.allow',
  ask: 'manage.actionLabel.ask',
  deny: 'manage.actionLabel.deny'
}
const ACTION_COLOR: Record<PermissionAction, string> = {
  allow: 'var(--color-success)',
  ask: 'var(--color-warning)',
  deny: 'var(--color-error)'
}

export function RuleEditor({ item }: { item: RuleItem }): React.JSX.Element {
  const tr = useT()
  const update = (p: Partial<RuleItem>): void => ruleStore.update(item.id, p)
  const setPerm = (tool: string, action: PermissionAction): void =>
    update({ permissions: { ...item.permissions, [tool]: action } })

  return (
    <>
      <Field label={tr('manage.ruleEditor.type')}>
        <SegButtons
          options={['instruction', 'permission'] as RuleKind[]}
          value={item.kind}
          onChange={(kind) => update({ kind })}
          labelOf={(k) => tr(RULE_KIND_KEY[k])}
        />
      </Field>
      <Field label={tr('manage.ruleEditor.desc')}>
        <input
          value={item.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={tr('manage.ruleEditor.descPlaceholder')}
          className={fieldInputClass}
          style={fieldInputStyle}
        />
      </Field>

      {item.kind === 'instruction' ? (
        <Field label={tr('manage.ruleEditor.content')} hint={tr('manage.ruleEditor.contentHint')}>
          <textarea
            value={item.content}
            onChange={(e) => update({ content: e.target.value })}
            rows={12}
            placeholder={tr('manage.ruleEditor.contentPlaceholder')}
            className={`${fieldInputClass} resize-y leading-relaxed`}
            style={fieldInputStyle}
          />
        </Field>
      ) : (
        <div className="mt-1">
          <div
            className="text-xs font-medium mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {tr('manage.ruleEditor.permsTitle')}
          </div>
          <div className="flex flex-col gap-1.5">
            {PERMISSION_TOOLS.map((tool) => {
              const current = item.permissions[tool] ?? 'ask'
              return (
                <div
                  key={tool}
                  className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{
                    background: 'var(--color-bg-spotlight)',
                    border: '1px solid var(--color-border-light)'
                  }}
                >
                  <span
                    className="text-xs font-mono flex items-center gap-1.5"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 6, height: 6, background: ACTION_COLOR[current] }}
                    />
                    {tool}
                  </span>
                  <div className="flex gap-1">
                    {(['allow', 'ask', 'deny'] as PermissionAction[]).map((a) => {
                      const on = current === a
                      return (
                        <button
                          key={a}
                          onClick={() => setPerm(tool, a)}
                          className="px-2.5 py-1 text-[11px] rounded-md transition-colors"
                          style={{
                            background: on ? ACTION_COLOR[a] : 'var(--color-bg-container)',
                            color: on ? '#fff' : 'var(--color-text-secondary)',
                            border: `1px solid ${on ? ACTION_COLOR[a] : 'var(--color-border-light)'}`,
                            cursor: 'pointer'
                          }}
                        >
                          {tr(ACTION_KEY[a])}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
