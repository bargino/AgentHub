import { useCallback, useRef } from 'react'
import {
  MIN_PANEL_W,
  MAX_PANEL_W,
  currentPanelWidth,
  setPanelWidth,
  savePanelWidth
} from './panelWidth'

/** 右侧面板左缘拖拽手柄：调宽 min 320 / max 560，宽度持久化。
 *  宿主面板根元素需要 position: relative。 */
export function ResizeHandle(): React.JSX.Element {
  const dragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = currentPanelWidth()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      if (!dragging.current) return
      const w = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, startW + (startX - ev.clientX)))
      setPanelWidth(w)
    }
    const onUp = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      savePanelWidth()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div
      onMouseDown={onMouseDown}
      title="拖拽调整面板宽度"
      className="absolute left-0 top-0 bottom-0 z-10"
      style={{ width: 5, cursor: 'col-resize' }}
    >
      <div className="resize-handle-line absolute left-0 top-0 bottom-0" style={{ width: 2 }} />
    </div>
  )
}
