interface BrandMarkProps {
  size?: number
  /** 描边/节点颜色，默认继承文字色；品牌渐变方块内传 '#fff' */
  color?: string
  className?: string
}

/** AgentHub 品牌符号：圆角六边形 Hub + 中心节点与三条短辐（编排/基础设施意象，去 AI 气泡）。
 *  矢量源同步自 assets/brand/agenthub-mark.svg（单色版用 currentColor 自适应主题）。 */
export function BrandMark({
  size = 24,
  color = 'currentColor',
  className
}: BrandMarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="AgentHub"
      className={className}
    >
      <title>AgentHub</title>
      <path
        d="M16 3.5 L26.5 9.5 V22.5 L16 28.5 L5.5 22.5 V9.5 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <path
        d="M16 15.5 V9.6M16 15.5 21.4 18.9M16 15.5 10.6 18.9"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
      <circle cx="16" cy="15.7" r="2.7" fill={color} />
    </svg>
  )
}
