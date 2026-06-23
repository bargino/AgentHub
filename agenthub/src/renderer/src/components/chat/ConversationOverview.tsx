import { useMemo } from 'react'
import { Bot, ListTodo, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { useAppStore, resolveMembers } from '../../store'
import { useT } from '../../i18n'
import { GroupAvatar } from '../ui/GroupAvatar'
import { StatCard } from '../ui/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { Timeline, type TimelineItem } from '../ui/Timeline'
import { Badge } from '../ui/Badge'
import { getRoleColor, getRoleLabel } from '../ui/role'
import type { MessageType } from '../../types'

const ACTIVITY_COLOR: Partial<Record<MessageType, string>> = {
  user: 'var(--color-text-tertiary)',
  approval: 'var(--color-warning)',
  error: 'var(--color-error)'
}

/** 会话概览仪表盘（对齐 ref02）：欢迎横幅 + 统计磁贴 + 最近活动 + 快捷入口 + 会话信息。 */
export function ConversationOverview(): React.JSX.Element {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const agents = useAppStore((s) => s.agents)
  const messagesMap = useAppStore((s) => s.messages)
  const tasksMap = useAppStore((s) => s.tasks)
  const pendingCount = useAppStore((s) => s.pendingApprovals.length)

  const conv = conversations.find((c) => c.id === activeId)
  const members = useMemo(() => resolveMembers(conv, agents), [conv, agents])
  const tasks = activeId ? (tasksMap[activeId] ?? []) : []
  const messages = useMemo(
    () => (activeId ? (messagesMap[activeId] ?? []) : []),
    [activeId, messagesMap]
  )

  const running = tasks.filter((t) => t.status === 'running').length
  const done = tasks.filter((t) => t.status === 'success').length

  const activity: TimelineItem[] = useMemo(
    () =>
      messages
        .slice(-6)
        .reverse()
        .map((m) => {
          const isAgent = m.type === 'agent' || m.type === 'thinking' || m.type === 'tool'
          const role = m.agentRole ?? 'orchestrator'
          const title = isAgent ? (m.agentName ?? getRoleLabel(role)) : tr('common.meInitial')
          return {
            key: m.id,
            color: isAgent ? getRoleColor(role) : (ACTIVITY_COLOR[m.type] ?? 'var(--color-brand)'),
            title,
            description: m.content.replace(/\s+/g, ' ').slice(0, 80),
            time: m.timestamp
          }
        }),
    [messages, tr]
  )

  const statusLabel =
    conv?.status === 'running'
      ? tr('common.status.running')
      : conv?.status === 'waiting_approval'
        ? tr('overview.stat.pending')
        : tr('common.status.idle')

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-5"
      style={{ background: 'var(--color-bg-layout)' }}
    >
      <div className="mx-auto flex max-w-[960px] flex-col gap-5">
        {/* 欢迎横幅 */}
        <div
          className="relative flex items-center justify-between gap-4 overflow-hidden rounded-[var(--radius-xl)] px-6 py-5"
          style={{
            background:
              'linear-gradient(120deg, color-mix(in srgb, var(--color-brand) 10%, var(--color-bg-container)) 0%, var(--color-bg-container) 60%)',
            border: '1px solid var(--color-border-light)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div className="flex min-w-0 items-center gap-4">
            <GroupAvatar roles={members.map((m) => m.role)} size={48} className="shrink-0" />
            <div className="min-w-0">
              <div
                className="mb-0.5 font-medium"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-brand)' }}
              >
                {tr('overview.welcomeBack')}
              </div>
              <h1
                className="truncate font-semibold"
                style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-primary)' }}
              >
                {conv?.title ?? ''}
              </h1>
              <p
                className="mt-0.5 truncate"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}
              >
                {tr('overview.resume')}
              </p>
            </div>
          </div>
        </div>

        {/* 统计磁贴 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon={Bot} label={tr('overview.stat.agents')} value={members.length} />
          <StatCard
            icon={ListTodo}
            iconColor="var(--color-role-orchestrator)"
            label={tr('overview.stat.running')}
            value={running}
          />
          <StatCard
            icon={ShieldCheck}
            iconColor="var(--color-warning)"
            label={tr('overview.stat.pending')}
            value={pendingCount}
          />
          <StatCard
            icon={CheckCircle2}
            iconColor="var(--color-success)"
            label={tr('overview.stat.done')}
            value={done}
          />
        </div>

        {/* 最近活动 + 侧栏（快捷入口 / 会话信息） */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{tr('overview.recent')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              {activity.length > 0 ? (
                <Timeline items={activity} />
              ) : (
                <div
                  className="py-8 text-center"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}
                >
                  {tr('overview.recentEmpty')}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{tr('overview.info')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 pt-1">
                <InfoRow label={tr('overview.infoProject')} value={conv?.projectName || '—'} />
                <InfoRow
                  label={tr('overview.infoStatus')}
                  value={
                    <Badge variant={conv?.status === 'running' ? 'brand' : 'default'} size="sm">
                      {statusLabel}
                    </Badge>
                  }
                />
                <InfoRow
                  label={tr('overview.infoMembers')}
                  value={`${members.length}${tr('overview.membersUnit')}`}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
        {label}
      </span>
      <span
        className="truncate font-medium"
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}
