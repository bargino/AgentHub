/** 轻量国际化：localStorage 持久化 + useSyncExternalStore 驱动语言切换重渲染。
 *  无第三方依赖；资源按命名空间组织在 zh-CN.ts / en.ts，缺失键回退到中文，再回退到 key 本身。 */
import { useSyncExternalStore } from 'react'
import { zhCN } from './zh-CN'
import { en } from './en'

export type Lang = 'zh-CN' | 'en'

export interface LangOption {
  value: Lang
  label: string
}

export const LANGS: LangOption[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' }
]

export type Dict = { [k: string]: string | Dict }

const LANG_KEY = 'agenthub.lang'
const DEFAULT_LANG: Lang = 'zh-CN'

const resources: Record<Lang, Dict> = { 'zh-CN': zhCN, en }

function readInitial(): Lang {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'zh-CN' ? v : DEFAULT_LANG
}

let current: Lang = readInitial()
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  localStorage.setItem(LANG_KEY, lang)
  document.documentElement.lang = lang
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const tpl = lookup(resources[lang], key) ?? lookup(resources[DEFAULT_LANG], key) ?? key
  return interpolate(tpl, vars)
}

/** 非组件环境（store / service）直接取译文，按当前语言解析 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(current, key, vars)
}

/** 组件内使用：语言切换时自动重渲染 */
export function useT(): TFunc {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  return (key, vars) => translate(lang, key, vars)
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

/** 应用启动时调用：把 <html lang> 同步为持久化语言 */
export function initI18n(): void {
  document.documentElement.lang = current
}
