interface BrandMarkProps {
  size?: number
  /** 描边/节点颜色，默认继承文字色；品牌渐变方块内传 '#fff' */
  color?: string
  className?: string
}

/** AgentHub 品牌符号：聊天气泡 + 中心 hub 节点 + 协作卫星节点。
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
        d="M9.5 5 H22.5 Q28 5 28 10.5 V17.5 Q28 23 22.5 23 H11 L6.5 27.5 L8.5 23 Q4 23 4 17.5 V10.5 Q4 5 9.5 5 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d="M10.5 11 16 15.5M21.5 11 16 15.5"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.5}
      />
      <circle cx="10.5" cy="11" r="2.2" fill={color} />
      <circle cx="21.5" cy="11" r="2.2" fill={color} />
      <circle cx="16" cy="15.5" r="3" fill={color} />
    </svg>
  )
}
