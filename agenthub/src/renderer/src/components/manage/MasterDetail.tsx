import * as React from 'react'
import { Search, Plus, Trash2 } from 'lucide-react'
import { useT } from '../../i18n'

interface MasterDetailProps {
  /** 搜索框占位 */
  searchPlaceholder: string
  search: string
  onSearch: (v: string) => void
  createLabel: string
  onCreate: () => void
  /** 自定义新建控件（提供时替换默认「+」按钮，如技能的来源选择菜单） */
  createControl?: React.ReactNode
  /** 左侧列表内容（条目卡片） */
  list: React.ReactNode
  /** 右侧详情/编辑器内容 */
  detail: React.ReactNode
  /** 左列宽度 */
  listWidth?: number
  /** 工具条下方摘要（如「已启用 N/M」） */
  summary?: string
}

/** IDE 风格三段式：左侧（搜索 + 新建 + 列表）｜右侧（详情编辑器）。 */
export function MasterDetail({
  searchPlaceholder,
  search,
  onSearch,
  createLabel,
  onCreate,
  createControl,
  list,
  detail,
  listWidth = 300,
  summary
}: MasterDetailProps): React.JSX.Element {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左列：工具条 + 列表 */}
      <div
        className="flex flex-col shrink-0"
        style={{
          width: listWidth,
          background: 'var(--color-bg-container)',
          borderRight: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 px-3 py-3 shrink-0">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg outline-none border transition-all duration-150"
              style={{
                background: 'var(--color-bg-spotlight)',
                borderColor: 'var(--color-border-light)',
                color: 'var(--color-text-primary)'
              }}
            />
          </div>
          {createControl ?? (
            <button
              onClick={onCreate}
              title={createLabel}
              className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white"
              style={{
                background: 'var(--gradient-brand)',
                boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
              }}
            >
              <Plus size={15} />
            </button>
          )}
        </div>
        {summary ? (
          <div
            className="px-3.5 pb-2 text-[11px] shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {summary}
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-2 pb-3">{list}</div>
      </div>

      {/* 右列：详情编辑器 */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-bg-layout)' }}>
        {detail}
      </div>
    </div>
  )
}

interface ListItemProps {
  active: boolean
  enabled: boolean
  title: string
  subtitle?: string
  /** 失败/错误信息（额外一行，错误色） */
  error?: string
  /** 状态点颜色（如角色色 / 连接态） */
  accent?: string
  onClick: () => void
  /** 行内启用开关（对齐 MiMo-Code：直接在列表里启停） */
  onToggle?: (v: boolean) => void
}

/** 列表条目卡片：状态点 + 标题/副标题 + 行内启用开关，选中高亮。 */
export function ListItem({
  active,
  enabled,
  title,
  subtitle,
  error,
  accent,
  onClick,
  onToggle
}: ListItemProps): React.JSX.Element {
  return (
    <div
      className={`group/item flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors mb-0.5${
        active ? '' : ' hover:bg-[var(--color-bg-spotlight)]'
      }`}
      style={{ background: active ? 'var(--color-brand-bg)' : undefined }}
    >
      <button
        onClick={onClick}
        className="min-w-0 flex-1 text-left flex items-start gap-2.5 bg-transparent border-none cursor-pointer p-0"
      >
        <span
          className="shrink-0 rounded-full mt-1.5"
          style={{
            width: 7,
            height: 7,
            background: enabled ? (accent ?? 'var(--color-success)') : 'var(--color-text-tertiary)',
            boxShadow: enabled ? `0 0 0 3px ${accent ?? 'var(--color-success)'}22` : 'none'
          }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block text-sm font-medium truncate"
            style={{
              color: active ? 'var(--color-brand)' : 'var(--color-text-primary)',
              opacity: enabled ? 1 : 0.6
            }}
          >
            {title}
          </span>
          {subtitle ? (
            <span
              className="block text-xs truncate mt-0.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {subtitle}
            </span>
          ) : null}
          {error ? (
            <span
              className="block text-[11px] truncate mt-0.5"
              style={{ color: 'var(--color-error)' }}
            >
              {error}
            </span>
          ) : null}
        </span>
      </button>
      {onToggle ? (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      ) : null}
    </div>
  )
}

interface EmptyDetailProps {
  message: string
}

export function EmptyDetail({ message }: EmptyDetailProps): React.JSX.Element {
  return (
    <div
      className="h-full flex items-center justify-center text-sm px-8 text-center"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      {message}
    </div>
  )
}

/** 详情编辑器通用字段：标签 + 内容。 */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block mb-4">
      <span
        className="block text-xs font-medium mb-1.5"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {label}
        {hint ? (
          <span className="ml-1.5 font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  )
}

/** 轻量开关（无第三方依赖） */
export function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors"
      style={{
        width: 36,
        height: 20,
        background: checked ? 'var(--color-brand)' : 'var(--color-border)',
        cursor: 'pointer',
        border: 'none'
      }}
    >
      <span
        className="absolute rounded-full bg-white"
        style={{
          width: 16,
          height: 16,
          top: 2,
          left: checked ? 18 : 2,
          transition: 'left var(--transition-fast)',
          boxShadow: '0 1px 3px rgba(15,23,42,0.3)'
        }}
      />
    </button>
  )
}

/** 详情头部：标题输入 + 启用开关 + 删除。 */
export function DetailHeader({
  title,
  onTitleChange,
  enabled,
  onToggle,
  onDelete,
  extra
}: {
  title: string
  onTitleChange: (v: string) => void
  /** 库级启用开关（仅 MCP 用；技能/规则严格对齐 mimocode 不带开关） */
  enabled?: boolean
  onToggle?: (v: boolean) => void
  onDelete: () => void
  extra?: React.ReactNode
}): React.JSX.Element {
  const tr = useT()
  return (
    <div className="flex items-center gap-3 mb-5">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={tr('manage.detail.namePlaceholder')}
        className="flex-1 text-base font-semibold outline-none bg-transparent"
        style={{ color: 'var(--color-text-primary)', border: 'none' }}
      />
      {extra}
      {enabled !== undefined && onToggle ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {enabled ? tr('manage.detail.enabled') : tr('manage.detail.disabled')}
          </span>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      ) : null}
      <button
        onClick={onDelete}
        title={tr('manage.detail.delete')}
        className="btn-ghost shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ color: 'var(--color-error)' }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
