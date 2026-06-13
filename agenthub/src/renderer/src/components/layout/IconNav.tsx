import { MessageSquare, Settings, Bot, User } from 'lucide-react'
import { useAppStore, type PageType } from '../../store'
import { Tooltip } from '../ui/Tooltip'

const NAV_ITEMS: { icon: typeof Bot; label: string; page: PageType }[] = [
  { icon: MessageSquare, label: '会话', page: 'chat' },
  { icon: Bot, label: 'Agent', page: 'agents' },
  { icon: Settings, label: '设置', page: 'settings' }
]

const ITEM_H = 38
const ITEM_GAP = 4

export function IconNav(): React.JSX.Element {
  const activePage = useAppStore((s) => s.activePage)
  const activeIndex = NAV_ITEMS.findIndex((n) => n.page === activePage)

  return (
    <nav
      className="flex flex-col items-center py-3 gap-1 shrink-0 h-full"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--color-bg-container)',
        borderRight: '1px solid var(--color-border)'
      }}
    >
      {/* Logo：品牌渐变 + 微光晕 */}
      <div
        className="flex items-center justify-center rounded-lg mb-3 w-9 h-9"
        style={{
          background: 'var(--gradient-brand)',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)'
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
              background: 'var(--color-brand)',
              top: activeIndex * (ITEM_H + ITEM_GAP) + (ITEM_H - 18) / 2,
              transition: 'top var(--duration-base) var(--ease-spring)'
            }}
          />
        )}
        {NAV_ITEMS.map(({ icon: Icon, label, page }) => {
          const active = activePage === page
          return (
            <Tooltip key={page} content={label} placement="right">
              <button
                onClick={() => useAppStore.getState().setActivePage(page)}
                className={`nav-item flex items-center justify-center rounded-lg ${
                  active ? 'bg-[var(--color-brand-bg)]' : 'hover-spotlight'
                }`}
                style={{
                  width: ITEM_H,
                  height: ITEM_H,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? undefined : 'transparent',
                  color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)'
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
            background: 'var(--color-bg-spotlight)',
            border: '1px solid var(--color-border-light)'
          }}
        >
          <User size={14} color="var(--color-text-secondary)" />
        </div>
      </div>
    </nav>
  )
}
