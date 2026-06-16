import * as React from 'react'
import { useT } from '../../i18n'

export interface ResizeHandleProps {
  /** 受控的 CSS 变量名，如 '--conv-list-width' */
  cssVar: string
  /** 最小/最大像素宽度 */
  min: number
  max: number
  /** true：向左拖增大宽度（分隔条位于右侧面板左缘）；false：向右拖增大（位于左列右缘） */
  invert?: boolean
  /** localStorage 持久化 key */
  storageKey: string
  /** 双击恢复的默认宽度（像素） */
  defaultWidth?: number
}

/** 可拖拽的竖向分隔条：拖动改写指定 CSS 变量并持久化；用 Pointer Capture 保证拖拽可靠；无第三方依赖。 */
export function ResizeHandle({
  cssVar,
  min,
  max,
  invert = false,
  storageKey,
  defaultWidth
}: ResizeHandleProps): React.JSX.Element {
  const tr = useT()
  const ref = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ startX: number; startW: number } | null>(null)
  const [active, setActive] = React.useState(false)

  const readVar = (): number => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar))
    return Number.isFinite(v) ? v : min
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    drag.current = { startX: e.clientX, startW: readVar() }
    ref.current?.setPointerCapture(e.pointerId)
    setActive(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const raw = invert ? drag.current.startX - e.clientX : e.clientX - drag.current.startX
    const w = Math.min(max, Math.max(min, drag.current.startW + raw))
    document.documentElement.style.setProperty(cssVar, `${w}px`)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    try {
      ref.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setActive(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try {
      localStorage.setItem(
        storageKey,
        getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
      )
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }

  const onDoubleClick = (): void => {
    if (defaultWidth == null) return
    document.documentElement.style.setProperty(cssVar, `${defaultWidth}px`)
    try {
      localStorage.setItem(storageKey, `${defaultWidth}px`)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      title={tr('resize.hint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      className="group relative shrink-0 self-stretch"
      style={
        {
          width: 8,
          cursor: 'col-resize',
          touchAction: 'none',
          zIndex: 30,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties
      }
    >
      {/* 常驻细线（弱），hover/拖拽时变品牌色加粗 */}
      <span
        className="absolute inset-y-0 left-1/2 -translate-x-1/2"
        style={{
          width: active ? 3 : 1,
          background: active ? 'var(--color-brand)' : 'var(--color-border)',
          transition: 'background var(--transition-fast), width var(--transition-fast)'
        }}
      />
      <span
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100"
        style={{
          width: 3,
          background: 'var(--color-brand)',
          transition: 'opacity var(--transition-fast)'
        }}
      />
    </div>
  )
}
