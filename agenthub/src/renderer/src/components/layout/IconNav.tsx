import { MessageSquare, Settings, Bot, User, SlidersHorizontal } from 'lucide-react'
import { useAppStore, type PageType } from '../../store'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'

const NAV_ITEMS: { icon: typeof Bot; labelKey: string; page: PageType }[] = [
  { icon: MessageSquare, labelKey: 'nav.chat', page: 'chat' },
  { icon: Bot, labelKey: 'nav.agents', page: 'agents' },
  { icon: SlidersHorizontal, labelKey: 'nav.manage', page: 'manage' },
  { icon: Settings, labelKey: 'nav.settings', page: 'settings' }
]

const ITEM_H = 38
const ITEM_GAP = 4

export function IconNav(): React.JSX.Element {
  const t = useT()
  const activePage = useAppStore((s) => s.activePage)
  const activeIndex = NAV_ITEMS.findIndex((n) => n.page === activePage)

  return (
    <nav
      className="flex flex-col items-center py-3 gap-1 shrink-0 h-full"
      style={{
        width: 'var(--nav-width)',
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)'
      }}
    >
      {/* Logo：品牌渐变 + 微光晕 */}
      <div
        className="flex items-center justify-center rounded-xl mb-3 w-9 h-9"
        style={{
          background: 'var(--gradient-brand)',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.45)'
        }}
      >
        <Bot size={18} color="#fff" strokeWidth={2} />
      </div>

      {/* 导航项 + spring 滑动指示条 */}
      <div className="relative flex flex-col" style={{ gap: ITEM_GAP }}>
        {activeIndex >= 0 && (
          <span
            className="absolute left-0 rounded-r-full"
            style={{
              width: 3,
              height: 18,
              background: '#60a5fa',
              top: activeIndex * (ITEM_H + ITEM_GAP) + (ITEM_H - 18) / 2,
              transition: 'top var(--duration-base) var(--ease-spring)'
            }}
          />
        )}
        {NAV_ITEMS.map(({ icon: Icon, labelKey, page }) => {
          const active = activePage === page
          return (
            <Tooltip key={page} content={t(labelKey)} placement="right">
              <button
                onClick={() => useAppStore.getState().setActivePage(page)}
                className={`nav-item flex items-center justify-center rounded-xl transition-colors ${
                  active ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                }`}
                style={{
                  width: ITEM_H,
                  height: ITEM_H,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  color: active ? '#ffffff' : 'rgba(255, 255, 255, 0.55)'
                }}
              >
                <Icon className="nav-item-icon" size={20} strokeWidth={active ? 2.2 : 1.8} />
              </button>
            </Tooltip>
          )
        })}
      </div>

      <div className="mt-auto">
        <div
          className="flex items-center justify-center rounded-full w-8 h-8"
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.12)'
          }}
        >
          <User size={14} color="rgba(255, 255, 255, 0.75)" />
        </div>
      </div>
    </nav>
  )
}
