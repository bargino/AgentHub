import { useEffect, useMemo, useState } from 'react'
import {
  ShieldAlert,
  ScanEye,
  Check,
  X,
  MessageSquareReply,
  FileDiff,
  Terminal,
  PackagePlus,
  Rocket,
  CheckCheck,
  Keyboard,
  type LucideIcon
} from 'lucide-react'
import { useAppStore } from '../../store'
import { Badge } from '../ui/Badge'
import { ROLE_CONFIG, customRoleConfig } from '../ui/role'
import { notify } from '../../services/notify'
import { useT } from '../../i18n'
import type { Approval, RiskLevel } from '../../types'
import { DiffView } from './DiffViewer'

const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

const RISK_CONFIG: Record<
  RiskLevel,
  { labelKey: string; variant: 'success' | 'warning' | 'error' }
> = {
  low: { labelKey: 'approval.risk.low', variant: 'success' },
  medium: { labelKey: 'approval.risk.medium', variant: 'warning' },
  high: { labelKey: 'approval.risk.high', variant: 'error' }
}

const ACTION_KEYS: Record<string, string> = {
  apply_diff: 'approval.action.apply_diff',
  run_command: 'approval.action.run_command',
  install_dependency: 'approval.action.install_dependency',
  deploy: 'approval.action.deploy'
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  apply_diff: FileDiff,
  run_command: Terminal,
  install_dependency: PackagePlus,
  deploy: Rocket
}

function riskColor(level: RiskLevel): string {
  return level === 'high'
    ? 'var(--color-error)'
    : level === 'medium'
      ? 'var(--color-warning)'
      : 'var(--color-success)'
}

function agentColor(role?: string | null): string {
  if (!role) return 'var(--color-text-tertiary)'
  return (ROLE_CONFIG[role] ?? customRoleConfig(role)).color
}

