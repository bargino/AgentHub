import { getServerBaseUrl } from './http'

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

export interface WsServerFrame {
  type: string
  conversationId?: string
  data: unknown
}

type EventHandler = (frame: WsServerFrame) => void
type StatusHandler = (status: WsStatus) => void

const WS_PATH = '/ws/session'
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

function deriveWsUrl(): string {
  const base = getServerBaseUrl().replace(/^http/, 'ws')
  return `${base}${WS_PATH}`
}

class WebSocketClient {
  private ws: WebSocket | null = null
  private status: WsStatus = 'disconnected'
  /** 已订阅会话集合：保持多会话订阅以接收未读/状态更新，重连时全部恢复 */
  private readonly subscriptions = new Set<string>()
  private reconnectDelay = RECONNECT_BASE_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private manualClose = false
  private readonly eventHandlers = new Set<EventHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    this.manualClose = false
    this.setStatus('connecting')

    const ws = new WebSocket(deriveWsUrl())
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS
      this.setStatus('connected')
      // 重连成功后恢复全部订阅
      this.subscriptions.forEach((conversationId) => {
        this.rawSend({ action: 'subscribe', payload: { conversationId } })
      })
    }

    ws.onmessage = (e) => {
      let frame: WsServerFrame
      try {
        frame = JSON.parse(e.data as string)
      } catch {
        return
      }
      if (frame.type === 'ping') {
        this.rawSend({ action: 'pong' })
        return
      }
      this.eventHandlers.forEach((h) => h(frame))
    }

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.setStatus('disconnected')
      if (!this.manualClose) this.scheduleReconnect()
    }

    ws.onerror = () => {
      // 错误后浏览器会随即触发 onclose，由 onclose 统一处理重连
    }
  }

  disconnect(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  subscribe(conversationId: string): void {
    // 记录订阅；未连接时由 onopen 重发，连接中则立即发送
    this.subscriptions.add(conversationId)
    this.rawSend({ action: 'subscribe', payload: { conversationId } })
  }

  unsubscribe(conversationId: string): void {
    this.subscriptions.delete(conversationId)
    this.rawSend({ action: 'unsubscribe', payload: { conversationId } })
  }

  sendMessage(conversationId: string, content: string, targetAgent?: string): boolean {
    return this.rawSend({
      action: 'send_message',
      payload: { conversationId, content, targetAgent }
    })
  }

  onEvent(handler: EventHandler): void {
    this.eventHandlers.add(handler)
  }

  offEvent(handler: EventHandler): void {
    this.eventHandlers.delete(handler)
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandlers.add(handler)
  }

  offStatusChange(handler: StatusHandler): void {
    this.statusHandlers.delete(handler)
  }

  getStatus(): WsStatus {
    return this.status
  }

  private rawSend(payload: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(payload))
    return true
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.reconnectDelay
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      this.connect()
    }, delay)
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return
    this.status = status
    this.statusHandlers.forEach((h) => h(status))
  }
}

export const wsClient = new WebSocketClient()
