import { useState } from 'react'
import { Check, Search, ArrowRight, Settings2, type LucideIcon } from 'lucide-react'
import type { Selection } from './mgmtData'
import { isSelected, selectionCount, toggleSelection } from './mgmtData'
import { useT } from '../../i18n'

export interface ResourceRow {
  id: string
  name: string
  sub?: string
  /** 状态点颜色（角色色 / 连接态等） */
  accent?: string
}

interface ResourcePickerProps {
  title: string
  icon: LucideIcon
  items: ResourceRow[]
  selection: Selection | undefined
  onChange: (sel: Selection) => void
  emptyHint: string
  /** 跳转管理中心 */
  onManage: () => void
  /** 打开悬浮管理面板（该类型 tab） */
  onExpand?: () => void
}

/** IDE 风格可勾选资源列表：默认全选，可逐项开关 / 全选 / 清空；展示「已启用 N/总数」。 */
export function ResourcePicker({
  title,
  icon: Icon,
  items,
  selection,
  onChange,
  emptyHint,
  onManage,
  onExpand
}: ResourcePickerProps): React.JSX.Element {
  const tr = useT()
  const [query, setQuery] = useState('')
  const total = items.length
  const enabled = selectionCount(selection, total)
  const allIds = items.map((i) => i.id)
  const isAll = selection === undefined || selection === 'all'

  const q = query.trim().toLowerCase()
  const visible = q
    ? items.filter((i) => [i.name, i.sub ?? ''].some((f) => f.toLowerCase().includes(q)))
    : items

  return (
    <div>
      {/* 头部：标题 + 计数 + 全选/清空 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={13} className="shrink-0" />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {title}
          </span>
          {total > 0 && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full"
              style={{
                color: isAll ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                background: isAll ? 'var(--color-brand-bg)' : 'var(--color-bg-spotlight)'
              }}
            >
              {isAll ? tr('manage.picker.all', { total }) : `${enabled}/${total}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <>
              <button
                onClick={() => onChange('all')}
                className="text-[11px] cursor-pointer bg-transparent border-none"
                style={{
                  color: enabled === total ? 'var(--color-text-tertiary)' : 'var(--color-brand)'
                }}
              >
                {tr('manage.picker.selectAll')}
              </button>
              <span style={{ color: 'var(--color-border)' }}>·</span>
              <button
                onClick={() => onChange([])}
                className="text-[11px] cursor-pointer bg-transparent border-none"
                style={{
                  color: enabled === 0 ? 'var(--color-text-tertiary)' : 'var(--color-brand)'
                }}
              >
                {tr('manage.picker.clear')}
              </button>
            </>
          )}
          {onExpand && (
            <button
              onClick={onExpand}
              title={tr('manage.picker.manageTitle')}
              className="flex items-center gap-1 text-[11px] cursor-pointer bg-transparent border-none"
              style={{ color: 'var(--color-brand)' }}
            >
              <Settings2 size={12} />
              {tr('manage.picker.manage')}
            </button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <button
          onClick={onManage}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-xs cursor-pointer"
          style={{
            border: '1px dashed var(--color-border)',
            background: 'var(--color-bg-spotlight)',
            color: 'var(--color-text-tertiary)'
          }}
        >
          {emptyHint}
          <ArrowRight size={12} />
        </button>
      ) : (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border-light)' }}
        >
          {total > 5 && (
            <div
              className="relative"
              style={{ borderBottom: '1px solid var(--color-border-light)' }}
            >
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('manage.picker.searchPrefix', { title })}
                className="w-full pl-8 pr-2.5 py-2 text-xs outline-none bg-transparent"
                style={{ color: 'var(--color-text-primary)', border: 'none' }}
              />
            </div>
          )}
          <div className="max-h-[210px] overflow-y-auto">
            {visible.length === 0 ? (
              <div
                className="px-3 py-3 text-center text-[11px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {tr('manage.picker.noMatch')}
              </div>
            ) : (
              visible.map((it) => {
                const on = isSelected(selection, it.id)
                return (
                  <button
                    key={it.id}
                    onClick={() => onChange(toggleSelection(selection, it.id, allIds))}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer border-none transition-colors"
                    style={{ background: on ? 'var(--color-brand-bg)' : 'transparent' }}
                  >
                    <span
                      className="shrink-0 rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        background: on
                          ? (it.accent ?? 'var(--color-success)')
                          : 'var(--color-text-tertiary)'
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-xs font-medium truncate"
                        style={{
                          color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
                        }}
                      >
                        {it.name}
                      </span>
                      {it.sub ? (
                        <span
                          className="block text-[11px] truncate"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          {it.sub}
                        </span>
                      ) : null}
                    </span>
                    {/* 勾选方块 */}
                    <span
                      className="shrink-0 flex items-center justify-center rounded"
                      style={{
                        width: 16,
                        height: 16,
                        background: on ? 'var(--color-brand)' : 'transparent',
                        border: `1.5px solid ${on ? 'var(--color-brand)' : 'var(--color-border)'}`
                      }}
                    >
                      {on && <Check size={11} strokeWidth={3} color="#fff" />}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
