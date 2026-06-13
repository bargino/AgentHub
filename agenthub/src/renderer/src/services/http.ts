const DEFAULT_BASE_URL = 'http://127.0.0.1:8642'
const API_PREFIX = '/api/v1'

// baseUrl 末尾斜杠会导致拼接出双斜杠，统一去除
export function getServerBaseUrl(): string {
  const stored = localStorage.getItem('agenthub.serverUrl')
  return (stored ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

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

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const url = `${getServerBaseUrl()}${API_PREFIX}${path}`
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })

  const text = await res.text()
  if (!res.ok) throw new HttpError(res.status, text)

  // 后端对部分写操作可能返回空响应体
  return (text ? JSON.parse(text) : undefined) as T
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}
