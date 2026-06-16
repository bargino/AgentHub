import { toast } from 'sonner'

/** 与 SettingsPage 的通知开关共用同一存储键 */
export const NOTIFY_STORAGE_KEY = 'agenthub.notify'
export type NotifyKey = 'taskDone' | 'approval' | 'error'

function isEnabled(key: NotifyKey): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_STORAGE_KEY)
    if (!raw) return true
    const states = JSON.parse(raw) as Record<string, boolean>
    return states[key] ?? true
  } catch {
    return true
  }
}

/** 应用内全局 toast 出口（不受事件开关约束，用于直接操作的成功/失败反馈） */
export const notify = {
  success(message: string, description?: string): void {
    toast.success(message, description ? { description } : undefined)
  },
  error(message: string, description?: string): void {
    toast.error(message, description ? { description } : undefined)
  },
  info(message: string, description?: string): void {
    toast(message, description ? { description } : undefined)
  }
}

let permissionRequested = false

/** 首次（且仅一次）请求桌面通知权限；用户在设置里开启通知时也会触发 */
export function ensureDesktopPermission(): void {
  if (permissionRequested) return
  permissionRequested = true
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {})
  }
}

function desktopNotify(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body })
  } catch {
    /* 某些平台/上下文不支持时忽略 */
  }
}

/**
 * 事件型通知：受对应开关约束。始终弹应用内 toast；窗口失焦时再补一条桌面
 * 通知，避免用户切走窗口错过待审批等关键节点。
 */
export function notifyEvent(
  key: NotifyKey,
  title: string,
  body: string,
  level: 'info' | 'success' | 'error' = 'info'
): void {
  if (!isEnabled(key)) return
  notify[level](title, body)
  if (typeof document !== 'undefined' && !document.hasFocus()) {
    desktopNotify(title, body)
  }
}
