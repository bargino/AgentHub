import { useState } from 'react'
import { Cpu, Bell, Palette, RefreshCw, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store'
import { wsClient } from '../../services/websocket'
import { ensureDesktopPermission } from '../../services/notify'
import { StatusDot } from '../ui/StatusDot'
import { useT, useLang, setLang, LANGS, type Lang } from '../../i18n'
import {
  getFontSizePreference,
  getThemePreference,
  setFontSizePreference,
  setThemePreference,
  type FontSizePreference,
  type ThemePreference
} from '../../services/theme'

const SECTIONS = [
  { key: 'engine', icon: Cpu, labelKey: 'settings.sections.engine' },
  { key: 'notify', icon: Bell, labelKey: 'settings.sections.notify' },
  { key: 'theme', icon: Palette, labelKey: 'settings.sections.theme' }
]

const NOTIFY_ITEMS = [
  {
    key: 'taskDone',
    labelKey: 'settings.notify.taskDone',
    descKey: 'settings.notify.taskDoneDesc'
  },
  {
    key: 'approval',
    labelKey: 'settings.notify.approval',
    descKey: 'settings.notify.approvalDesc'
  },
  { key: 'error', labelKey: 'settings.notify.error', descKey: 'settings.notify.errorDesc' }
]

const NOTIFY_STORAGE_KEY = 'agenthub.notify'

function loadNotifyStates(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NOTIFY_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, boolean>
  } catch {
    /* ignore */
  }
  return { taskDone: true, approval: true, error: true }
}

export function SettingsPage(): React.JSX.Element {
  const t = useT()
  const [activeSection, setActiveSection] = useState('engine')
  const [notifyStates, setNotifyStates] = useState<Record<string, boolean>>(loadNotifyStates)

  const toggleNotify = (key: string): void => {
    setNotifyStates((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(next))
      // 开启任一通知时顺带申请桌面通知权限，否则失焦提醒无法送达
      if (next[key]) ensureDesktopPermission()
      return next
    })
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        className="flex flex-col shrink-0"
        style={{
          width: 208,
          background: 'var(--color-bg-container)',
          borderRight: '1px solid var(--color-border)'
        }}
      >
        <div
          className="px-4 pt-5 pb-3"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <h1
            className="text-base font-semibold m-0"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {t('settings.title')}
          </h1>
        </div>
        <div className="flex-1 py-2">
          {SECTIONS.map(({ key, icon: Icon, labelKey }) => {
            const active = activeSection === key
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 border-none cursor-pointer text-left text-sm transition-all ${
                  active ? 'bg-[var(--color-brand-bg)] font-medium' : 'hover-spotlight font-normal'
                }`}
                style={{
                  color: active ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                  borderRight: active ? '3px solid var(--color-brand)' : '3px solid transparent'
                }}
              >
                <Icon size={16} />
                <span>{t(labelKey)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--color-bg-layout)' }}>
        {activeSection === 'engine' && <EngineSection />}
        {activeSection === 'notify' && (
          <NotifySection states={notifyStates} onToggle={toggleNotify} />
        )}
        {activeSection === 'theme' && <ThemeSection />}
      </div>
    </div>
  )
}

/**
 * 引擎状态与重启：原「后端地址」设置在 stdio 桥模式下并不生效（后端为主进程
 * 拉起的子进程，无可配地址），故改为展示实际连接状态 + 重启入口。
 */
function EngineSection(): React.JSX.Element {
  const t = useT()
  const wsStatus = useAppStore((s) => s.wsStatus)
  const bridgeError = useAppStore((s) => s.bridgeError)
  const [restarting, setRestarting] = useState(false)

  const statusMeta =
    wsStatus === 'connected'
      ? { tone: 'online' as const, labelKey: 'common.status.running' }
      : wsStatus === 'connecting'
        ? { tone: 'idle' as const, labelKey: 'common.status.connecting' }
        : { tone: 'offline' as const, labelKey: 'common.status.disconnected' }

  const handleRestart = async (): Promise<void> => {
    setRestarting(true)
    try {
      await window.api.backend.restart()
      wsClient.connect()
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        {t('settings.engine.heading')}
      </h2>
      <div className="settings-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <StatusDot status={statusMeta.tone} />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {t('settings.engine.statusLine', { status: t(statusMeta.labelKey) })}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('settings.engine.hint')}
              </div>
            </div>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="btn-brand flex items-center gap-1.5 shrink-0"
            style={{ opacity: restarting ? 0.6 : 1 }}
          >
            {restarting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {t('settings.engine.restart')}
          </button>
        </div>
        {bridgeError && (
          <p
            className="text-xs mt-3 leading-relaxed"
            style={{ color: 'var(--color-error, #ff4d4f)' }}
          >
            {bridgeError}
          </p>
        )}
      </div>
    </div>
  )
}

function NotifySection({
  states,
  onToggle
}: {
  states: Record<string, boolean>
  onToggle: (key: string) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        {t('settings.notify.heading')}
      </h2>
      <div className="flex flex-col gap-3">
        {NOTIFY_ITEMS.map((item) => {
          const on = states[item.key] ?? false
          return (
            <div key={item.key} className="settings-card flex items-center justify-between">
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {t(item.labelKey)}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t(item.descKey)}
                </div>
              </div>
              <div
                className="toggle-switch"
                style={{ background: on ? 'var(--color-brand)' : 'var(--color-border)' }}
                onClick={() => onToggle(item.key)}
                role="switch"
                aria-checked={on}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle(item.key)
                  }
                }}
              >
                <div className="toggle-knob" style={{ left: on ? 20 : 2 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ThemeSection(): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  const [fontSize, setFontSize] = useState<FontSizePreference>(getFontSizePreference)

  const THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
    { value: 'light', labelKey: 'settings.theme.light' },
    { value: 'dark', labelKey: 'settings.theme.dark' },
    { value: 'system', labelKey: 'settings.theme.system' }
  ]
  const FONT_OPTIONS: { value: FontSizePreference; labelKey: string }[] = [
    { value: 'small', labelKey: 'settings.theme.fontSmall' },
    { value: 'default', labelKey: 'settings.theme.fontDefault' },
    { value: 'large', labelKey: 'settings.theme.fontLarge' }
  ]

  const handleTheme = (value: ThemePreference): void => {
    setTheme(value)
    setThemePreference(value)
  }

  const handleFontSize = (value: FontSizePreference): void => {
    setFontSize(value)
    setFontSizePreference(value)
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        {t('settings.theme.heading')}
      </h2>
      <div className="settings-card !p-0 overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            {t('settings.theme.theme')}
          </span>
          <select
            value={theme}
            onChange={(e) => handleTheme(e.target.value as ThemePreference)}
            className="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
            style={{
              color: 'var(--color-text-secondary)',
              borderColor: 'var(--color-border-light)',
              background: 'var(--color-bg-spotlight)'
            }}
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div
          className="flex items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            {t('settings.theme.language')}
          </span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
            style={{
              color: 'var(--color-text-secondary)',
              borderColor: 'var(--color-border-light)',
              background: 'var(--color-bg-spotlight)'
            }}
          >
            {LANGS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            {t('settings.theme.fontSize')}
          </span>
          <select
            value={fontSize}
            onChange={(e) => handleFontSize(e.target.value as FontSizePreference)}
            className="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
            style={{
              color: 'var(--color-text-secondary)',
              borderColor: 'var(--color-border-light)',
              background: 'var(--color-bg-spotlight)'
            }}
          >
            {FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
