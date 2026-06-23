import { useMemo } from 'react'
import { UserPlus } from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import { useT } from '../../i18n'
import { GroupAvatar } from '../ui/GroupAvatar'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'
import { getRoleLabel } from '../ui/role'

/** 顶部会话头：群组头像 + 标题 ▾ + 成员副行 + 右侧操作（对齐 ref01/03/04/05/07）。
 *  `actions` 为页面专属按钮（如「上线部署」「发起部署」），渲染在标准图标按钮左侧。 */
export function ConversationHeader({
  actions
}: {
  actions?: React.ReactNode
}): React.JSX.Element | null {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const agents = useAppStore((s) => s.agents)
  const conv = conversations.find((c) => c.id === activeId)
  const members = useMemo(() => resolveMembers(conv, agents), [conv, agents])

  if (!conv) return null

  const subline = members.length > 0 ? members.map((m) => getRoleLabel(m.role)).join('、') : ''

  return (
    <div
      className="chat-header flex items-center justify-between gap-2 px-5 py-3 shrink-0 overflow-hidden"
      style={{
        background: 'var(--color-bg-container)',
        borderBottom: '1px solid var(--color-border-light)'
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {members.length > 0 && (
          <GroupAvatar roles={members.map((m) => m.role)} size={34} className="shrink-0" />
        )}
        <div className="flex flex-col min-w-0 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-[15px] font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {conv.title}
            </span>
            {conv.status === 'running' && (
              <Badge variant="brand" size="sm">
                {tr('common.status.running')}
              </Badge>
            )}
          </div>
          {subline && (
            <span className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('conv.group.members', { count: members.length })} · {subline}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <div className="flex items-center gap-0.5">
          <HeaderIcon
            title={tr('header.invite')}
            onClick={() => useAppStore.getState().toggleGroupPanel()}
          >
            <UserPlus size={16} />
          </HeaderIcon>
        </div>
      </div>
    </div>
  )
}

function HeaderIcon({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip content={title} placement="bottom">
      <button
        onClick={onClick}
        aria-label={title}
        className="flex items-center justify-center w-8 h-8 rounded-lg hover-spotlight"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
