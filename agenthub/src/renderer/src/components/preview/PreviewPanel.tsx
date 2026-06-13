import { X, RefreshCw, ExternalLink, Terminal } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store'
import { StatusDot } from '../ui/StatusDot'
import { wsClient, type WsServerFrame } from '../../services/websocket'

type ServerStatus = 'online' | 'idle' | 'offline'

export function PreviewPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.previewPanelOpen)
  const previewUrl = useAppStore((s) => s.previewUrl)
  const [loading, setLoading] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [key, setKey] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [wsStatus, setWsStatus] = useState<ServerStatus>('idle')
  const logEndRef = useRef<HTMLDivElement>(null)
  // 派生：有 previewUrl 且未收到 failed 事件即视为在线（替代 effect 内同步 setState）
  const serverStatus: ServerStatus = previewUrl && wsStatus !== 'offline' ? 'online' : wsStatus

  useEffect(() => {
    const handler = (frame: WsServerFrame): void => {
      if (frame.type === 'preview.started') {
        setWsStatus('online')
        setLogs((prev) => [
          ...prev,
          `[preview] server started: ${(frame.data as { previewUrl?: string }).previewUrl ?? ''}`
        ])
      } else if (frame.type === 'preview.failed') {
        setWsStatus('offline')
        const d = frame.data as { error?: string }
        setLogs((prev) => [...prev, `[preview] failed: ${d.error ?? 'unknown error'}`])
      }
    }
    wsClient.onEvent(handler)
    return () => wsClient.offEvent(handler)
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  if (!open) return null

  const displayUrl = previewUrl ?? ''
  const hasUrl = !!previewUrl

  const handleRefresh = (): void => {
    if (!hasUrl) return
    setLoading(true)
    setKey((k) => k + 1)
    setLogs((prev) => [...prev, `[preview] refreshing iframe...`])
  }

  return (
    <div
      className="flex flex-col h-full shrink-0"
      style={{
        width: 520,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-bg-elevated, #fff)'
      }}
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
            {hasUrl ? displayUrl : '等待 Preview 服务启动...'}
          </span>
        </div>

        <button
          className="btn-ghost w-7 h-7 flex items-center justify-center rounded-md shrink-0"
          style={{
            color: hasUrl ? 'var(--color-text-tertiary)' : 'var(--color-border)',
            cursor: hasUrl ? 'pointer' : 'not-allowed'
          }}
          onClick={handleRefresh}
          disabled={!hasUrl}
          title="刷新"
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
          title="终端日志"
        >
          <Terminal size={12} />
          <span>日志{logs.length > 0 ? ` (${logs.length})` : ''}</span>
        </button>

        <button
          className="btn-ghost w-7 h-7 flex items-center justify-center rounded-md shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
          onClick={() => useAppStore.getState().togglePreviewPanel()}
          title="关闭"
        >
          <X size={14} />
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
              暂无日志
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
            className="flex flex-col items-center justify-center h-full gap-2"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <Terminal size={32} />
            <span className="text-sm">发送消息给 @preview 启动预览服务</span>
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
            在浏览器中打开
          </a>
        )}
      </div>
    </div>
  )
}
