import { useEffect, useState } from 'react'
import { Bot, Sun, Moon } from 'lucide-react'
import { useAppStore } from '../../store'
import { setThemePreference } from '../../services/theme'

function isDarkNow(): boolean {
  return document.documentElement.dataset.theme === 'dark'
}

/** frameless 一体化标题栏：40px 拖拽区，左 Logo+产品名，中当前会话，右主题切换。
 *  Win 窗口控制键由系统 titleBarOverlay 绘制（右侧预留），mac 左侧预留 traffic lights。 */
export function TitleBar(): React.JSX.Element | null {
  const activePage = useAppStore((s) => s.activePage)
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const [dark, setDark] = useState(isDarkNow)

  // 跟随 data-theme 变化（含系统主题联动、设置页切换）
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkNow()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  const platform = window.electron?.process?.platform ?? 'win32'
  if (platform === 'linux') return null // Linux 保持系统标题栏

  const isMac = platform === 'darwin'
  const convTitle =
    activePage === 'chat' ? conversations.find((c) => c.id === activeId)?.title : undefined

  const toggleTheme = (): void => {
    setThemePreference(dark ? 'light' : 'dark')
  }

  return (
    <div
      className="titlebar flex items-center shrink-0 select-none"
      style={{
        height: 40,
        background: 'var(--color-bg-container)',
        borderBottom: '1px solid var(--color-border-light)',
        paddingLeft: isMac ? 76 : 12,
        paddingRight: isMac ? 12 : 146
      }}
    >
      {/* Logo + 产品名 */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="flex items-center justify-center w-6 h-6 rounded-md"
          style={{
            background: 'var(--gradient-brand)',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.35)'
          }}
        >
          <Bot size={13} color="#fff" strokeWidth={2.2} />
        </span>
        <span
          className="text-xs font-semibold tracking-wide"
          style={{ color: 'var(--color-text-primary)' }}
        >
          AgentHub
        </span>
      </div>

      {/* 中部：当前会话名 */}
      <div className="flex-1 flex justify-center min-w-0 px-4">
        {convTitle && (
          <span
            className="text-xs truncate max-w-[40%]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {convTitle}
          </span>
        )}
      </div>

      {/* 右侧：主题切换（no-drag 可点击） */}
      <div className="titlebar-no-drag flex items-center gap-1 shrink-0">
        <button
          onClick={toggleTheme}
          title={dark ? '切换为亮色' : '切换为暗色'}
          className="btn-press flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent cursor-pointer hover-spotlight"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <span
            key={dark ? 'moon' : 'sun'}
            className="flex"
            style={{ animation: 'springPop var(--duration-base) var(--ease-spring)' }}
          >
            {dark ? <Moon size={15} /> : <Sun size={15} />}
          </span>
        </button>
      </div>
    </div>
  )
}
