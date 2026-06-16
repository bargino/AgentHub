import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** 读取本项目的 [data-theme] 主题（替代 shadcn 默认的 next-themes 依赖） */
function useDocumentTheme(): 'light' | 'dark' {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )
  React.useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => {
      setTheme(el.dataset.theme === 'dark' ? 'dark' : 'light')
    })
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  const theme = useDocumentTheme()
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