/** 在输入框/文本域内时不拦截键盘快捷键 */
function isTypingTarget(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

export function ReviewCenter(): React.JSX.Element {
  const tr = useT()
  const pendingApprovals = useAppStore((s) => s.pendingApprovals)
  const activeDiff = useAppStore((s) => s.activeDiff)
  const diffsById = useAppStore((s) => s.diffsById)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [fileIndex, setFileIndex] = useState(0)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  // 结构化退回：审查意见随拒绝一并发回 Agent，触发其重新修改（evaluator-optimizer 回环）
  const [comment, setComment] = useState('')
  // 高风险二次确认：避免键盘/误点一键放行不可逆操作
  const [confirmHigh, setConfirmHigh] = useState(false)

  // 高风险优先排序（稳定：同风险保持创建顺序）
  const sorted = useMemo(
    () =>
      pendingApprovals
        .map((a, i) => ({ a, i }))
        .sort((x, y) => RISK_RANK[x.a.riskLevel] - RISK_RANK[y.a.riskLevel] || x.i - y.i)
        .map((o) => o.a),
    [pendingApprovals]
  )

  const selected: Approval | null = sorted.find((a) => a.id === selectedId) ?? sorted[0] ?? null
  const selectedDiff = selected?.diffId ? diffsById[selected.diffId] : undefined
  const standalone = pendingApprovals.length === 0 ? activeDiff : null
  const shownDiff = selectedDiff ?? standalone ?? undefined

  // 选中项 / diff 变化时复位文件索引：渲染期同步调整 state（React 推荐模式，避免 effect 级联渲染）
  const viewKey = selectedDiff?.id ?? standalone?.id ?? selected?.id ?? null
  const [prevViewKey, setPrevViewKey] = useState<string | null>(viewKey)
  if (viewKey !== prevViewKey) {
    setPrevViewKey(viewKey)
    setFileIndex(0)
    setConfirmHigh(false)
    setComment('')
  }

  const decide = (id: string, d: 'approved' | 'rejected'): void => {
    void useAppStore.getState().decideApproval(id, d)
  }

  const decideBatch = async (ids: string[], d: 'approved' | 'rejected'): Promise<void> => {
    if (ids.length === 0) return
    setBatch({ done: 0, total: ids.length })
    for (const id of ids) {
      await useAppStore.getState().decideApproval(id, d)
      setBatch((b) => (b ? { ...b, done: b.done + 1 } : b))
    }
    setBatch(null)
    setChecked(new Set())
  }

  const approveStandalone = (): void => void useAppStore.getState().approveDiff()
  const rejectStandalone = (): void => void useAppStore.getState().rejectDiff()

  // 结构化退回：把「文件清单 + 审查意见」拼成草稿发回输入框，用户确认后即触发 Agent 复改
  const composeRevision = (files: string, note: string): void => {
    const draft = tr('diff.revisionDraft', { files: files || tr('approval.noSummary') })
    useAppStore.setState({ draftMessage: draft + (note.trim() ? note.trim() : '') })
  }
  const requestRevision = (): void => {
    if (!standalone) return
    void useAppStore.getState().rejectDiff()
    composeRevision(standalone.files.map((f) => f.filename).join(', '), comment)
    setComment('')
  }
  const requestChanges = (a: Approval): void => {
    decide(a.id, 'rejected')
    const files = a.diffId
      ? (diffsById[a.diffId]?.files.map((f) => f.filename).join(', ') ?? a.summary)
      : a.summary
    composeRevision(files, comment)
    setComment('')
  }
  // 高风险通过需二次确认（点击）；普通项直接通过
  const approveSelected = (a: Approval): void => {
    if (a.riskLevel === 'high' && !confirmHigh) {
      setConfirmHigh(true)
      return
    }
    decide(a.id, 'approved')
  }

  // 键盘导航：j/k 跨文件，a/r 通过/拒绝当前项；高风险通过须 Shift+A，防误触不可逆操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget() || e.metaKey || e.ctrlKey || e.altKey) return
      const fileCount = shownDiff?.files.length ?? 0
      const key = e.key.toLowerCase()
      if (key === 'j') {
        if (fileCount) setFileIndex((i) => Math.min(fileCount - 1, i + 1))
      } else if (key === 'k') {
        if (fileCount) setFileIndex((i) => Math.max(0, i - 1))
      } else if (key === 'a') {
        if (selected) {
          if (selected.riskLevel === 'high' && !e.shiftKey) {
            notify.info(tr('review.highRiskConfirmHint'))
          } else {
            decide(selected.id, 'approved')
          }
        } else if (standalone?.status === 'pending') {
          approveStandalone()
        }
      } else if (key === 'r') {
        if (selected) decide(selected.id, 'rejected')
        else if (standalone?.status === 'pending') rejectStandalone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, shownDiff, standalone, tr])

  // 空态
  if (pendingApprovals.length === 0 && !activeDiff) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <ScanEye size={30} />
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('review.empty')}
        </span>
        <span className="text-xs">{tr('review.emptySub')}</span>
      </div>
    )
  }

  const KbdHint = (
    <span
      className="flex items-center gap-1 text-[11px]"
      style={{ color: 'var(--color-text-tertiary)' }}
      title={tr('review.kbdHint')}
    >
      <Keyboard size={12} />
      <kbd className="kbd">j</kbd>
      <kbd className="kbd">k</kbd>
      <kbd className="kbd">a</kbd>
      <kbd className="kbd">r</kbd>
    </span>
  )

  // 仅 diff（无审批门）：沿用 diff 自身决策入口
  if (standalone) {
    const isPending = standalone.status === 'pending'
    return (
      <div
        className="flex flex-col h-full min-h-0"
        style={{ background: 'var(--color-bg-container)' }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {tr('diff.title')}
          </span>
          {isPending && (
            <Badge variant="warning" size="sm">
              {tr('diff.pendingTag')}
            </Badge>
          )}
          <div className="ml-auto">{KbdHint}</div>
        </div>
        {standalone.summary && (
          <div
            className="px-4 py-2 text-xs shrink-0"
            style={{
              background: 'var(--color-bg-spotlight)',
              borderBottom: '1px solid var(--color-border-light)',
              color: 'var(--color-text-secondary)'
            }}
          >
            {standalone.summary}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <DiffView diff={standalone} fileIndex={fileIndex} onFileIndexChange={setFileIndex} />
        </div>
        {isPending ? (
          <div
            className="flex items-center gap-2 px-4 py-3 shrink-0"
            style={{ borderTop: '1px solid var(--color-border-light)' }}
          >
            <button
              onClick={rejectStandalone}
              className="btn-press btn-outline-error flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md"
            >
              <X size={14} /> {tr('diff.reject')}
            </button>
            <button
              onClick={approveStandalone}
              className="btn-press btn-success flex items-center gap-1.5 text-sm rounded-md"
            >
              <Check size={14} /> {tr('diff.approve')}
            </button>
            <button
              onClick={requestRevision}
              className="btn-press btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md ml-auto"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <MessageSquareReply size={14} /> {tr('diff.requestRevision')}
            </button>
          </div>
        ) : (
          <div
            className="flex items-center justify-center px-4 py-3 shrink-0"
            style={{ borderTop: '1px solid var(--color-border-light)' }}
          >
            <Badge variant={standalone.status === 'approved' ? 'success' : 'error'} size="md">
              {standalone.status === 'approved' ? tr('diff.approved') : tr('diff.rejected')}
            </Badge>
          </div>
        )}
      </div>
    )
  }

  // 审批队列模式
  const allIds = sorted.map((a) => a.id)
  const checkedIds = allIds.filter((id) => checked.has(id))
  const allChecked = checkedIds.length === allIds.length && allIds.length > 0
  const batchTargets = checkedIds.length > 0 ? checkedIds : allIds
  const ActionIcon = selected ? (ACTION_ICONS[selected.actionType] ?? Terminal) : Terminal

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--color-bg-container)' }}
    >
      {/* 头部 + 批量进度条（替代溢出圆点） */}
      <div className="shrink-0" style={{ borderBottom: '1px solid var(--color-border-light)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
            style={{ background: 'var(--color-brand-bg)' }}
          >
            <ScanEye size={15} style={{ color: 'var(--color-brand)' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {tr('review.title')}
          </span>
          <Badge variant="warning" size="sm">
            {tr('review.pendingCount', { count: sorted.length })}
          </Badge>
          <div className="ml-auto">{KbdHint}</div>
        </div>
        {batch && (
          <div className="px-4 pb-2">
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: 'var(--color-border-light)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((batch.done / batch.total) * 100)}%`,
                  background: 'var(--color-brand)',
                  transition: 'width var(--duration-base) var(--ease-out-quart)'
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 审查队列 */}
        <div
          className="flex flex-col shrink-0"
          style={{ width: 232, borderRight: '1px solid var(--color-border-light)' }}
        >
          {/* 批量操作条 */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-2 shrink-0"
            style={{ borderBottom: '1px solid var(--color-border-light)' }}
          >
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => setChecked(e.target.checked ? new Set(allIds) : new Set())}
                className="cursor-pointer"
              />
              <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                {checkedIds.length > 0
                  ? tr('review.selectedCount', { count: checkedIds.length })
                  : tr('review.selectAll')}
              </span>
            </label>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => void decideBatch(batchTargets, 'rejected')}
                disabled={!!batch}
                title={tr('review.batchReject')}
                className="btn-press btn-outline-error flex items-center justify-center w-7 h-7 rounded-md disabled:opacity-50"
              >
                <X size={14} />
              </button>
              <button
                onClick={() => void decideBatch(batchTargets, 'approved')}
                disabled={!!batch}
                title={tr('review.batchApprove')}
                className="btn-press btn-success flex items-center justify-center w-7 h-7 rounded-md disabled:opacity-50"
                style={{ padding: 0 }}
              >
                <CheckCheck size={14} />
              </button>
            </div>
          </div>

          {/* 队列项 */}
          <div className="flex-1 overflow-y-auto py-1">
            {sorted.map((a) => {
              const active = selected?.id === a.id
              const high = a.riskLevel === 'high'
              const Icon = ACTION_ICONS[a.actionType] ?? Terminal
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`relative flex items-start gap-2 px-2.5 py-2 cursor-pointer transition-colors ${
                    active ? 'bg-[var(--color-brand-bg)]' : 'hover-spotlight'
                  }`}
                  style={{
                    borderLeft: `2px solid ${high ? 'var(--color-error)' : active ? 'var(--color-brand)' : 'transparent'}`,
                    background: high && !active ? 'var(--color-error-bg)' : undefined
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(a.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = new Set(checked)
                      if (e.target.checked) next.add(a.id)
                      else next.delete(a.id)
                      setChecked(next)
                    }}
                    className="mt-0.5 cursor-pointer shrink-0"
                  />
                  <Icon
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: agentColor(a.agentRole) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-medium truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {ACTION_KEYS[a.actionType] ? tr(ACTION_KEYS[a.actionType]) : a.actionType}
                      </span>
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: riskColor(a.riskLevel) }}
                        title={tr(RISK_CONFIG[a.riskLevel].labelKey)}
                      />
                    </div>
                    <div
                      className="text-[11px] truncate mt-0.5"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      {a.agentName ?? a.agentRole ?? tr('approval.unknownAgent')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 选中项详情：apply_diff 内联 diff，其余动作展示详情卡 */}
        <div className="flex flex-col flex-1 min-w-0">
          {selected && (
            <>
              <div
                className="flex items-center gap-2 px-4 py-2.5 shrink-0 flex-wrap"
                style={{ borderBottom: '1px solid var(--color-border-light)' }}
              >
                <ActionIcon size={15} style={{ color: agentColor(selected.agentRole) }} />
                <span
                  className="text-sm font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {ACTION_KEYS[selected.actionType]
                    ? tr(ACTION_KEYS[selected.actionType])
                    : selected.actionType}
                </span>
                <Badge variant={RISK_CONFIG[selected.riskLevel].variant} size="sm">
                  {tr(RISK_CONFIG[selected.riskLevel].labelKey)}
                </Badge>
                <span className="text-xs" style={{ color: agentColor(selected.agentRole) }}>
                  {selected.agentName ?? selected.agentRole ?? tr('approval.unknownAgent')}
                </span>
              </div>

              {/* 高风险理由醒目化 */}
              {selected.riskLevel === 'high' && (
                <div
                  className="flex items-start gap-2 px-4 py-2 text-xs shrink-0"
                  style={{
                    background: 'var(--color-error-bg)',
                    color: 'var(--color-error)',
                    borderBottom: '1px solid var(--color-border-light)'
                  }}
                >
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  <span>{tr('review.highRiskNotice')}</span>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden">
                {selectedDiff ? (
                  <DiffView
                    diff={selectedDiff}
                    fileIndex={fileIndex}
                    onFileIndexChange={setFileIndex}
                  />
                ) : (
                  <div className="p-4 overflow-y-auto h-full">
                    <p
                      className="text-sm leading-relaxed m-0 whitespace-pre-wrap"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {selected.summary || tr('approval.noSummary')}
                    </p>
                    {selected.actionType === 'apply_diff' && (
                      <p className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
                        {tr('review.diffUnavailable')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 单项决策栏：可附结构化审查意见（随拒绝发回 Agent），高风险通过需二次确认 */}
              <div
                className="flex flex-col gap-2 px-4 py-3 shrink-0"
                style={{ borderTop: '1px solid var(--color-border-light)' }}
              >
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={tr('review.revisionPlaceholder')}
                  rows={2}
                  className="w-full resize-none rounded-md px-2.5 py-1.5 text-xs outline-none"
                  style={{
                    background: 'var(--color-bg-spotlight)',
                    border: '1px solid var(--color-border-light)',
                    color: 'var(--color-text-primary)'
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => decide(selected.id, 'rejected')}
                    className="btn-press btn-outline-error flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md"
                  >
                    <X size={14} /> {tr('approval.reject')}
                  </button>
                  <button
                    onClick={() => approveSelected(selected)}
                    className="btn-press btn-success flex items-center gap-1.5 text-sm rounded-md"
                  >
                    <Check size={14} />{' '}
                    {selected.riskLevel === 'high' && confirmHigh
                      ? tr('review.confirmApprove')
                      : tr('approval.approve')}
                  </button>
                  <button
                    onClick={() => requestChanges(selected)}
                    className="btn-press btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md ml-auto"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <MessageSquareReply size={14} /> {tr('review.requestRevision')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
