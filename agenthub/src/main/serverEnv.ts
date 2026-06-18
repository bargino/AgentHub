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
 *   1. AGENTHUB_PYTHON：显式指定解释器完整路径（最高优先，适配任意环境/路径）
 *   2. AGENTHUB_CONDA_ENV：显式指定 conda 环境名，定位 <base>/envs/<name> 下的 python
 *   3. 回退到 PATH 上的 python3 / python（从已激活 conda 环境的终端启动时，
 *      PATH 上的 python 即该环境解释器，因此无需额外配置即可命中）
 *
 * 不内置任何特定环境名（如 agent）：本机使用某个 conda 环境时，通过
 * AGENTHUB_CONDA_ENV 指定，或先 `conda activate <env>` 再启动；避免在他人
 * 机器上假设一个并不存在的环境名。
 */
export async function resolveAgentPython(): Promise<string> {
  const override = process.env.AGENTHUB_PYTHON?.trim()
  if (override) return override

  const envName = process.env.AGENTHUB_CONDA_ENV?.trim()
  if (envName) {
    const condaPython = await resolveCondaEnvPython(envName)
    if (condaPython) return condaPython
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

/** 探测指定 conda 环境名对应的 python，conda 缺失或解释器不存在时返回 null。 */
async function resolveCondaEnvPython(envName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('conda info --base')
    const base = stdout.trim()
    if (!base) return null
    const python =
      process.platform === 'win32'
        ? join(base, 'envs', envName, 'python.exe')
        : join(base, 'envs', envName, 'bin', 'python')
    return existsSync(python) ? python : null
  } catch {
    return null
  }
}
