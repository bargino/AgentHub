import { exec } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { app } from 'electron'

const execAsync = promisify(exec)

/** agenthub-server 目录：打包后在 resources 下，开发期在仓库同级 */
export function resolveServerDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'agenthub-server')
    : join(app.getAppPath(), '..', 'agenthub-server')
}

/**
 * 解析后端 Python 解释器，优先级：
 *   1. AGENTHUB_PYTHON 环境变量（显式覆盖，适配自定义环境名/路径）
 *   2. conda 的 agent 环境（后端依赖 claude_agent_sdk 等的默认安装位置）
 *   3. 回退到 PATH 上的 python3 / python（无 conda 或未配置时兜底，
 *      使用默认环境变量里的解释器，避免直接抛错导致后端起不来）
 */
export async function resolveAgentPython(): Promise<string> {
  const override = process.env.AGENTHUB_PYTHON?.trim()
  if (override) return override

  const condaPython = await resolveCondaAgentPython()
  if (condaPython) return condaPython

  return process.platform === 'win32' ? 'python' : 'python3'
}

/** 探测 conda agent 环境的 python，conda 缺失或解释器不存在时返回 null。 */
async function resolveCondaAgentPython(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('conda info --base')
    const base = stdout.trim()
    if (!base) return null
    const python =
      process.platform === 'win32'
        ? join(base, 'envs', 'agent', 'python.exe')
        : join(base, 'envs', 'agent', 'bin', 'python')
    return existsSync(python) ? python : null
  } catch {
    return null
  }
}
