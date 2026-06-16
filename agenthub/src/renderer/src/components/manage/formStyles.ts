import type * as React from 'react'

// 管理中心编辑器共用的表单输入样式（从 MasterDetail 抽出，避免组件文件混出非组件导出）
export const fieldInputClass =
  'w-full px-3 py-2 text-sm rounded-lg outline-none border transition-all duration-150'

export const fieldInputStyle: React.CSSProperties = {
  background: 'var(--color-bg-spotlight)',
  borderColor: 'var(--color-border-light)',
  color: 'var(--color-text-primary)'
}
