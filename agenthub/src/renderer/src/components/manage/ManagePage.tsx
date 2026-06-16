import { useState } from 'react'
import { Server, Sparkles, ScrollText } from 'lucide-react'
import { McpManager } from './McpManager'
import { SkillsManager } from './SkillsManager'
import { RulesManager } from './RulesManager'
import { useT } from '../../i18n'

type ManageTab = 'mcp' | 'skills' | 'rules'

const TABS: { key: ManageTab; labelKey: string; icon: typeof Server }[] = [
  { key: 'mcp', labelKey: 'MCP', icon: Server },
  { key: 'skills', labelKey: 'manage.page.tabSkills', icon: Sparkles },
  { key: 'rules', labelKey: 'manage.page.tabRules', icon: ScrollText }
]

export function ManagePage(): React.JSX.Element {
  const tr = useT()
  const [tab, setTab] = useState<ManageTab>('mcp')

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      {/* 页头：标题 + 分段标签 */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{
          background: 'var(--color-bg-elevated, #fff)',
          borderBottom: '1px solid var(--color-border-light)'
        }}
      >
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {tr('manage.page.title')}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {tr('manage.page.subtitle')}
          </p>
        </div>
        <div
          className="flex items-center gap-1 p-1 rounded-xl"
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
                  background: on ? 'var(--color-bg-elevated, #fff)' : 'transparent',
                  color: on ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                  boxShadow: on ? 'var(--shadow-sm, 0 1px 3px rgba(15,23,42,0.08))' : 'none',
                  fontWeight: on ? 600 : 500,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <Icon size={15} />
                {labelKey === 'MCP' ? 'MCP' : tr(labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {/* 当前标签内容 */}
      {tab === 'mcp' && <McpManager />}
      {tab === 'skills' && <SkillsManager />}
      {tab === 'rules' && <RulesManager />}
    </div>
  )
}
