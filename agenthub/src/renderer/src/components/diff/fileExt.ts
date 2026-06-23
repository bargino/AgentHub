/** 文件扩展名 -> 类型色（大厂 IDE 惯例配色）。
 *  diff 文件树与聊天内代码修改卡共用同一份，保证文件图标配色同源。 */
export const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#e8a33d',
  jsx: '#e8a33d',
  css: '#9d6fe0',
  scss: '#9d6fe0',
  json: '#f59e0b',
  py: '#3572a5',
  html: '#e34c26',
  md: '#6b7280',
  yaml: '#cb4b16',
  yml: '#cb4b16'
}

export function extColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? 'var(--color-text-tertiary)'
}
