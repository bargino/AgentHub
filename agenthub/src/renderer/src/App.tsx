import { useEffect, useState } from 'react'
import { useAppStore, type PageType } from './store'
import { wsClient } from './services/websocket'
import { TitleBar } from './components/layout/TitleBar'
import { IconNav } from './components/layout/IconNav'
import { ConversationList } from './components/conversation/ConversationList'
import { GroupSettingsPanel } from './components/conversation/GroupSettingsPanel'
import { ChatWindow } from './components/chat/ChatWindow'
import { RightDock } from './components/layout/RightDock'
import { RightRail } from './components/layout/RightRail'
import { AgentsPage } from './components/agents/AgentsPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { ManagePage } from './components/manage/ManagePage'
import { ResizeHandle } from './components/ui/ResizeHandle'
import { Toaster } from './components/ui/sonner'
import { CommandPalette } from './components/command/CommandPalette'
import { ensureDesktopPermission } from './services/notify'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useT } from './i18n'

/** 断线宽限：仅当后端持续不可达超过此时长才提示，避免进入界面 / 瞬断时闪烁 */
const DISCONNECT_GRACE_MS = 2500

/** 全局页面（不挂会话列表外壳）；其余一律走会话工作区（会话列表 + 对话 + 右侧 dock）。 */
const GLOBAL_PAGES: PageType[] = ['agents', 'manage', 'settings']

function ConnectionBar(): React.JSX.Element | null {
  const t = useT()
  const wsStatus = useAppStore((s) => s.wsStatus)
  const bridgeError = useAppStore((s) => s.bridgeError)
  const [showOffline, setShowOffline] = useState(false)

  // 连接中 / 已连接一律不显示标签（含进入界面时的连接态）；
  // 仅「持续断线」超过宽限期才提示，并保留重连入口
  useEffect(() => {
    if (wsStatus !== 'disconnected') return
    const timer = setTimeout(() => setShowOffline(true), DISCONNECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [wsStatus])

  // 重连后立即收起提示（渲染期同步，避免 effect 内同步 setState 的反模式）
  if (wsStatus !== 'disconnected' && showOffline) setShowOffline(false)

  if (!showOffline) return null

  return (
    <div
      className="ws-status-bar shrink-0"
      style={{
        background: 'var(--color-error-bg)',
        borderBottom: '1px solid var(--color-error-border)',
        color: 'var(--color-error)'
      }}
    >
      <AlertTriangle size={13} className="shrink-0" />
      <span className="text-xs font-medium">{bridgeError ?? t('connection.disconnected')}</span>
      <button
        onClick={() => wsClient.connect()}
        className="btn-ghost flex items-center gap-1 ml-auto px-2 py-0.5 rounded text-xs font-medium shrink-0"
        style={{ color: 'var(--color-error)' }}
      >
        <RefreshCw size={11} />
        {t('connection.reconnect')}
      </button>
    </div>
  )
}

function App(): React.JSX.Element {
  const activePage = useAppStore((s) => s.activePage)
  const rightOpen = useAppStore((s) => s.rightTab !== null)
  const rightExpanded = useAppStore((s) => s.rightExpanded)
  const groupPanelOpen = useAppStore((s) => s.groupPanelOpen)
  const isGlobal = GLOBAL_PAGES.includes(activePage)

  // 恢复用户上次拖拽的列宽（会话列表 / 右侧面板）
  useEffect(() => {
    const root = document.documentElement
    const restore = (key: string, cssVar: string): void => {
      try {
        const v = localStorage.getItem(key)
        if (v) root.style.setProperty(cssVar, v)
      } catch {
        /* ignore */
      }
    }
    restore('ah:convListWidth', '--conv-list-width')
    restore('ah:rightPanelWidth', '--right-panel-width')
  }, [])

  // 首次进入请求桌面通知权限，便于审批/任务完成等事件在窗口失焦时提醒
  useEffect(() => {
    ensureDesktopPermission()
  }, [])

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      <TitleBar />
      <ConnectionBar />
      <div className="flex flex-1 overflow-hidden">
        <IconNav />

        {/* 会话工作区：左会话列表 + 中间对话 + 右侧工作区 dock（概览/任务/Diff/预览/部署）。
            A2：dock 展开时接管中间区，隐藏对话以获得整宽工作面。 */}
        {!isGlobal && (
          <>
            <ConversationList />
            <ResizeHandle
              cssVar="--conv-list-width"
              min={220}
              max={460}
              storageKey="ah:convListWidth"
              defaultWidth={280}
            />

            {!rightExpanded && <ChatWindow />}

            {(rightOpen || groupPanelOpen) && (
              <>
                {!rightExpanded && (
                  <ResizeHandle
                    cssVar="--right-panel-width"
                    min={300}
                    max={720}
                    invert
                    storageKey="ah:rightPanelWidth"
                    defaultWidth={380}
                  />
                )}
                <GroupSettingsPanel />
                <RightDock />
              </>
            )}

            {/* dock 收起时常驻右侧图标轨，作为 概览/任务/Diff/预览/部署/计划/Git 的常显入口 */}
            {!rightOpen && <RightRail />}
          </>
        )}

        {activePage === 'agents' && <AgentsPage />}

        {activePage === 'manage' && <ManagePage />}

        {activePage === 'settings' && <SettingsPage />}
      </div>
      <Toaster richColors position="top-right" closeButton />
      <CommandPalette />
    </div>
  )
}

export default App
