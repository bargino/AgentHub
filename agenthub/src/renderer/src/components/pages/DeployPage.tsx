import { useState } from 'react'
import { Rocket, Check, X, ExternalLink, RotateCcw, Server, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import type { DeployStatus, Deployment } from '../../types'
import { PageShell } from './PageShell'
import { HeaderActionButton } from './HeaderActionButton'
import { Stepper, type Step, type StepStatus } from '../ui/Stepper'
import { Timeline, type TimelineItem } from '../ui/Timeline'
import { KeyValueList } from '../ui/KeyValueList'

type Tone = 'brand' | 'success' | 'error' | 'warning' | 'neutral'

const STATUS_TONE: Record<DeployStatus, Tone> = {
  planned: 'warning',
  deploying: 'brand',
  success: 'success',
  failed: 'error',
  rejected: 'neutral'
}

/** 计划步骤在各部署状态下的呈现：成功=全部完成，部署中=进行中，其余=待执行 */
function stepStatus(deployStatus: DeployStatus): StepStatus {
  if (deployStatus === 'success') return 'done'
  if (deployStatus === 'deploying') return 'active'
  if (deployStatus === 'failed') return 'failed'
  return 'pending'
}

/** 后端 logs 为换行拼接的纯文本（如 "[ok] 构建产物: npm run build"），逐行转时间线 */
function parseLogs(logs: string): TimelineItem[] {
  return logs
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const ok = line.startsWith('[ok]')
      return {
        key: `log-${i}`,
        title: line.replace(/^\[ok\]\s*/, ''),
        color: ok ? 'var(--color-success)' : 'var(--color-text-tertiary)'
      }
    })
}

/** 按 provider 组装发给后端的 config（mock 无需配置；docker 端口；remote 主机/用户/命令） */
function buildConfig(
  provider: string,
  f: { port: string; host: string; user: string; command: string }
): Record<string, unknown> {
  if (provider === 'docker') return { port: f.port.trim() || '8080' }
  if (provider === 'remote') {
    return { host: f.host.trim(), user: f.user.trim() || 'deploy', command: f.command.trim() }
  }
  return {}
}

function providerLabel(p: string | undefined, tr: (k: string) => string): string {
  if (p === 'docker') return tr('deploy.providerDocker')
  if (p === 'remote') return tr('deploy.providerRemote')
  return tr('deploy.providerMock')
}

export function DeployPage(): React.JSX.Element {
  const tr = useT()
  const activeId = useAppStore((s) => s.activeConversationId)
  const deployment = useAppStore((s) => (activeId ? s.deployments[activeId] : undefined))
  const deployBusy = useAppStore((s) => s.deployBusy)
  const startDeployment = useAppStore((s) => s.startDeployment)
  const decideDeployment = useAppStore((s) => s.decideDeployment)

  // 部署目标选择 + 配置（空态发起前选择；再次发起沿用当前选择）。默认 docker（真实，无 mock）
  const [provider, setProvider] = useState('docker')
  const [port, setPort] = useState('8080')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('deploy')
  const [command, setCommand] = useState('')

  const launch = (): void => {
    void startDeployment({ provider, config: buildConfig(provider, { port, host, user, command }) })
  }

  // 无部署记录时头部不出按钮——发起入口由下方空态承载，避免「发起部署」双按钮
  const actions = !deployment ? null : deployment.status === 'planned' ? (
    <div className="flex items-center gap-2">
      <HeaderActionButton
        icon={<Check size={14} />}
        label={tr('section.deployApprove')}
        variant="brand"
        disabled={deployBusy}
        onClick={() => void decideDeployment(true)}
      />
      <HeaderActionButton
        icon={<X size={14} />}
        label={tr('section.deployReject')}
        disabled={deployBusy}
        onClick={() => void decideDeployment(false)}
      />
    </div>
  ) : (
    <HeaderActionButton
      icon={<Rocket size={14} />}
      label={tr('section.deployStart')}
      variant="brand"
      disabled={deployBusy || deployment.status === 'deploying'}
      onClick={launch}
    />
  )

  return (
    <PageShell actions={actions}>
      {!activeId ? (
        <EmptyState text={tr('deploy.noConversation')} />
      ) : !deployment ? (
        <DeployLauncher
          tr={tr}
          busy={deployBusy}
          provider={provider}
          setProvider={setProvider}
          port={port}
          setPort={setPort}
          host={host}
          setHost={setHost}
          user={user}
          setUser={setUser}
          command={command}
          setCommand={setCommand}
          onStart={launch}
        />
      ) : (
        <DeployDetail deployment={deployment} tr={tr} />
      )}
    </PageShell>
  )
}

