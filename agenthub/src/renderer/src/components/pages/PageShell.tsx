import { useContext, useState } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { ConversationHeader } from '../layout/ConversationHeader'
import { PageShellEmbeddedContext } from './page-shell-context'

/** 顶级页面外壳：会话头 + 可选主区子页签 + 内容区。无选中会话时给出空态。
 *  在右侧工作区（embedded）下隐藏会话头，仅保留操作条 + 子页签。 */
export function PageShell({
  tabs,
  tabContent,
  actions,
  children
}: {
  tabs?: string[]
  /** 与 tabs 一一对应的内容；提供时按 activeTab 渲染，否则渲染 children */
  tabContent?: React.ReactNode[]
  actions?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const tr = useT()
  const embedded = useContext(PageShellEmbeddedContext)
  const activeId = useAppStore((s) => s.activeConversationId)
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--color-bg-layout)' }}>
      {embedded ? (
        actions && (
          <div
            className="flex items-center justify-end gap-2 px-4 shrink-0"
            style={{
              minHeight: 44,
              background: 'var(--color-bg-container)',
              borderBottom: '1px solid var(--color-border-light)'
            }}
          >
            {actions}
          </div>
        )
      ) : (
        <ConversationHeader actions={actions} />
      )}

      {tabs && tabs.length > 0 && (
        <div
          className="flex items-center gap-1 px-5 shrink-0"
          style={{
            background: 'var(--color-bg-container)',
            borderBottom: '1px solid var(--color-border-light)'
          }}
        >
          {tabs.map((label, i) => {
            const active = i === activeTab
            return (
              <button
                key={label}
                onClick={() => setActiveTab(i)}
                className="relative px-3 py-2.5 text-sm font-medium transition-colors"
                style={{ color: active ? 'var(--color-brand)' : 'var(--color-text-tertiary)' }}
              >
                {label}
                {active && (
                  <span
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                    style={{ background: 'var(--color-brand)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}

      {activeId ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tabContent ? tabContent[activeTab] : children}
        </div>
      ) : (
        <div
          className="flex-1 flex items-center justify-center text-sm"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {tr('chat.empty.subtitle')}
        </div>
      )}
    </div>
  )
}
