/** 会话头右侧的页面专属操作按钮（如 刷新 / 导出 DAG / 上线部署）。 */
export function HeaderActionButton({
  icon,
  label,
  variant = 'default',
  onClick,
  disabled
}: {
  icon?: React.ReactNode
  label: string
  variant?: 'default' | 'brand'
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  const brand = variant === 'brand'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={
        brand
          ? { background: 'var(--gradient-brand)', color: '#fff' }
          : {
              background: 'var(--color-bg-container)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)'
            }
      }
    >
      {icon}
      {label}
    </button>
  )
}