function DeployLauncher(props: {
  tr: (k: string) => string
  busy: boolean
  provider: string
  setProvider: (v: string) => void
  port: string
  setPort: (v: string) => void
  host: string
  setHost: (v: string) => void
  user: string
  setUser: (v: string) => void
  command: string
  setCommand: (v: string) => void
  onStart: () => void
}): React.JSX.Element {
  const { tr, busy, provider, onStart } = props
  const inputCls = 'w-full rounded-[var(--radius-md)] px-3 py-2 text-sm'
  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-container)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)'
  }
  const remoteReady = props.host.trim() !== '' && props.command.trim() !== ''
  const canStart = !busy && (provider !== 'remote' || remoteReady)

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span
        className="mb-3 flex size-12 items-center justify-center rounded-[var(--radius-lg)]"
        style={{ background: 'var(--color-brand-bg)', color: 'var(--color-brand)' }}
      >
        <Server size={22} />
      </span>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {tr('deploy.empty')}
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {tr('deploy.emptyHint')}
      </p>

      <div className="mt-4 w-[300px] space-y-2 text-left">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {tr('deploy.providerLabel')}
        </label>
        <select
          className={inputCls}
          style={inputStyle}
          value={provider}
          onChange={(e) => props.setProvider(e.target.value)}
        >
          <option value="docker">{tr('deploy.providerDocker')}</option>
          <option value="remote">{tr('deploy.providerRemote')}</option>
        </select>
        {provider === 'docker' && (
          <input
            className={inputCls}
            style={inputStyle}
            placeholder={tr('deploy.cfgPort')}
            value={props.port}
            onChange={(e) => props.setPort(e.target.value)}
          />
        )}
        {provider === 'remote' && (
          <>
            <input
              className={inputCls}
              style={inputStyle}
              placeholder={tr('deploy.cfgHost')}
              value={props.host}
              onChange={(e) => props.setHost(e.target.value)}
            />
            <input
              className={inputCls}
              style={inputStyle}
              placeholder={tr('deploy.cfgUser')}
              value={props.user}
              onChange={(e) => props.setUser(e.target.value)}
            />
            <input
              className={inputCls}
              style={inputStyle}
              placeholder={tr('deploy.cfgCommand')}
              value={props.command}
              onChange={(e) => props.setCommand(e.target.value)}
            />
          </>
        )}
        {provider !== 'mock' && (
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {tr('deploy.providerHint')}
          </p>
        )}
      </div>

      <button
        className="btn-brand mt-4 flex items-center gap-1.5 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        disabled={!canStart}
        onClick={onStart}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
        {tr('section.deployStart')}
      </button>
    </div>
  )
}

