import { PageShell } from './PageShell'
import { PreviewPanel } from '../preview/PreviewPanel'

/** 预览页（对齐 ref05）：浏览器预览 + 开发服务器日志 + 预览环境信息。
 *  均在 PreviewPanel 内（含预览启停）；原 header「上线」为未接线占位按钮，已移除。 */
export function PreviewPage(): React.JSX.Element {
  return (
    <PageShell>
      <div className="h-full overflow-auto">
        <PreviewPanel />
      </div>
    </PageShell>
  )
}
