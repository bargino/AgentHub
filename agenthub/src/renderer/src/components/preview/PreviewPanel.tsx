import { RefreshCw, ExternalLink, Terminal, Play, Square, ArrowRight, Loader2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store'
import { StatusDot } from '../ui/StatusDot'
import { wsClient, type WsServerFrame } from '../../services/websocket'
import { startPreview, stopPreview } from '../../services/api'
import { HttpError } from '../../services/http'
import { useT } from '../../i18n'

type ServerStatus = 'online' | 'idle' | 'offline'

export function PreviewPanel(): React.JSX.Element {
  const tr = useT()
  const previewUrl = useAppStore((s) => s.previewUrl)
  const cid = useAppStore((s) => s.activeConversationId)
  const [loading, setLoading] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [key, setKey] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [wsStatus, setWsStatus] = useState<ServerStatus>('idle')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  // 派生：有 previewUrl 且未收到 failed 事件即视为在线（替代 effect 内同步 setState）
  const serverStatus: ServerStatus = previewUrl && wsStatus !== 'offline' ? 'online' : wsStatus

  useEffect(() => {
    const handler = (frame: WsServerFrame): void => {
      if (frame.type === 'preview.started') {
        setWsStatus('online')
        setStarting(false)
        setStartError(null)
        setLogs((prev) => [
          ...prev,
          `[preview] server started: ${(frame.data as { previewUrl?: string }).previewUrl ?? ''}`
        ])
      } else if (frame.type === 'preview.failed') {
        setWsStatus('offline')
        setStarting(false)
        const d = frame.data as { error?: string; logs?: string[] }
        const errMsg = d.error ?? 'unknown error'
        setStartError(errMsg)
        setLogs((prev) => [
          ...prev,
          `[preview] failed: ${errMsg}`,
          ...(d.logs && d.logs.length > 0
            ? ['[preview] ──── dev server 输出（最后 20 行）────', ...d.logs]
            : [])
        ])
        // 失败时自动展开日志，让真实子进程报错（如缺依赖）当场可见
        setShowLogs(true)
      }
    }
    wsClient.onEvent(handler)
    return () => wsClient.offEvent(handler)
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const displayUrl = previewUrl ?? ''
  const hasUrl = !!previewUrl

  const handleRefresh = (): void => {
    if (!hasUrl) return
    setLoading(true)
    setKey((k) => k + 1)
    setLogs((prev) => [...prev, `[preview] refreshing iframe...`])
  }

  const handleStart = async (): Promise<void> => {
    if (!cid || starting) return
    setStarting(true)
    setStartError(null)
    setLogs((prev) => [...prev, '[preview] starting dev server...'])
    try {
      const res = await startPreview(cid)
      // 兜底：preview.started 事件也会设置，但直接用返回值更即时
      useAppStore.setState({ previewUrl: res.previewUrl })
      setWsStatus('online')
    } catch (e) {
      const msg = e instanceof HttpError ? e.body : String(e)
      setStartError(msg)
      setLogs((prev) => [...prev, `[preview] start failed: ${msg}`])
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async (): Promise<void> => {
    if (!cid) return
    try {
      await stopPreview(cid)
    } catch {
      /* 停止失败不阻断：仍清理前端状态 */
    }
    useAppStore.setState({ previewUrl: null })
    setWsStatus('idle')
    setLogs((prev) => [...prev, '[preview] stopped'])
  }

  const handleManualGo = (): void => {
    const u = manualUrl.trim()
    if (!u) return
    const url = /^https?:\/\//i.test(u) ? u : `http://${u}`
    useAppStore.setState({ previewUrl: url })
    setWsStatus('online')
  }

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--color-bg-elevated, #fff)' }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div
          className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 min-w-0"
          style={{ background: 'var(--color-bg-spotlight)' }}
        >
          <StatusDot
            status={
              serverStatus === 'online' ? 'running' : serverStatus === 'idle' ? 'idle' : 'offline'
            }
            size="sm"
          />
          <span
            className="text-xs truncate"
            style={{ color: 'var(--color-text-secondary)', lineHeight: '18px' }}
          >
            {hasUrl ? displayUrl : tr('preview.waiting')}
          </span>
        </div>

        {hasUrl && (
          <button
            className="btn-ghost w-7 h-7 flex items-center justify-center rounded-md shrink-0"
            style={{ color: 'var(--color-error)' }}
            onClick={() => void handleStop()}
            title={tr('preview.stop')}
          >
            <Square size={12} />
          </button>
        )}

        <button
          className="btn-ghost w-7 h-7 flex items-center justify-center rounded-md shrink-0"
          style={{
            color: hasUrl ? 'var(--color-text-tertiary)' : 'var(--color-border)',
            cursor: hasUrl ? 'pointer' : 'not-allowed'
          }}
          onClick={handleRefresh}
          disabled={!hasUrl}
          title={tr('preview.refresh')}
        >
          <RefreshCw
            size={13}
            style={loading ? { animation: 'preview-spin 0.6s linear infinite' } : undefined}
          />
        </button>

        <button
          className={`btn-ghost flex items-center gap-1 px-2 py-1 rounded-md text-xs shrink-0 ${showLogs ? 'bg-[var(--color-brand-bg)] text-[var(--color-brand)]' : ''}`}
          style={{ color: showLogs ? undefined : 'var(--color-text-secondary)' }}
          onClick={() => setShowLogs((v) => !v)}
          title={tr('preview.terminalLogs')}
        >
          <Terminal size={12} />
          <span>
            {tr('preview.logs')}
            {logs.length > 0 ? ` (${logs.length})` : ''}
          </span>
        </button>
      </div>

      {showLogs && (
        <div
          className="px-3.5 py-2.5 shrink-0 max-h-[180px] overflow-y-auto"
          style={{ background: 'var(--color-bg-code)', borderBottom: '1px solid #333' }}
        >
          {logs.length === 0 ? (
            <div
              className="text-xs leading-5"
              style={{ fontFamily: 'var(--font-mono)', color: '#666' }}
            >
              {tr('preview.noLogs')}
            </div>
          ) : (
            logs.map((line, i) => (
              <div
                key={i}
                className="text-xs leading-5 whitespace-pre"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-code)'
                }}
              >
                {line || '\u00A0'}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'var(--color-bg-elevated, #fff)' }}
          >
            <div
              className="w-6 h-6 rounded-full"
              style={{
                border: '2px solid var(--color-border-light)',
                borderTopColor: 'var(--color-brand)',
                animation: 'preview-spin 0.6s linear infinite'
              }}
            />
          </div>
        )}
        {hasUrl ? (
          <iframe
            key={key}
            src={previewUrl!}
            className="w-full h-full border-none block"
            onLoad={() => setLoading(false)}
            title="preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <div
            className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <Terminal size={30} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {tr('preview.empty')}
            </span>

            <button
              onClick={() => void handleStart()}
              disabled={starting || !cid}
              className="btn-brand btn-press flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {starting ? tr('preview.starting') : tr('preview.start')}
            </button>
            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {tr('preview.startHint')}
            </span>

            {startError && (
              <div
                className="text-[11px] leading-relaxed px-3 py-2 rounded-lg max-w-xs break-words"
                style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
              >
                {tr('preview.startFailed')}：{startError}
              </div>
            )}

            <div className="flex items-center gap-1.5 w-full max-w-xs mt-1">
              <input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleManualGo()
                }}
                placeholder={tr('preview.manualPlaceholder')}
                className="flex-1 text-xs px-2.5 py-1.5 rounded-md outline-none"
                style={{
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-container)',
                  color: 'var(--color-text-primary)'
                }}
              />
              <button
                onClick={handleManualGo}
                className="btn-ghost flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs shrink-0"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                <ArrowRight size={13} />
                {tr('preview.go')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg-spotlight)'
        }}
      >
        <span className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
          {serverStatus === 'online'
            ? 'dev server running'
            : serverStatus === 'offline'
              ? 'dev server stopped'
              : 'dev server idle'}
        </span>
        {hasUrl && (
          <a
            href={previewUrl!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] leading-5 no-underline hover:underline hover:opacity-80"
            style={{ color: 'var(--color-brand)' }}
          >
            <ExternalLink size={11} />
            {tr('preview.openInBrowser')}
          </a>
        )}
      </div>
    </div>
  )
}
