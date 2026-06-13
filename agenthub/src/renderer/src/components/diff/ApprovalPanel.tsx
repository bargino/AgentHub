import { useEffect, useMemo, useState } from 'react'
import {
  ShieldAlert,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bot,
  type LucideIcon
} from 'lucide-react'
import { useAppStore } from '../../store'
import { Badge } from '../ui/Badge'
import { ROLE_CONFIG, customRoleConfig } from '../ui/role'
import type { Approval, RiskLevel } from '../../types'

const RISK_CONFIG: Record<RiskLevel, { label: string; variant: 'success' | 'warning' | 'error' }> =
  {
    low: { label: '低风险', variant: 'success' },
    medium: { label: '中等风险', variant: 'warning' },
    high: { label: '高风险', variant: 'error' }
  }

const ACTION_LABELS: Record<string, string> = {
  apply_diff: '应用代码变更',
  run_command: '执行命令',
  install_dependency: '安装依赖',
  deploy: '部署应用'
}

const UNKNOWN_KEY = '__unknown__'

interface AgentGroup {
  key: string
  name: string
  icon: LucideIcon
  color: string
  items: Approval[]
}

function agentVisual(role?: string | null): { icon: LucideIcon; color: string } {
  if (!role) return { icon: Bot, color: 'var(--color-text-tertiary)' }
  const cfg = ROLE_CONFIG[role] ?? customRoleConfig(role)
  return { icon: cfg.icon, color: cfg.color }
}

function riskBand(level: RiskLevel): string {
  return level === 'high'
    ? 'var(--color-error)'
    : level === 'medium'
      ? 'var(--color-warning)'
      : 'var(--color-success)'
}

