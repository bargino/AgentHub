import { exec, spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'
import { app } from 'electron'

const execAsync = promisify(exec)

const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8642
const HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/api/v1/health`
const HEALTH_TIMEOUT_MS = 2000
const SPAWN_POLL_INTERVAL_MS = 500
const SPAWN_POLL_MAX_ATTEMPTS = 20

export interface BackendHealth {
  ok: boolean
  status?: string
}

export type EnsureBackendResult = 'already-running' | 'spawned' | 'failed'

let backendProcess: ChildProcess | null = null
// stopBackend() 杀掉的进程尚未真正退出时，旧实例仍可能短暂响应健康检查，
// 重启场景下需先等它退出，否则 ensureBackend 会误判为 already-running
let backendExit: Promise<void> | null = null

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function checkBackendHealth(
  timeoutMs: number = HEALTH_TIMEOUT_MS
): Promise<BackendHealth> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      return { ok: false, status: `http ${res.status}` }
    }
    const body = (await res.json().catch(() => null)) as { status?: string } | null
    return { ok: true, status: typeof body?.status === 'string' ? body.status : 'ok' }
  } catch {
    return { ok: false, status: 'unreachable' }
  }
}

function resolveServerDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'agenthub-server')
    : join(app.getAppPath(), '..', 'agenthub-server')
}

// 后端依赖（claude_agent_sdk 等）安装在 conda 的 agent 环境，
// 裸 'python' 会命中 PATH 上的 base 环境导致 adapter 加载失败
async function resolveAgentPython(): Promise<string> {
  const { stdout } = await execAsync('conda info --base')
  const base = stdout.trim()
  return process.platform === 'win32'
    ? join(base, 'envs', 'agent', 'python.exe')
    : join(base, 'envs', 'agent', 'bin', 'python')
}

export async function ensureBackend(): Promise<EnsureBackendResult> {
  if (backendExit) {
    await backendExit
    backendExit = null
  }

  if ((await checkBackendHealth()).ok) {
    return 'already-running'
  }

  const serverDir = resolveServerDir()
  const python = await resolveAgentPython()
  console.log(`[backend] spawning uvicorn in ${serverDir} with ${python}`)

  const proc = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', BACKEND_HOST, '--port', String(BACKEND_PORT)],
    { cwd: serverDir, stdio: 'pipe', windowsHide: true }
  )
  backendProcess = proc

  proc.stdout?.on('data', (chunk: Buffer) => {
    console.log(`[backend] ${chunk.toString().trimEnd()}`)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    console.error(`[backend] ${chunk.toString().trimEnd()}`)
  })
  proc.on('error', (err) => {
    console.error(`[backend] failed to start: ${err.message}`)
    if (backendProcess === proc) {
      backendProcess = null
    }
  })
  proc.on('exit', (code, signal) => {
    console.log(`[backend] process exited (code=${code}, signal=${signal})`)
    if (backendProcess === proc) {
      backendProcess = null
    }
  })

  for (let attempt = 0; attempt < SPAWN_POLL_MAX_ATTEMPTS; attempt++) {
    await delay(SPAWN_POLL_INTERVAL_MS)
    if ((await checkBackendHealth()).ok) {
      return 'spawned'
    }
    if (backendProcess !== proc) {
      return 'failed'
    }
  }

  return 'failed'
}

export function stopBackend(): void {
  const proc = backendProcess
  if (!proc) {
    return
  }
  backendProcess = null
  backendExit = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000)
    timer.unref()
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  proc.kill()
}
