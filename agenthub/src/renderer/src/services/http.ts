// 所有 REST 调用改走主进程 stdio 桥（window.bridge.request），不再发起网络 fetch。
// 路径与方法保持与原 FastAPI 路由一致，由桥进程内 ASGI 派发。
import { t } from '../i18n'

const API_PREFIX = '/api/v1'

export class HttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (!window.bridge) {
    throw new HttpError(0, t('errors.bridgeUnavailable'))
  }
  const res = await window.bridge.request({ method, path: `${API_PREFIX}${path}`, body })
  if (res.status < 200 || res.status >= 300) {
    const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
    throw new HttpError(res.status, text)
  }
  return res.body as T
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

export function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}

export function deleteJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('DELETE', path, body)
}
