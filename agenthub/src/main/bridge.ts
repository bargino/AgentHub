import { spawn, type ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { resolveAgentPython, resolveServerDir } from './serverEnv'

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'

export interface BridgeRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

export interface BridgeResponse {
  status: number
  body: unknown
}

export const BRIDGE_EVENT_CHANNEL = 'bridge:event'
export const BRIDGE_STATUS_CHANNEL = 'bridge:status'
export const BRIDGE_ERROR_CHANNEL = 'bridge:error'
/**
 * 单请求超时：Python 端漏回/卡死时避免 renderer 永久 pending。
 * 必须大于后端同步处理单个 bridge 请求的最坏耗时：approve/reject 会串行执行多条 git
 * 命令（commit_changes = add + commit，discard = reset + clean），后端每条 git 自带
 * 30s 上限（见 workspace._run_git），最坏约 60s。原值 30s 与后端单条 git 超时相等，
 * git 稍慢即让前端先于后端误报「请求超时」而后端实际已成功，造成状态不一致。
 * 取 120s 留足余量；workspace 创建、命令执行等更慢操作走后台 orchestrator，不占本通道。
 */
const REQUEST_TIMEOUT_MS = 120_000
const BASE_RESTART_DELAY_MS = 1500
/** 连续崩溃重启上限，超过后停止自愈并透传原因，避免无限崩溃-重启刷屏 */
const MAX_CONSECUTIVE_RESTARTS = 5

let child: ChildProcess | null = null
let status: BridgeStatus = 'disconnected'
let lastError: string | null = null
let stopped = false
let stdoutBuffer = ''
let seq = 0
let restartCount = 0
const pending = new Map<
  string,
  { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** 结构化透传失败原因到渲染层，供 ConnectionBar 显示可操作提示 */
function emitError(reason: string): void {
  lastError = reason
  broadcast(BRIDGE_ERROR_CHANNEL, reason)
}

export function getBridgeError(): string | null {
  return lastError
}

function setStatus(next: BridgeStatus): void {
  if (next === 'connected') lastError = null
  if (status === next) return
  status = next
  broadcast(BRIDGE_STATUS_CHANNEL, status)
}

export function getBridgeStatus(): BridgeStatus {
  return status
}

function handleFrame(frame: {
  kind?: string
  id?: unknown
  event?: unknown
  status?: number
  body?: unknown
}): void {
  switch (frame.kind) {
    case 'ready':
      setStatus('connected')
      break
    case 'event':
      broadcast(BRIDGE_EVENT_CHANNEL, frame.event)
      break
    case 'response': {
      const id = String(frame.id)
      const p = pending.get(id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(id)
        p.resolve({ status: frame.status ?? 0, body: frame.body ?? null })
      } else {
        // 迟到响应：对应请求已超时被清理。记录而非静默丢弃，便于诊断
        // 「前端报超时但后端实际已返回」这类超时层级问题。
        console.warn(`[bridge] 丢弃无匹配 pending 的迟到响应 id=${id} status=${frame.status}`)
      }
      break
    }
    default:
      break
  }
}

function onStdout(chunk: Buffer): void {
  stdoutBuffer += chunk.toString('utf-8')
  let idx: number
  while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
    const line = stdoutBuffer.slice(0, idx).trim()
    stdoutBuffer = stdoutBuffer.slice(idx + 1)
    if (!line) continue
    try {
      handleFrame(JSON.parse(line))
    } catch {
      console.error('[bridge] 无法解析帧:', line)
    }
  }
}

function rejectAllPending(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

export async function startBridge(): Promise<void> {
  stopped = false
  if (child) return
  setStatus('connecting')

  const serverDir = resolveServerDir()
  let python: string
  try {
    python = await resolveAgentPython()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[bridge] 解析 python 失败:', err)
    emitError(
      `无法定位后端 Python 运行环境（${detail}）。请设置 AGENTHUB_PYTHON 指向 python 可执行文件，或用 AGENTHUB_CONDA_ENV 指定 conda 环境名，或在已激活目标环境的终端中启动。`
    )
    setStatus('disconnected')
    return
  }

  console.log(`[bridge] spawning python -m app.bridge in ${serverDir} with ${python}`)
  const proc = spawn(python, ['-m', 'app.bridge'], {
    cwd: serverDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child = proc
  stdoutBuffer = ''

  proc.stdout?.on('data', onStdout)
  proc.stderr?.on('data', (c: Buffer) => console.error(`[bridge] ${c.toString().trimEnd()}`))
  proc.on('error', (err) => {
    console.error(`[bridge] 启动失败: ${err.message}`)
    emitError(`后端进程启动失败：${err.message}`)
  })
  proc.on('exit', (code, signal) => {
    console.log(`[bridge] exited (code=${code}, signal=${signal})`)
    if (child === proc) child = null
    setStatus('disconnected')
    rejectAllPending('bridge process exited')
    if (stopped) return
    // 崩溃自愈：限制连续重启次数 + 退避，避免「崩溃→重启→崩溃」无限循环刷屏
    restartCount += 1
    if (restartCount > MAX_CONSECUTIVE_RESTARTS) {
      emitError(
        `后端进程连续异常退出 ${MAX_CONSECUTIVE_RESTARTS} 次（最后 code=${code}），已停止自动重启。请检查日志后手动重启引擎。`
      )
      return
    }
    const delay = BASE_RESTART_DELAY_MS * restartCount
    setTimeout(() => void startBridge(), delay)
  })
}

export function stopBridge(): void {
  stopped = true
  const proc = child
  child = null
  setStatus('disconnected')
  rejectAllPending('bridge stopped')
  if (proc) proc.kill()
}

export async function restartBridge(): Promise<void> {
  stopBridge()
  // 手动重启重置崩溃计数与上次错误，重新进入自愈逻辑
  restartCount = 0
  lastError = null
  await new Promise((r) => setTimeout(r, 200))
  await startBridge()
}

// 等待子进程就绪（conda 解析 + spawn 有几百毫秒延迟）。启动期写入的帧会被
// 管道缓冲，桥就绪后即按序处理，因此只需等到 stdin 可写即可。
async function ensureChild(timeoutMs = 10000): Promise<ChildProcess> {
  const start = Date.now()
  while (!child || !child.stdin?.writable) {
    if (stopped) throw new Error('AgentHub bridge 已停止')
    if (Date.now() - start > timeoutMs) throw new Error('AgentHub bridge 未就绪')
    await new Promise((r) => setTimeout(r, 100))
  }
  return child
}

async function send(frame: Record<string, unknown>): Promise<BridgeResponse> {
  const proc = await ensureChild()
  const id = String(++seq)
  return new Promise<BridgeResponse>((resolve, reject) => {
    // 单请求超时：Python 端漏回 response 时不再永久 pending（上层可提示并重试）
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`AgentHub 请求超时（${REQUEST_TIMEOUT_MS / 1000}s 未响应）`))
    }, REQUEST_TIMEOUT_MS)
    timer.unref?.()
    pending.set(id, { resolve, reject, timer })
    proc.stdin!.write(`${JSON.stringify({ id, ...frame })}\n`, (err) => {
      if (err) {
        clearTimeout(timer)
        pending.delete(id)
        reject(err)
      }
    })
  })
}

export function bridgeRequest(req: BridgeRequest): Promise<BridgeResponse> {
  return send({ kind: 'request', method: req.method, path: req.path, body: req.body ?? null })
}

export function bridgeSendMessage(payload: unknown): Promise<BridgeResponse> {
  return send({ kind: 'send_message', payload })
}
