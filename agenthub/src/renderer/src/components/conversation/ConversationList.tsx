import { Plus, Search, Pin, PinOff, Archive } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { formatSmartTime } from '../../services/api'
import type { Conversation } from '../../types'
import { CountBadge } from '../ui/Badge'
import { StatusDot } from '../ui/StatusDot'
import { NewProjectModal } from './NewProjectModal'

interface MenuState {
  x: number
  y: number
  conv: Conversation
}

/** 会话右键菜单：置顶/取消置顶、归档（两段式确认防误触） */
function ConvContextMenu({
  menu,
  onClose
}: {
  menu: MenuState
  onClose: () => void
}): React.JSX.Element {
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // 延迟注册：跳过触发本菜单的那次 contextmenu 冒泡，避免一开即关
    const timer = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const togglePin = (): void => {
    void useAppStore.getState().updateConversation(menu.conv.id, { pinned: !menu.conv.pinned })
    onClose()
  }

  const archive = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!confirmArchive) {
      setConfirmArchive(true)
      return
    }
    void useAppStore.getState().updateConversation(menu.conv.id, { archived: true })
    onClose()
  }

  const itemCls =
    'flex items-center gap-2 w-full px-3 py-1.5 text-xs border-none bg-transparent cursor-pointer hover-spotlight text-left'

  return (
    <div
      className="fixed py-1 rounded-lg animate-menu-pop"
      style={{
        left: menu.x,
        top: menu.y,
        zIndex: 200,
        minWidth: 140,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-light)',
        boxShadow: 'var(--shadow-float)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={togglePin}
        className={itemCls}
        style={{ color: 'var(--color-text-primary)' }}
      >
        {menu.conv.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        {menu.conv.pinned ? '取消置顶' : '置顶会话'}
      </button>
      <button
        onClick={archive}
        className={itemCls}
        style={{ color: confirmArchive ? 'var(--color-error)' : 'var(--color-text-primary)' }}
      >
        <Archive size={13} />
        {confirmArchive ? '再次点击确认归档' : '归档会话'}
      </button>
    </div>
  )
}

const STATUS_MAP: Record<Conversation['status'], 'running' | 'idle' | 'offline'> = {
  running: 'running',
  waiting_approval: 'idle',
  idle: 'offline'
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
  'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
  'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
  'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #0891b2 0%, #0d9488 100%)'
]

function ConvItem({
  conv,
  active,
  idx,
  onContextMenu
}: {
  conv: Conversation
  active: boolean
  idx: number
  onContextMenu: (e: React.MouseEvent, conv: Conversation) => void
}): React.JSX.Element {
  return (
    <div
      onClick={() => useAppStore.getState().setActiveConversation(conv.id)}
      onContextMenu={(e) => onContextMenu(e, conv)}
      className="relative flex items-center gap-3 mx-2 my-0.5 px-3 h-[60px] cursor-pointer rounded-[var(--radius-lg)]"
      style={{
        background: active
          ? 'linear-gradient(90deg, var(--color-brand-bg) 0%, transparent 130%)'
          : undefined,
        transition: 'background var(--transition-fast)'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--color-bg-spotlight)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = ''
      }}
    >
      {/* active 品牌色竖条 */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
          style={{ width: 3, height: 32, background: 'var(--color-brand)' }}
        />
      )}
      <div className="relative shrink-0">
        <div
          className="w-10 h-10 rounded-[var(--radius-lg)] flex items-center justify-center text-white text-xs font-semibold shadow-sm"
          style={{ background: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length] }}
        >
          {conv.projectName.slice(0, 2).toUpperCase()}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full p-[2px]"
          style={{ background: active ? 'var(--color-brand-bg)' : 'var(--color-bg-container)' }}
        >
          <StatusDot status={STATUS_MAP[conv.status]} />
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1 min-w-0">
            {conv.pinned && (
              <Pin size={10} className="shrink-0" style={{ color: 'var(--color-brand)' }} />
            )}
            <span
              className="text-[13px] font-medium truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {conv.title}
            </span>
          </span>
          <span
            className="text-[11px] shrink-0 ml-2 tabular-nums"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {formatSmartTime(conv.rawTime, conv.lastTime)}
          </span>
        </div>
        <div className="flex justify-between items-center mt-0.5 gap-2">
          <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {conv.lastMessage}
          </p>
          {conv.unread ? (
            // key 随未读数变化重挂载，触发 spring 弹入
            <span key={conv.unread} className="shrink-0 animate-spring-pop">
              <CountBadge count={conv.unread} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 列表加载骨架：头像圆 + 两行 shimmer ×5 */
function ListSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 mx-2 my-0.5 px-3 h-[60px]">
          <div className="skeleton w-10 h-10 rounded-[var(--radius-lg)] shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="skeleton h-3 rounded" style={{ width: '70%' }} />
            <div className="skeleton h-2.5 rounded" style={{ width: '50%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ConversationList(): React.JSX.Element {
  const conversations = useAppStore((s) => s.conversations)
  const activeId = useAppStore((s) => s.activeConversationId)
  const wsStatus = useAppStore((s) => s.wsStatus)
  const newProjectOpen = useAppStore((s) => s.newProjectOpen)
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const handleContextMenu = (e: React.MouseEvent, conv: Conversation): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, conv })
  }

  // Ctrl/⌘+K 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = search
    ? conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
    : conversations

  const loading = wsStatus !== 'connected' && conversations.length === 0

  return (
    <div
      className="flex flex-col h-full shrink-0"
      style={{
        width: 'var(--conv-list-width)',
        background: 'var(--color-bg-container)',
        borderRight: '1px solid var(--color-border)'
      }}
    >
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            会话
          </span>
          <button
            onClick={() => useAppStore.getState().setNewProjectOpen(true)}
            className="btn-press w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center text-white"
            style={{
              background: 'var(--gradient-brand)',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
              border: 'none',
              cursor: 'pointer'
            }}
            title="新建项目"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
          <input
            ref={searchRef}
            type="text"
            placeholder="搜索会话"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-12 py-2 text-xs rounded-[var(--radius-lg)] outline-none border border-transparent transition-all duration-150 bg-[var(--color-bg-spotlight)] focus:bg-[var(--color-bg-container)] focus:border-[var(--color-brand)] focus:shadow-[0_0_0_3px_var(--color-brand-bg)]"
            style={{ color: 'var(--color-text-primary)' }}
          />
          <kbd
            className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] rounded pointer-events-none select-none"
            style={{
              color: 'var(--color-text-tertiary)',
              background: 'var(--color-bg-container)',
              border: '1px solid var(--color-border-light)',
              fontFamily: 'inherit'
            }}
          >
            Ctrl K
          </kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-1 pb-2">
        {loading ? (
          <ListSkeleton />
        ) : (
          filtered.map((c, i) => (
            <ConvItem
              key={c.id}
              conv={c}
              active={c.id === activeId}
              idx={i}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {menu && <ConvContextMenu key={menu.conv.id} menu={menu} onClose={() => setMenu(null)} />}

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => useAppStore.getState().setNewProjectOpen(false)}
      />
    </div>
  )
}