export function ApprovalPanel(): React.JSX.Element | null {
  const pendingApprovals = useAppStore((s) => s.pendingApprovals)
  const decisions = useAppStore((s) => s.approvalDecisions)
  const setApprovalDecision = useAppStore((s) => s.setApprovalDecision)
  const submitApprovalGroup = useAppStore((s) => s.submitApprovalGroup)

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 按 Agent 分组（同一 Agent 的问题归为一组，各组独立提交）
  const groups = useMemo<AgentGroup[]>(() => {
    const map = new Map<string, AgentGroup>()
    for (const a of pendingApprovals) {
      const key = a.agentRole ?? UNKNOWN_KEY
      if (!map.has(key)) {
        const visual = agentVisual(a.agentRole)
        map.set(key, {
          key,
          name: a.agentName ?? a.agentRole ?? '未知 Agent',
          icon: visual.icon,
          color: visual.color,
          items: []
        })
      }
      map.get(key)!.items.push(a)
    }
    return Array.from(map.values())
  }, [pendingApprovals])

  // 维持 activeKey 始终指向一个有效分组（分组提交后自动切到下一组）
  useEffect(() => {
    if (groups.length === 0) {
      if (activeKey !== null) setActiveKey(null)
      return
    }
    if (!activeKey || !groups.some((g) => g.key === activeKey)) {
      setActiveKey(groups[0].key)
      setStep(0)
    }
  }, [groups, activeKey])

  if (pendingApprovals.length === 0) return null

  const group = groups.find((g) => g.key === activeKey) ?? groups[0]
  if (!group) return null

  const items = group.items
  const safeStep = Math.min(step, items.length - 1)
  const current = items[safeStep]
  const currentDecision = decisions[current.id]
  const decidedCount = items.filter((a) => decisions[a.id]).length
  const allDecided = decidedCount === items.length
  const totalPending = pendingApprovals.length

  const choose = (decision: 'approved' | 'rejected'): void => {
    setApprovalDecision(current.id, decision)
    // 选择完跳转下一个（未到最后一题则前进）
    if (safeStep < items.length - 1) setStep(safeStep + 1)
  }

  const goPrev = (): void => setStep(Math.max(0, safeStep - 1))
  const goNext = (): void => setStep(Math.min(items.length - 1, safeStep + 1))

  const switchGroup = (key: string): void => {
    setActiveKey(key)
    setStep(0)
  }

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      await submitApprovalGroup(group.key)
    } finally {
      setSubmitting(false)
    }
  }

  const AgentIcon = group.icon

  // 折叠态：右下角紧凑药丸，完全不遮挡界面
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="btn-press animate-spring-pop fixed flex items-center gap-2 px-3.5 h-10 rounded-full cursor-pointer"
        style={{
          right: 16,
          bottom: 16,
          zIndex: 60,
          background: 'var(--color-bg-container)',
          boxShadow: 'var(--shadow-float)',
          border: '1px solid var(--color-border-light)'
        }}
      >
        <span
          className="flex items-center justify-center w-6 h-6 rounded-full"
          style={{ background: 'var(--color-brand-bg)' }}
        >
          <ShieldAlert size={14} style={{ color: 'var(--color-brand)' }} />
        </span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {totalPending} 项待确认
        </span>
      </button>
    )
  }

  return (
    <div
      className="animate-spring-pop fixed flex flex-col rounded-xl overflow-hidden"
      style={{
        right: 16,
        bottom: 16,
        width: 380,
        maxHeight: '72vh',
        zIndex: 60,
        background: 'var(--color-bg-container)',
        boxShadow: 'var(--shadow-float)',
        border: '1px solid var(--color-border-light)'
      }}
      role="dialog"
      aria-label="待确认审批"
    >
      {/* 风险色带 */}
      <div style={{ height: 3, background: riskBand(current.riskLevel) }} />

      {/* header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border-light)' }}
      >
        <div
          className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg"
          style={{ background: 'var(--color-brand-bg)' }}
        >
          <ShieldAlert size={16} style={{ color: 'var(--color-brand)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            需要您的确认
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            共 {totalPending} 项
            {groups.length > 1 ? ` · ${groups.length} 个 Agent` : ''}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md cursor-pointer"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {/* 多 Agent 分组切换条 */}
      {groups.length > 1 && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          {groups.map((g) => {
            const gDecided = g.items.filter((a) => decisions[a.id]).length
            const gAll = gDecided === g.items.length
            const active = g.key === group.key
            const GIcon = g.icon
            return (
              <button
                key={g.key}
                onClick={() => switchGroup(g.key)}
                className="btn-press flex items-center gap-1.5 px-2.5 h-7 rounded-full shrink-0 cursor-pointer text-xs"
                style={{
                  border: `1px solid ${active ? g.color : 'var(--color-border)'}`,
                  background: active ? 'var(--color-bg-spotlight)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontWeight: active ? 600 : 400
                }}
              >
                <GIcon size={12} style={{ color: g.color }} />
                <span className="truncate max-w-[88px]">{g.name}</span>
                {gAll ? (
                  <Check size={12} style={{ color: 'var(--color-success)' }} />
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {gDecided}/{g.items.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* body：当前 Agent 当前题 */}
      <div className="flex flex-col gap-2.5 px-4 py-3 overflow-y-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: group.color }}>
            <AgentIcon size={13} />
            {group.name}
          </span>
          <Badge variant={RISK_CONFIG[current.riskLevel].variant} size="sm">
            {RISK_CONFIG[current.riskLevel].label}
          </Badge>
          <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
            第 {safeStep + 1} / {items.length} 题
          </span>
        </div>

        <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {ACTION_LABELS[current.actionType] ?? current.actionType}
        </div>

        <p
          className="text-sm leading-relaxed m-0 max-h-40 overflow-y-auto"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {current.summary || '（无补充说明）'}
        </p>

        {/* 决策选择（暂存，可回退修改） */}
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={() => choose('rejected')}
            className="btn-press flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              border: `1px solid ${currentDecision === 'rejected' ? 'var(--color-error)' : 'var(--color-border)'}`,
              background:
                currentDecision === 'rejected' ? 'var(--color-error-bg)' : 'transparent',
              color:
                currentDecision === 'rejected'
                  ? 'var(--color-error)'
                  : 'var(--color-text-secondary)'
            }}
          >
            <X size={15} />
            拒绝
          </button>
          <button
            onClick={() => choose('approved')}
            className="btn-press flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              border: `1px solid ${currentDecision === 'approved' ? 'var(--color-success)' : 'var(--color-border)'}`,
              background:
                currentDecision === 'approved' ? 'var(--color-success-bg)' : 'transparent',
              color:
                currentDecision === 'approved'
                  ? 'var(--color-success)'
                  : 'var(--color-text-secondary)'
            }}
          >
            <Check size={15} />
            批准
          </button>
        </div>
      </div>

      {/* footer：题目导航 + 分组提交 */}
      <div
        className="flex flex-col gap-2 px-4 pt-2.5 pb-3"
        style={{ borderTop: '1px solid var(--color-border-light)' }}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={goPrev}
            disabled={safeStep === 0}
            className="btn-press flex items-center gap-1 h-7 px-2 rounded-md text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <ChevronLeft size={14} />
            上一题
          </button>

          {/* 进度圆点 */}
          <div className="flex items-center gap-1">
            {items.map((a, i) => {
              const decided = !!decisions[a.id]
              const isCur = i === safeStep
              return (
                <span
                  key={a.id}
                  className="rounded-full"
                  style={{
                    width: isCur ? 8 : 6,
                    height: isCur ? 8 : 6,
                    background: decided
                      ? decisions[a.id] === 'approved'
                        ? 'var(--color-success)'
                        : 'var(--color-error)'
                      : isCur
                        ? 'var(--color-brand)'
                        : 'var(--color-border)',
                    transition: 'all var(--duration-fast) var(--ease-out-quart)'
                  }}
                />
              )
            })}
          </div>

          <button
            onClick={goNext}
            disabled={safeStep === items.length - 1}
            className="btn-press flex items-center gap-1 h-7 px-2 rounded-md text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            下一题
            <ChevronRight size={14} />
          </button>
        </div>

        <button
          onClick={submit}
          disabled={!allDecided || submitting}
          className="btn-brand btn-press h-9 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {allDecided
            ? `提交 ${group.name} 的 ${items.length} 项决策`
            : `请先完成全部选择（${decidedCount}/${items.length}）`}
        </button>
      </div>
    </div>
  )
}
