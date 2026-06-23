import { PageShell } from './PageShell'
import { ReviewCenter } from '../diff/ReviewCenter'

/** Diff 页（对齐 ref04）：变更元信息 + 接受/拒绝/要求修改 + 文件树 + 双栏差异。
 *  以上均在 ReviewCenter 内；原 header 刷新为未接线占位按钮，已移除。 */
export function DiffPage(): React.JSX.Element {
  return (
    <PageShell>
      <div className="h-full overflow-auto">
        <ReviewCenter />
      </div>
    </PageShell>
  )
}
