import { useState } from 'react'
import {
  X,
  Search,
  Plus,
  Trash2,
  Upload,
  Check,
  Loader2,
  RefreshCw,
  Code2,
  Server,
  Sparkles,
  ScrollText,
  type LucideIcon
} from 'lucide-react'
import { useAppStore } from '../../store'
import type { Conversation } from '../../types'
import { useT } from '../../i18n'
import { ModalOverlay } from '../ui/Modal'
import { Toggle } from './MasterDetail'
import { McpEditor, SkillEditor, AddSkillMenu, RuleEditor, McpRepoJson } from './ResourceEditors'
import {
  useMcpServers,
  useSkills,
  useRules,
  mcpStore,
  skillStore,
  ruleStore,
  newId,
  newSkill,
  parseSkillImport,
  parseMcpImport,
  isSelected,
  selectionCount,
  toggleSelection,
  MCP_STATUS,
  requestMcpCheck,
  useMcpAutoCheck,
  type Selection,
  type McpServer,
  type McpKind,
  type SkillItem,
  type RuleItem,
  type RuleKind,
  type PermissionAction
} from './mgmtData'

type TabKey = 'mcp' | 'skills' | 'rules'

interface StoreOps<T> {
  add: (item: T) => void
  update: (id: string, patch: Partial<T>) => void
  remove: (id: string) => void
}

const KIND_KEY: Record<McpKind, string> = {
  local: 'manage.mcpKind.local',
  remote: 'manage.mcpKind.remote'
}
const RULE_KIND_KEY: Record<RuleKind, string> = {
  instruction: 'manage.ruleKind.instruction',
  permission: 'manage.ruleKind.permission'
}

function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function toRecords(raw: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
}

// ----------------------------------------------------------------------------
// 单个 tab：左列表（勾选=群启用 + 增删搜索导入）｜右编辑器（库级启用 + 类型化编辑）
// ----------------------------------------------------------------------------
interface TabConfig<T> {
  store: StoreOps<T>
  typeName: string
  rowMeta: (t: T) => { sub?: string; accent: string }
  makeNew: () => T
  /** 解析导入文本（已是该类型专用解析，含标准 JSON 兼容） */
  parseImport: (raw: string) => T[]
  importPlaceholder: string
  renderEditor: (t: T) => React.ReactNode
  /** 顶部工具条额外按钮（如 MCP 刷新全部） */
  toolbarExtra?: React.ReactNode
  /** 自定义新建控件（提供时替换默认「+」按钮，如技能的来源选择菜单） */
  createControl?: (onCreate: (item: T) => void) => React.ReactNode
  /** 是否显示库级启用开关（仅 MCP；技能/规则严格对齐 mimocode 不带开关） */
  showEnable?: boolean
}

