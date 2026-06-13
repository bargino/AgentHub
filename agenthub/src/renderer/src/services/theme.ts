/** 主题与字号偏好：localStorage 持久化 + documentElement 实时应用。
 *  暗色通过 [data-theme="dark"] 切换 CSS 变量；字号同时缩放 Tailwind rem 基准与 px token。 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type FontSizePreference = 'small' | 'default' | 'large'

const THEME_KEY = 'agenthub.theme'
const FONT_KEY = 'agenthub.fontSize'

const FONT_SCALE: Record<FontSizePreference, number> = {
  small: 12 / 14,
  default: 1,
  large: 16 / 14
}

// 基准 px token（main.css :root 默认值），按字号偏好等比缩放
const FONT_TOKENS: Record<string, number> = {
  '--font-size-xs': 11,
  '--font-size-sm': 12,
  '--font-size-base': 14,
  '--font-size-lg': 16,
  '--font-size-xl': 18,
  '--font-size-2xl': 20
}

let systemMedia: MediaQueryList | null = null

function applyTheme(pref: ThemePreference): void {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  // Windows 标题栏 overlay 配色联动（其余平台 main 进程 no-op）
  window.api?.titlebar?.setTheme(dark)
}

function applyFontSize(pref: FontSizePreference): void {
  const scale = FONT_SCALE[pref]
  const root = document.documentElement
  root.style.fontSize = `${16 * scale}px`
  for (const [token, base] of Object.entries(FONT_TOKENS)) {
    root.style.setProperty(token, `${Math.round(base * scale)}px`)
  }
}

export function getThemePreference(): ThemePreference {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'dark' || v === 'system' || v === 'light' ? v : 'light'
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(THEME_KEY, pref)
  applyTheme(pref)
}

export function getFontSizePreference(): FontSizePreference {
  const v = localStorage.getItem(FONT_KEY)
  return v === 'small' || v === 'large' || v === 'default' ? v : 'default'
}

export function setFontSizePreference(pref: FontSizePreference): void {
  localStorage.setItem(FONT_KEY, pref)
  applyFontSize(pref)
}

/** 应用启动时调用：恢复持久化偏好并监听系统主题变化 */
export function initTheme(): void {
  applyTheme(getThemePreference())
  applyFontSize(getFontSizePreference())
  systemMedia = window.matchMedia('(prefers-color-scheme: dark)')
  systemMedia.addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system')
  })
}
