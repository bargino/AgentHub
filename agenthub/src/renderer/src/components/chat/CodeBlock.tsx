import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'

/** shiki 按需懒加载（首个代码块出现时才拉取，避免拖慢启动） */
let shikiPromise: Promise<typeof import('shiki')> | null = null
function loadShiki(): Promise<typeof import('shiki')> {
  if (!shikiPromise) shikiPromise = import('shiki')
  return shikiPromise
}

function extract(children: ReactNode): { code: string; lang: string } {
  const el = children as ReactElement<{ className?: string; children?: ReactNode }> | undefined
  const cls = el?.props?.className ?? ''
  const lang = /language-([\w+-]+)/.exec(cls)?.[1] ?? ''
  const raw = el?.props?.children
  const code = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('') : String(raw ?? '')
  return { code: code.replace(/\n$/, ''), lang }
}

/** Markdown 代码块：语言标签 + 复制按钮 + shiki 双主题高亮 + >5 行行号。
 *  流式渲染防跳动：先渲染纯文本 pre，高亮完成后水合替换（debounce 200ms）。 */
export function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const { code, lang } = extract(children)
  const [highlighted, setHighlighted] = useState<{ code: string; html: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!lang || !code) return undefined
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      loadShiki()
        .then(({ codeToHtml }) =>
          // 代码区在亮暗主题下统一深色底（--color-bg-code），恒用 dark 配色
          codeToHtml(code, { lang, theme: 'github-dark' })
        )
        .then((out) => {
          if (seqRef.current === seq) setHighlighted({ code, html: out })
        })
        .catch(() => {
          // 未知语言 / 加载失败：保持纯文本回退
          if (seqRef.current === seq) setHighlighted(null)
        })
    }, 200)
    return () => clearTimeout(timer)
  }, [code, lang])

  const copy = (): void => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // 仅当高亮结果对应当前 code 时采用，否则纯文本回退（流式更新 code 变化即回退，防跳动）
  const html = highlighted && highlighted.code === code ? highlighted.html : null

  const withLines = code.split('\n').length > 5

  return (
    <div className="code-block group/code">
      <div className="code-block-bar">
        <span className="code-block-lang">{lang || 'text'}</span>
        <button
          onClick={copy}
          title={copied ? '已复制' : '复制代码'}
          className="code-block-copy"
          style={{ color: copied ? 'var(--color-success)' : undefined }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      {html ? (
        <div
          className={`code-block-body${withLines ? ' with-lines' : ''}`}
          // shiki 本地生成且已转义，安全
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className={`code-block-body${withLines ? ' with-lines' : ''}`}>
          <pre className="code-block-plain">
            <code>
              {code.split('\n').map((line, i) => (
                <span key={i} className="line">
                  {line}
                  {'\n'}
                </span>
              ))}
            </code>
          </pre>
        </div>
      )}
    </div>
  )
}