function DeployDetail({
  deployment,
  tr
}: {
  deployment: Deployment
  tr: (k: string) => string
}): React.JSX.Element {
  const { plan, status, logs, resultUrl } = deployment
  const steps: Step[] = plan.steps.map((s, i) => ({
    key: `${i}-${s.name}`,
    label: s.name,
    description: s.command,
    status: stepStatus(status)
  }))
  const logItems = parseLogs(logs)
  const statusTone = STATUS_TONE[status]

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-5">
        {/* 发布计划 */}
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <SectionTitle>{tr('section.deployPlan')}</SectionTitle>
            <Tag tone={statusTone}>{tr(`deploy.status.${status}`)}</Tag>
          </div>
          {steps.length > 0 ? (
            <Stepper steps={steps} />
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('deploy.noSteps')}
            </p>
          )}
          <div
            className="mt-5 flex items-center justify-between pt-4 text-xs"
            style={{
              borderTop: '1px solid var(--color-divider)',
              color: 'var(--color-text-tertiary)'
            }}
          >
            <span>
              {tr('deploy.target')}：
              <b style={{ color: 'var(--color-text-secondary)' }}>{plan.target || '—'}</b>
            </span>
            <span className="tabular-nums">ID：{deployment.id.slice(0, 12)}</span>
          </div>
        </Card>

        {/* 部署日志 */}
        <Card>
          <SectionTitle className="mb-3">{tr('section.deployLog')}</SectionTitle>
          {logItems.length > 0 ? (
            <Timeline items={logItems} />
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {status === 'planned' ? tr('deploy.logPending') : tr('deploy.logEmpty')}
            </p>
          )}
        </Card>

        {/* 部署结果（成功后展示访问地址） */}
        {status === 'success' && resultUrl && (
          <Card>
            <SectionTitle className="mb-3">{tr('deploy.result')}</SectionTitle>
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--color-brand)' }}
            >
              <ExternalLink size={14} />
              {resultUrl}
            </a>
          </Card>
        )}
      </div>

      {/* 右侧详情 */}
      <aside
        className="w-[320px] shrink-0 space-y-4 overflow-auto p-4"
        style={{
          background: 'var(--color-bg-container)',
          borderLeft: '1px solid var(--color-border)'
        }}
      >
        <Card flat>
          <SectionTitle className="mb-2">{tr('section.envInfo')}</SectionTitle>
          <KeyValueList
            items={[
              {
                key: 'provider',
                label: tr('deploy.providerLabel'),
                value: providerLabel(deployment.provider, tr)
              },
              { key: 'project', label: tr('deploy.project'), value: plan.project || '—' },
              { key: 'target', label: tr('deploy.target'), value: plan.target || '—' },
              {
                key: 'status',
                label: tr('deploy.statusLabel'),
                value: <Tag tone={statusTone}>{tr(`deploy.status.${status}`)}</Tag>
              },
              {
                key: 'result',
                label: tr('deploy.result'),
                value: resultUrl ? (
                  <a
                    href={resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate"
                    style={{ color: 'var(--color-brand)' }}
                  >
                    {tr('deploy.openResult')}
                  </a>
                ) : (
                  '—'
                )
              }
            ]}
          />
        </Card>
        <Card flat>
          <SectionTitle className="mb-2">{tr('section.deployConfig')}</SectionTitle>
          <KeyValueList
            items={[
              { key: 'steps', label: tr('deploy.stepCount'), value: String(plan.steps.length) },
              {
                key: 'rollback',
                label: tr('deploy.rollback'),
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCcw size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                    {plan.rollback || '—'}
                  </span>
                )
              }
            ]}
          />
        </Card>
      </aside>
    </div>
  )
}

function EmptyState({
  text,
  hint,
  action
}: {
  text: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span
        className="mb-3 flex size-12 items-center justify-center rounded-[var(--radius-lg)]"
        style={{ background: 'var(--color-brand-bg)', color: 'var(--color-brand)' }}
      >
        <Server size={22} />
      </span>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </p>
      {hint && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {hint}
        </p>
      )}
      {action}
    </div>
  )
}

function Tag({
  tone,
  children,
  className
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const map: Record<Tone, { bg: string; fg: string }> = {
    brand: { bg: 'var(--color-brand-bg)', fg: 'var(--color-brand)' },
    success: { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
    error: { bg: 'var(--color-error-bg)', fg: 'var(--color-error)' },
    warning: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
    neutral: { bg: 'var(--color-bg-layout)', fg: 'var(--color-text-tertiary)' }
  }
  const c = map[tone]
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${className ?? ''}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  )
}

function SectionTitle({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <h3
      className={`text-sm font-semibold ${className ?? ''}`}
      style={{ color: 'var(--color-text-primary)' }}
    >
      {children}
    </h3>
  )
}

function Card({
  children,
  flat
}: {
  children: React.ReactNode
  flat?: boolean
}): React.JSX.Element {
  return (
    <div
      className="rounded-[var(--radius-lg)] p-4"
      style={{
        background: 'var(--color-bg-container)',
        border: flat ? '1px solid var(--color-border-light)' : '1px solid var(--color-border-light)'
      }}
    >
      {children}
    </div>
  )
}