function ResourceTab<T extends { id: string; name: string; enabled: boolean }>({
  items,
  selection,
  setSelection,
  config
}: {
  items: T[]
  selection: Selection
  setSelection: (s: Selection) => void
  config: TabConfig<T>
}): React.JSX.Element {
  const tr = useT()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const allIds = items.map((i) => i.id)
  const total = items.length
  const enabled = selectionCount(selection, total)
  const q = search.trim().toLowerCase()
  const visible = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
  const selected = items.find((i) => i.id === selectedId) ?? null

  const handleCreate = (item: T): void => {
    config.store.add(item)
    setSelectedId(item.id)
  }
  const create = (): void => handleCreate(config.makeNew())

  const runImport = (): void => {
    setImportMsg(null)
    const parsed = config.parseImport(importText)
    if (parsed.length === 0) {
      setImportMsg(tr('manage.groupModal.importNotFound'))
      return
    }
    parsed.forEach((it) => config.store.add(it))
    setImportMsg(tr('manage.groupModal.importSuccess', { count: parsed.length }))
    setImportText('')
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左列 */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 300, borderRight: '1px solid var(--color-border)' }}
      >
        <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('manage.groupModal.searchPrefix', { type: config.typeName })}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg outline-none border"
                style={{
                  background: 'var(--color-bg-spotlight)',
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text-primary)'
                }}
              />
            </div>
            {config.toolbarExtra}
            {config.createControl ? (
              config.createControl(handleCreate)
            ) : (
              <button
                onClick={create}
                title={tr('manage.groupModal.createPrefix', { type: config.typeName })}
                className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white"
                style={{ background: 'var(--gradient-brand)' }}
              >
                <Plus size={15} />
              </button>
            )}
            <button
              onClick={() => setImportOpen((v) => !v)}
              title={tr('manage.groupModal.import')}
              className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                background: importOpen ? 'var(--color-brand-bg)' : 'var(--color-bg-spotlight)',
                border: '1px solid var(--color-border)',
                color: importOpen ? 'var(--color-brand)' : 'var(--color-text-secondary)'
              }}
            >
              <Upload size={14} />
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('manage.groupModal.enableInGroupPrefix')}{' '}
              {selection === 'all'
                ? tr('manage.groupModal.enableAll', { total })
                : `${enabled}/${total}`}
            </span>
            <span className="flex items-center gap-2">
              <button
                onClick={() => setSelection('all')}
                className="cursor-pointer bg-transparent border-none"
                style={{
                  color: enabled === total ? 'var(--color-text-tertiary)' : 'var(--color-brand)'
                }}
              >
                {tr('manage.groupModal.selectAll')}
              </button>
              <span style={{ color: 'var(--color-border)' }}>·</span>
              <button
                onClick={() => setSelection([])}
                className="cursor-pointer bg-transparent border-none"
                style={{
                  color: enabled === 0 ? 'var(--color-text-tertiary)' : 'var(--color-brand)'
                }}
              >
                {tr('manage.groupModal.clear')}
              </button>
            </span>
          </div>
          {importOpen && (
            <div
              className="rounded-lg p-2 flex flex-col gap-2"
              style={{
                background: 'var(--color-bg-spotlight)',
                border: '1px solid var(--color-border-light)'
              }}
            >
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={5}
                placeholder={config.importPlaceholder}
                className="w-full text-[11px] rounded-md p-2 outline-none resize-y font-mono"
                style={{
                  background: 'var(--color-bg-container)',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text-primary)'
                }}
                spellCheck={false}
              />
              {importMsg && (
                <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  {importMsg}
                </span>
              )}
              <button onClick={runImport} className="btn-brand h-7 rounded-md text-xs font-medium">
                {tr('manage.groupModal.confirmImport')}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {visible.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
              {total === 0
                ? tr('manage.groupModal.emptyNew', { type: config.typeName })
                : tr('manage.groupModal.noMatch')}
            </p>
          ) : (
            visible.map((it) => {
              const on = isSelected(selection, it.id) && it.enabled
              const meta = config.rowMeta(it)
              const active = it.id === selectedId
              const disabled = !it.enabled
              return (
                <div
                  key={it.id}
                  className="group/row flex items-center gap-2 px-2 py-2 rounded-lg mb-0.5"
                  style={{ background: active ? 'var(--color-brand-bg)' : 'transparent' }}
                >
                  {/* 群启用勾选（库级禁用时不可勾） */}
                  <button
                    onClick={() => {
                      if (disabled) return
                      setSelection(toggleSelection(selection, it.id, allIds))
                    }}
                    title={
                      disabled
                        ? tr('manage.groupModal.disabledInRepo')
                        : on
                          ? tr('manage.groupModal.enabledInGroup')
                          : tr('manage.groupModal.notEnabledInGroup')
                    }
                    className="shrink-0 flex items-center justify-center rounded"
                    style={{
                      width: 16,
                      height: 16,
                      background: on ? 'var(--color-brand)' : 'transparent',
                      border: `1.5px solid ${on ? 'var(--color-brand)' : 'var(--color-border)'}`,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.4 : 1
                    }}
                  >
                    {on && <Check size={11} strokeWidth={3} color="#fff" />}
                  </button>
                  {/* 状态点 */}
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: 7,
                      height: 7,
                      background: meta.accent,
                      opacity: disabled ? 0.4 : 1
                    }}
                  />
                  {/* 主体（点击进入编辑） */}
                  <button
                    onClick={() => setSelectedId(it.id)}
                    className="min-w-0 flex-1 text-left bg-transparent border-none cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="text-sm font-medium truncate"
                        style={{
                          color: active ? 'var(--color-brand)' : 'var(--color-text-primary)',
                          opacity: disabled ? 0.5 : 1
                        }}
                      >
                        {it.name || tr('manage.groupModal.unnamed', { type: config.typeName })}
                      </span>
                      {disabled && (
                        <span
                          className="shrink-0 text-[10px] px-1 rounded"
                          style={{
                            background: 'var(--color-bg-spotlight)',
                            color: 'var(--color-text-tertiary)'
                          }}
                        >
                          {tr('manage.groupModal.disabledBadge')}
                        </span>
                      )}
                    </span>
                    {meta.sub ? (
                      <span
                        className="block text-[11px] truncate"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        {meta.sub}
                      </span>
                    ) : null}
                  </button>
                  {/* 删除 */}
                  <button
                    onClick={() => {
                      config.store.remove(it.id)
                      if (selectedId === it.id) setSelectedId(null)
                    }}
                    title={tr('manage.groupModal.deleteFromRepo')}
                    className="shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover/row:opacity-100 cursor-pointer bg-transparent border-none"
                    style={{ color: 'var(--color-error)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 右编辑器 */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-bg-layout)' }}>
        {selected ? (
          <div className="max-w-2xl px-6 py-5">
            {/* 名称 + 库级启用开关 */}
            <div className="flex items-center gap-3 mb-5">
              <input
                value={selected.name}
                onChange={(e) =>
                  config.store.update(selected.id, { name: e.target.value } as Partial<T>)
                }
                placeholder={tr('manage.detail.namePlaceholder')}
                className="flex-1 text-base font-semibold outline-none bg-transparent"
                style={{ color: 'var(--color-text-primary)', border: 'none' }}
              />
              {config.showEnable ? (
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {selected.enabled
                      ? tr('manage.groupModal.enabledLabel')
                      : tr('manage.groupModal.disabledLabel')}
                  </span>
                  <Toggle
                    checked={selected.enabled}
                    onChange={(v) => config.store.update(selected.id, { enabled: v } as Partial<T>)}
                  />
                </span>
              ) : null}
            </div>
            {config.renderEditor(selected)}
          </div>
        ) : (
          <div
            className="h-full flex items-center justify-center text-sm px-8 text-center"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {tr('manage.groupModal.pickItem')}
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// 悬浮模态
// ----------------------------------------------------------------------------
const TABS: { key: TabKey; labelKey: string; icon: LucideIcon }[] = [
  { key: 'mcp', labelKey: 'MCP', icon: Server },
  { key: 'skills', labelKey: 'manage.groupModal.tabSkills', icon: Sparkles },
  { key: 'rules', labelKey: 'manage.groupModal.tabRules', icon: ScrollText }
]

export interface GroupResourceModalProps {
  conv: Conversation
  initialTab: TabKey
  initialSel: { mcp: Selection; skills: Selection; rules: Selection }
  onClose: () => void
  onSaved: (sel: { mcp: Selection; skills: Selection; rules: Selection }) => void
}

export function GroupResourceModal({
  conv,
  initialTab,
  initialSel,
  onClose,
  onSaved
}: GroupResourceModalProps): React.JSX.Element {
  const tr = useT()
  const [tab, setTab] = useState<TabKey>(initialTab)
  const mcpServers = useMcpServers()
  const skills = useSkills()
  const rules = useRules()
  const [mcpSel, setMcpSel] = useState<Selection>(initialSel.mcp)
  const [skillSel, setSkillSel] = useState<Selection>(initialSel.skills)
  const [ruleSel, setRuleSel] = useState<Selection>(initialSel.rules)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mcpJson, setMcpJson] = useState(false)

  // 打开面板即自动探活（禁用→disabled、pending→探活）
  useMcpAutoCheck()

  const refreshAllMcp = (): void => {
    setRefreshing(true)
    mcpServers.forEach((srv) => requestMcpCheck(srv))
    window.setTimeout(() => setRefreshing(false), 700)
  }

  const mcpConfig: TabConfig<McpServer> = {
    store: mcpStore,
    typeName: tr('manage.groupModal.typeMcp'),
    importPlaceholder: tr('manage.groupModal.mcpImportPlaceholder'),
    rowMeta: (m) => ({
      sub: `${tr(KIND_KEY[m.kind])} · ${tr(MCP_STATUS[m.status].labelKey)}`,
      accent: MCP_STATUS[m.status].color
    }),
    makeNew: () => ({
      id: newId(),
      name: tr('manage.mcp.newName'),
      enabled: true,
      kind: 'local',
      command: '',
      environment: '',
      url: '',
      headers: '',
      oauth: false,
      description: '',
      status: 'pending'
    }),
    parseImport: (raw) => parseMcpImport(raw).map((p) => ({ id: newId(), ...p })),
    showEnable: true,
    renderEditor: (item) => <McpEditor item={item} />,
    toolbarExtra: (
      <>
        <button
          onClick={() => setMcpJson(true)}
          title={tr('manage.groupModal.editMcpJson')}
          className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'var(--color-bg-spotlight)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)'
          }}
        >
          <Code2 size={14} />
        </button>
        <button
          onClick={() => void refreshAllMcp()}
          disabled={refreshing}
          title={tr('manage.groupModal.checkAllMcp')}
          className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'var(--color-bg-spotlight)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            cursor: refreshing ? 'default' : 'pointer'
          }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </>
    )
  }

  const skillConfig: TabConfig<SkillItem> = {
    store: skillStore,
    typeName: tr('manage.groupModal.typeSkill'),
    importPlaceholder: tr('manage.groupModal.skillImportPlaceholder'),
    rowMeta: (sk) => ({
      sub: `${sk.category || tr('manage.skills.defaultCategory')} · ${tr('manage.skills.fileCount', { count: sk.files.length })}`,
      accent: 'var(--color-success)'
    }),
    makeNew: () => newSkill('manual'),
    parseImport: (raw) => parseSkillImport(raw),
    createControl: (onCreate) => <AddSkillMenu onCreate={onCreate} />,
    renderEditor: (item) => <SkillEditor item={item} />
  }

  const ruleConfig: TabConfig<RuleItem> = {
    store: ruleStore,
    typeName: tr('manage.groupModal.typeRule'),
    importPlaceholder: tr('manage.groupModal.ruleImportPlaceholder'),
    rowMeta: (r) => ({
      sub: `${tr(RULE_KIND_KEY[r.kind])}${r.description ? ` · ${r.description}` : ''}`,
      accent: 'var(--color-warning)'
    }),
    makeNew: () => ({
      id: newId(),
      name: tr('manage.rules.newName'),
      enabled: true,
      kind: 'instruction',
      description: '',
      content: '',
      permissions: {}
    }),
    parseImport: (raw) =>
      toRecords(raw).map((r) => {
        const permissions: Record<string, PermissionAction> = {}
        if (r.permissions && typeof r.permissions === 'object') {
          for (const [k, v] of Object.entries(r.permissions as Record<string, unknown>)) {
            if (v === 'ask' || v === 'allow' || v === 'deny') permissions[k] = v
          }
        }
        return {
          id: newId(),
          name: s(r.name, tr('manage.data.importRule')),
          enabled: r.enabled !== false,
          kind: r.kind === 'permission' ? 'permission' : 'instruction',
          description: s(r.description),
          content: s(r.content),
          permissions
        }
      }),
    renderEditor: (item) => <RuleEditor item={item} />
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const next: Record<string, unknown> = {
      ...(conv.settings ?? {}),
      mcp: mcpSel,
      skills: skillSel,
      rules: ruleSel
    }
    try {
      await useAppStore.getState().updateConversation(conv.id, { settings: next })
      onSaved({ mcp: mcpSel, skills: skillSel, rules: ruleSel })
      onClose()
    } catch {
      setError(tr('manage.groupModal.saveError'))
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} zIndex={200}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('manage.groupModal.title')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col rounded-2xl overflow-hidden outline-none"
        style={{
          width: 'min(880px, 94vw)',
          height: 'min(660px, 88vh)',
          background: 'var(--color-bg-container)',
          boxShadow: 'var(--shadow-float)',
          border: '1px solid var(--color-border)'
        }}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0 gap-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="min-w-0">
            <div
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {tr('manage.groupModal.title')}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('manage.groupModal.subtitle', { name: conv.title || conv.projectName })}
            </div>
          </div>
          <div
            className="flex items-center gap-1 p-1 rounded-xl shrink-0"
            style={{ background: 'var(--color-bg-spotlight)' }}
          >
            {TABS.map(({ key, labelKey, icon: Icon }) => {
              const on = tab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
                  style={{
                    background: on ? 'var(--color-bg-elevated)' : 'transparent',
                    color: on ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                    boxShadow: on ? 'var(--shadow-sm)' : 'none',
                    fontWeight: on ? 600 : 500,
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <Icon size={14} />
                  {labelKey === 'MCP' ? 'MCP' : tr(labelKey)}
                </button>
              )
            })}
          </div>
          <button
            onClick={onClose}
            className="btn-ghost flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        {tab === 'mcp' &&
          (mcpJson ? (
            <McpRepoJson onBack={() => setMcpJson(false)} />
          ) : (
            <ResourceTab
              items={mcpServers}
              selection={mcpSel}
              setSelection={setMcpSel}
              config={mcpConfig}
            />
          ))}
        {tab === 'skills' && (
          <ResourceTab
            items={skills}
            selection={skillSel}
            setSelection={setSkillSel}
            config={skillConfig}
          />
        )}
        {tab === 'rules' && (
          <ResourceTab
            items={rules}
            selection={ruleSel}
            setSelection={setRuleSel}
            config={ruleConfig}
          />
        )}

        {/* 底部 */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs"
            style={{ color: error ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}
          >
            {error ??
              tr('manage.groupModal.footerSummary', {
                mcp: selectionCount(mcpSel, mcpServers.length),
                skills: selectionCount(skillSel, skills.length),
                rules: selectionCount(ruleSel, rules.length)
              })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 h-9 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--color-bg-spotlight)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer'
              }}
            >
              {tr('common.cancel')}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-brand flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium"
              style={{ opacity: saving ? 0.6 : 1 }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {tr('common.save')}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
