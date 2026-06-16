// 进程内桥客户端：对外保持与原 WebSocket 客户端完全一致的接口，
// 内部改走主进程 stdio 桥（window.bridge），不再有 socket / 重连 / 心跳。
// store、PreviewPanel、SettingsPage、App 等调用方无需改动。

import { t } from '../i18n'

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

export interface WsServerFrame {
  type: string
  conversationId?: string
  data: unknown
}

type EventHandler = (frame: WsServerFrame) => void
type StatusHandler = (status: WsStatus) => void
type ErrorHandler = (reason: string) => void

/** sendMessage 结果：受理成功 / 桥未连接 / 后端非 2xx（带错误文案） */
export type SendResult = { ok: true } | { ok: false; reason: string }

/** 多模态附件（与后端 AttachmentIn 对齐）：url 为 base64 data URL */
export interface MsgAttachment {
  type: 'image'
  url: string
  filename?: string
}

class BridgeClient {
  private status: WsStatus = 'disconnected'
  private readonly eventHandlers = new Set<EventHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private readonly errorHandlers = new Set<ErrorHandler>()
  private disposers: Array<() => void> = []

  connect(): void {
    if (this.disposers.length > 0) return // 已接线（桥连接由主进程托管，无需重复订阅）
    const b = window.bridge
    if (!b) {
      this.setStatus('disconnected')
      return
    }
    this.disposers.push(
      b.onEvent((frame) => {
        const normalized: WsServerFrame = {
          type: frame.type,
          conversationId: frame.conversationId,
          data: frame.data ?? {}
        }
        this.eventHandlers.forEach((h) => h(normalized))
      })
    )
    this.disposers.push(b.onStatus((s) => this.setStatus(s)))
    this.disposers.push(b.onError((reason) => this.errorHandlers.forEach((h) => h(reason))))
    void b.getStatus().then((s) => this.setStatus(s))
  }

  disconnect(): void {
    this.disposers.forEach((d) => d())
    this.disposers = []
    this.setStatus('disconnected')
  }

  // 桥模式下只有单一消费者，订阅是隐式的（事件按 conversationId 在 store 内过滤），
  // 保留以下空实现仅为兼容原 WebSocket 客户端的调用方
  subscribe(conversationId: string): void {
    void conversationId // no-op：桥不需要按会话订阅
  }

  unsubscribe(conversationId: string): void {
    void conversationId // no-op：桥不需要按会话退订
  }

  // 等待桥响应并校验后端 status：非 2xx 不再被静默吞掉，错误回灌给上层提示/重发
  async sendMessage(
    conversationId: string,
    content: string,
    targetAgent?: string,
    attachments?: MsgAttachment[]
  ): Promise<SendResult> {
    const b = window.bridge
    if (!b || this.status !== 'connected') {
      return { ok: false, reason: t('errors.engineNotReady') }
    }
    try {
      const res = await b.sendMessage({
        conversationId,
        content,
        ...(targetAgent ? { targetAgent } : {}),
        ...(attachments && attachments.length ? { attachments } : {})
      })
      if (res.status < 200 || res.status >= 300) {
        const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
        return { ok: false, reason: t('errors.sendFailed', { status: res.status, text }) }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : t('errors.sendRetry') }
    }
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

  onError(handler: ErrorHandler): void {
    this.errorHandlers.add(handler)
  }

  offError(handler: ErrorHandler): void {
    this.errorHandlers.delete(handler)
  }

  getStatus(): WsStatus {
    return this.status
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return
    this.status = status
    this.statusHandlers.forEach((h) => h(status))
  }
}

export const wsClient = new BridgeClient()
