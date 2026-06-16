import { useEffect, useRef } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useT } from '../../i18n'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * 无样式的模态行为层：遮罩 + Esc 关闭 + 点击遮罩关闭 + Tab 焦点陷阱 + 关闭后恢复焦点。
 * 自带版式的弹窗用下方的 `Modal`；布局特殊（如带页签/自定义尺寸）的弹窗可直接用本组件包裹自己的面板。
 * （见架构评审 E1）
 */
export function ModalOverlay({
  onClose,
  closeOnOverlay = true,
  zIndex = 100,
  children
}: {
  onClose: () => void
  /** 点击遮罩是否关闭（含破坏性表单的弹窗可关掉以防误触） */
  closeOnOverlay?: boolean
  zIndex?: number
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    const root = ref.current
    // 进入时把焦点移到弹窗内首个可聚焦元素
    const first = root?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? root)?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab' && root) {
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) return
        const firstEl = items[0]
        const lastEl = items[items.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && (active === firstEl || !root.contains(active))) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      restoreTo?.focus?.()
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)'
      }}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      {children}
    </div>
  )
}

/**
 * 统一的模态容器（标题栏 + 内容 + 可选底部操作区），基于 `ModalOverlay`。
 */
export function Modal({
  title,
  onClose,
  onBack,
  children,
  footer,
  width = 440,
  closeOnOverlay = true,
  zIndex
}: {
  title: string
  onClose: () => void
  /** 多步表单返回上一步；提供时标题栏左侧显示返回箭头 */
  onBack?: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  closeOnOverlay?: boolean
  zIndex?: number
}): React.JSX.Element {
  const tr = useT()
  return (
    <ModalOverlay onClose={onClose} closeOnOverlay={closeOnOverlay} zIndex={zIndex}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="rounded-xl overflow-hidden animate-menu-pop outline-none"
        style={{ width, boxShadow: 'var(--shadow-float)', background: 'var(--color-bg-container)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border-light)' }}
        >
          {onBack ? (
            <button
              onClick={onBack}
              aria-label={tr('common.back')}
              className="btn-ghost flex items-center justify-center w-7 h-7 rounded-md cursor-pointer"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-secondary)'
              }}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <span
            className="flex-1 text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label={tr('common.close')}
            className="flex items-center justify-center w-7 h-7 rounded-md cursor-pointer"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)'
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">{children}</div>
        {footer ? (
          <div
            className="flex gap-3 px-5 pt-3 pb-4"
            style={{ borderTop: '1px solid var(--color-border-light)' }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </ModalOverlay>
  )
}
