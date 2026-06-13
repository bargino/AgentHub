import { useState } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  useHover,
  useDismiss,
  useInteractions,
  FloatingPortal,
  type Placement
} from '@floating-ui/react'

interface TooltipProps {
  content: React.ReactNode
  placement?: Placement
  delay?: number
  children: React.ReactElement
}

export function Tooltip({
  content,
  placement = 'top',
  delay = 400,
  children
}: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })]
  })

  const hover = useHover(context, { delay: { open: delay, close: 0 } })
  const dismiss = useDismiss(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss])

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            // floating-ui 的 setFloating 是 callback ref setter（非读取 .current），规则误报
            // eslint-disable-next-line react-hooks/refs
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 9999,
              padding: '4px 8px',
              fontSize: 'var(--font-size-sm)',
              lineHeight: '20px',
              color: 'var(--tooltip-text)',
              background: 'var(--tooltip-bg)',
              border: '1px solid var(--tooltip-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              maxWidth: 240,
              wordBreak: 'break-word',
              pointerEvents: 'none'
            }}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
