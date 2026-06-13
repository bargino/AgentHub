import { app, screen, BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 780
const SAVE_DEBOUNCE_MS = 500

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

export interface RestoredBounds {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function readState(): WindowState | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8'))
    if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
      return parsed as WindowState
    }
    return null
  } catch {
    return null
  }
}

function writeState(state: WindowState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(state), 'utf-8')
  } catch {
    // 持久化失败不影响窗口运行，静默忽略
  }
}

// 校验恢复位置是否与任一显示器可见工作区有重叠，避免窗口落在已拔掉的副屏外
function isWithinDisplays(state: WindowState): boolean {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapRight = Math.min(state.x! + state.width, area.x + area.width)
    const overlapBottom = Math.min(state.y! + state.height, area.y + area.height)
    const overlapLeft = Math.max(state.x!, area.x)
    const overlapTop = Math.max(state.y!, area.y)
    return overlapRight > overlapLeft && overlapBottom > overlapTop
  })
}

export function getWindowBounds(): RestoredBounds {
  const state = readState()
  if (!state) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, isMaximized: false }
  }
  const width = state.width > 0 ? state.width : DEFAULT_WIDTH
  const height = state.height > 0 ? state.height : DEFAULT_HEIGHT
  const result: RestoredBounds = { width, height, isMaximized: Boolean(state.isMaximized) }
  // 省略 x/y 时 BrowserWindow 会自动居中
  if (isWithinDisplays(state)) {
    result.x = state.x
    result.y = state.y
  }
  return result
}

// 使用 getNormalBounds 取非最大化时的几何尺寸，避免把最大化尺寸写成常态尺寸
function captureState(window: BrowserWindow): WindowState {
  const bounds = window.getNormalBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: window.isMaximized()
  }
}

export function registerWindowStatePersistence(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => writeState(captureState(window)), SAVE_DEBOUNCE_MS)
  }
  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    writeState(captureState(window))
  })
}
