import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { RIGHT_DOCK_TABS } from './right-dock-tabs'

/** 会话右侧常驻图标轨（dock 收起态入口）：把 概览/任务/Diff/预览/部署/计划/Git 作为常显按钮，
 *  点击打开对应右侧工作区面板；dock 展开后由其自带 tab 条接管，本轨隐藏（见 App.tsx）。 */
export function RightRail(): React.JSX.Element {
  const tr = useT()
  const pendingCount = useAppStore((s) => s.pendingApprovals.length)
  const setRightTab = useAppStore((s) => s.setRightTab)

  return (
    <nav
      className="flex flex-col items-center gap-1.5 pt-3 pb-3 px-2 shrink-0 h-full overflow-y-auto"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      {RIGHT_DOCK_TABS.map(({ key, icon: Icon, labelKey }) => {
        const label = tr(labelKey)
        const badge = key === 'review' ? pendingCount : 0
        return (
          <button
            key={key}
            onClick={() => setRightTab(key)}
            aria-label={label}
            title={label}
            className="nav-item relative flex flex-col items-center justify-center gap-1 rounded-xl py-2 w-full transition-colors hover-spotlight"
            style={{ border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="text-[11px] leading-none">{label}</span>
            {badge > 0 && (
              <span
                className="absolute top-1 right-2 flex items-center justify-center text-[10px] font-semibold tabular-nums rounded-full px-1"
                style={{
                  minWidth: 16,
                  height: 16,
                  color: '#fff',
                  background: 'var(--color-error)'
                }}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
