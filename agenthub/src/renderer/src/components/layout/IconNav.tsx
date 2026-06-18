import { MessageSquare, Settings, Bot, User, SlidersHorizontal } from 'lucide-react'
import { useAppStore, type PageType } from '../../store'
import { Tooltip } from '../ui/Tooltip'
import { BrandMark } from '../ui/BrandMark'
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
        background: 'var(--nav-bg)',
        borderRight: '1px solid var(--nav-border)'
      }}
    >
      {/* Logo：品牌渐变 + 微光晕 */}
      <div
        className="flex items-center justify-center rounded-xl mb-3 w-9 h-9"
        style={{
          background: 'var(--gradient-brand)',
          boxShadow: 'var(--shadow-brand-lg)'
        }}
      >
        <BrandMark size={24} color="#fff" />
      </div>

      {/* 导航项 + spring 滑动指示条 */}
      <div className="relative flex flex-col" style={{ gap: ITEM_GAP }}>
        {activeIndex >= 0 && (
          <span
            className="absolute left-0 rounded-r-full"
            style={{
              width: 3,
              height: 18,
              background: 'var(--nav-indicator)',
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
                aria-label={t(labelKey)}
                className="nav-item flex items-center justify-center rounded-xl transition-colors"
                style={{
                  width: ITEM_H,
                  height: ITEM_H,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'var(--nav-item-bg-active)' : undefined,
                  color: active ? 'var(--nav-item-color-active)' : 'var(--nav-item-color)'
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
            background: 'var(--nav-avatar-bg)',
            border: '1px solid var(--nav-avatar-border)'
          }}
        >
          <User size={14} color="var(--nav-avatar-color)" />
        </div>
      </div>
    </nav>
  )
}
