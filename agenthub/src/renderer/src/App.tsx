import { useAppStore } from './store'
import { wsClient } from './services/websocket'
import { TitleBar } from './components/layout/TitleBar'
import { IconNav } from './components/layout/IconNav'
import { ConversationList } from './components/conversation/ConversationList'
import { GroupSettingsPanel } from './components/conversation/GroupSettingsPanel'
import { GitPanel } from './components/git/GitPanel'
import { ChatWindow } from './components/chat/ChatWindow'
import { TaskPanel } from './components/task/TaskPanel'
import { DiffViewer } from './components/diff/DiffViewer'
import { ApprovalPanel } from './components/diff/ApprovalPanel'
import { PreviewPanel } from './components/preview/PreviewPanel'
import { AgentsPage } from './components/agents/AgentsPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'

function ConnectionBar(): React.JSX.Element | null {
  const wsStatus = useAppStore((s) => s.wsStatus)

  if (wsStatus === 'connected') return null

  const isDisconnected = wsStatus === 'disconnected'

  return (
    <div
      className="ws-status-bar shrink-0"
      style={{
        background: isDisconnected ? 'var(--color-error-bg)' : 'var(--color-warning-bg)',
        borderBottom: `1px solid ${isDisconnected ? 'var(--color-error-border)' : 'var(--color-warning-bg)'}`,
        color: isDisconnected ? 'var(--color-error)' : 'var(--color-warning-text)'
      }}
    >
      {isDisconnected ? (
        <AlertTriangle size={13} />
      ) : (
        <Loader2 size={13} className="animate-spin" />
      )}
      <span className="text-xs font-medium">
        {isDisconnected ? 'AgentHub Server 未连接' : '正在连接 AgentHub Server...'}
      </span>
      {isDisconnected && (
        <button
          onClick={() => wsClient.connect()}
          className="btn-ghost flex items-center gap-1 ml-auto px-2 py-0.5 rounded text-xs font-medium"
          style={{ color: 'var(--color-error)' }}
        >
          <RefreshCw size={11} />
          重连
        </button>
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  const activePage = useAppStore((s) => s.activePage)

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      <TitleBar />
      <ConnectionBar />
      <div className="flex flex-1 overflow-hidden">
        <IconNav />

        {activePage === 'chat' && (
          <>
            <ConversationList />
            <ChatWindow />
            <TaskPanel />
            <GroupSettingsPanel />
            <GitPanel />
            <DiffViewer />
            <PreviewPanel />
          </>
        )}

        {activePage === 'agents' && <AgentsPage />}

        {activePage === 'settings' && <SettingsPage />}

        <ApprovalPanel />
      </div>
    </div>
  )
}

export default App
