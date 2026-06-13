import { useState } from 'react'
import { Server, Bell, Palette, ChevronRight, Check } from 'lucide-react'
import { wsClient } from '../../services/websocket'
import {
  getFontSizePreference,
  getThemePreference,
  setFontSizePreference,
  setThemePreference,
  type FontSizePreference,
  type ThemePreference
} from '../../services/theme'

const SECTIONS = [
  { key: 'server', icon: Server, label: '后端服务', desc: '配置 AgentHub Server 连接地址' },
  { key: 'notify', icon: Bell, label: '通知', desc: '任务完成、审批提醒等通知设置' },
  { key: 'theme', icon: Palette, label: '外观', desc: '主题颜色、字体大小、语言' }
]

const NOTIFY_ITEMS = [
  { key: 'taskDone', label: '任务完成通知', desc: '当 Agent 任务执行完成时通知' },
  { key: 'approval', label: '审批提醒', desc: '有待审批操作时弹出提醒' },
  { key: 'error', label: '错误告警', desc: 'Agent 执行出错时通知' }
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
  const [activeSection, setActiveSection] = useState('server')
  const [notifyStates, setNotifyStates] = useState<Record<string, boolean>>(loadNotifyStates)

  const toggleNotify = (key: string): void => {
    setNotifyStates((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(next))
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
            设置
          </h1>
        </div>
        <div className="flex-1 py-2">
          {SECTIONS.map(({ key, icon: Icon, label }) => {
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
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--color-bg-layout)' }}>
        {activeSection === 'server' && <ServerSection />}
        {activeSection === 'notify' && (
          <NotifySection states={notifyStates} onToggle={toggleNotify} />
        )}
        {activeSection === 'theme' && <ThemeSection />}
      </div>
    </div>
  )
}

function ServerSection(): React.JSX.Element {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem('agenthub.serverUrl') ?? 'http://localhost:8642'
  )
  const [saved, setSaved] = useState(false)

  const handleSave = (): void => {
    localStorage.setItem('agenthub.serverUrl', serverUrl.trim())
    wsClient.disconnect()
    wsClient.connect()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        后端服务配置
      </h2>
      <div className="settings-card">
        <label
          className="block text-xs font-medium mb-2"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          AgentHub Server 地址
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="styled-input"
          />
          <button onClick={handleSave} className="btn-brand">
            保存
          </button>
          {saved && (
            <span
              className="flex items-center gap-1 text-xs shrink-0"
              style={{ color: 'var(--color-success, #52c41a)' }}
            >
              <Check size={12} /> 已保存并重连
            </span>
          )}
        </div>
        <p className="text-xs mt-2.5" style={{ color: 'var(--color-text-tertiary)' }}>
          需先启动 AgentHub Server（默认 http://127.0.0.1:8642）
        </p>
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
  return (
    <div>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        通知设置
      </h2>
      <div className="flex flex-col gap-3">
        {NOTIFY_ITEMS.map((item) => {
          const on = states[item.key] ?? false
          return (
            <div key={item.key} className="settings-card flex items-center justify-between">
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {item.label}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {item.desc}
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
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  const [fontSize, setFontSize] = useState<FontSizePreference>(getFontSizePreference)

  const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'system', label: '跟随系统' }
  ]
  const FONT_OPTIONS: { value: FontSizePreference; label: string }[] = [
    { value: 'small', label: '小（12px）' },
    { value: 'default', label: '默认（14px）' },
    { value: 'large', label: '大（16px）' }
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
        外观设置
      </h2>
      <div className="settings-card !p-0 overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            主题
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
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div
          className="flex items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            语言
          </span>
          <div className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="text-xs">简体中文</span>
            <ChevronRight size={14} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
            字体大小
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
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
