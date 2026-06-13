const STORAGE_KEY = 'agenthub.rightPanelWidth'
export const MIN_PANEL_W = 320
export const MAX_PANEL_W = 560
const DEFAULT_PANEL_W = 380

export function currentPanelWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width')
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? DEFAULT_PANEL_W : n
}

export function setPanelWidth(w: number): void {
  document.documentElement.style.setProperty('--right-panel-width', `${w}px`)
}

export function savePanelWidth(): void {
  localStorage.setItem(STORAGE_KEY, String(currentPanelWidth()))
}

/** 应用启动时恢复持久化的右侧面板宽度（main.tsx 调用） */
export function initPanelWidth(): void {
  const saved = Number(localStorage.getItem(STORAGE_KEY))
  if (saved >= MIN_PANEL_W && saved <= MAX_PANEL_W) {
    setPanelWidth(saved)
  }
}
