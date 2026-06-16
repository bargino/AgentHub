import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@renderer/lib/utils'

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function TooltipRoot(
  props: React.ComponentProps<typeof TooltipPrimitive.Root>
): React.JSX.Element {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>
): React.JSX.Element {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-2.5 py-1 text-xs text-balance shadow-md',
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left'

export interface TooltipProps {
  content: React.ReactNode
  placement?: TooltipPlacement
  children: React.ReactNode
  delayDuration?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  contentClassName?: string
}

/**
 * 兼容旧 API 的便捷 Tooltip：`<Tooltip content="…" placement="right">{trigger}</Tooltip>`
 * 底层换成 Radix（无障碍 + 键盘可达）。高级用法可直接用下方导出的
 * TooltipTrigger / TooltipContent / TooltipProvider 组合。
 */
export function Tooltip({
  content,
  placement = 'top',
  children,
  delayDuration,
  open,
  defaultOpen,
  onOpenChange,
  contentClassName
}: TooltipProps): React.JSX.Element {
  return (
    <TooltipProvider {...(delayDuration !== undefined ? { delayDuration } : {})}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...(open !== undefined ? { open } : {})}
        {...(defaultOpen !== undefined ? { defaultOpen } : {})}
        {...(onOpenChange ? { onOpenChange } : {})}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={placement} className={contentClassName}>
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

export { TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider }
