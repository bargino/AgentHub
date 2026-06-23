import { MessageSquare, Settings, Bot, Server, User } from 'lucide-react'
import { useAppStore, type PageType } from '../../store'
import { useT } from '../../i18n'

type NavItem = { icon: typeof MessageSquare; labelKey: string; page: PageType }

/** 工作区组：仅「会话」入口；任务/Diff/预览/部署已迁至会话右侧工作区 dock。 */
const WORKSPACE_ITEMS: NavItem[] = [{ icon: MessageSquare, labelKey: 'nav.chat', page: 'chat' }]

/** 全局组：跨会话的配置与资源（Agent 目录 / 管理中心 / 设置）。 */
const GLOBAL_ITEMS: NavItem[] = [
  { icon: Bot, labelKey: 'nav.agents', page: 'agents' },
  { icon: Server, labelKey: 'nav.manage', page: 'manage' },
  { icon: Settings, labelKey: 'nav.settings', page: 'settings' }
]

export function IconNav(): React.JSX.Element {
  const t = useT()
  const activePage = useAppStore((s) => s.activePage)

  const renderItem = ({ icon: Icon, labelKey, page }: NavItem): React.JSX.Element => {
    const active = activePage === page
    return (
      <button
        key={page}
        onClick={() => useAppStore.getState().setActivePage(page)}
        aria-label={t(labelKey)}
        aria-current={active ? 'page' : undefined}
        className="nav-item flex flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors"
        style={{
          border: 'none',
          cursor: 'pointer',
          background: active ? 'var(--nav-item-bg-active)' : 'transparent',
          color: active ? 'var(--nav-item-color-active)' : 'var(--nav-item-color)'
        }}
      >
        <Icon className="nav-item-icon" size={20} strokeWidth={active ? 2.2 : 1.8} />
        <span className="text-[11px] leading-none" style={{ fontWeight: active ? 600 : 500 }}>
          {t(labelKey)}
        </span>
      </button>
    )
  }

  return (
    <nav
      className="flex flex-col items-center pt-3 pb-3 gap-1 shrink-0 h-full"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--nav-bg)',
        borderRight: '1px solid var(--nav-border)'
      }}
    >
      {/* 工作区组 */}
      <div className="flex flex-col gap-1.5 w-full px-2">{WORKSPACE_ITEMS.map(renderItem)}</div>

      {/* 分组分隔线 */}
      <div
        className="my-2 mx-auto"
        style={{ width: 36, height: 1, background: 'var(--nav-border)' }}
      />

      {/* 全局组 */}
      <div className="flex flex-col gap-1.5 w-full px-2">{GLOBAL_ITEMS.map(renderItem)}</div>

      <div className="mt-auto">
        <div className="relative w-9 h-9">
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"
            style={{
              background: 'var(--nav-avatar-bg)',
              border: '1px solid var(--nav-avatar-border)'
            }}
          >
            <User size={16} color="var(--nav-avatar-color)" />
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
            style={{
              background: 'var(--color-success)',
              border: '2px solid var(--nav-bg)'
            }}
          />
        </div>
      </div>
    </nav>
  )
}
