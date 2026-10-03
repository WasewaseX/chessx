'use client'

export interface EvalBarProps {
  /** eval in pawns, White POV. Clamp -8..8. */
  score: number
  /** mate for side; 1 = white mates, -1 = black mates */
  mateFor?: number | null
  orientation?: 'w' | 'b'
  className?: string
}

export function EvalBar({ score, mateFor, orientation = 'w', className }: EvalBarProps) {
  const clamped = Math.max(-8, Math.min(8, score))
  // white share of the bar (0..1)
  let whiteShare = 0.5 + clamped / 16
  if (mateFor === 1) whiteShare = 1
  if (mateFor === -1) whiteShare = 0
  if (orientation === 'b') whiteShare = 1 - whiteShare
  const topIsWhite = orientation === 'b'
  const topShare = topIsWhite ? whiteShare : 1 - whiteShare

  const label = mateFor != null ? `M${Math.abs(mateFor)}` : (score > 0 ? '+' : '') + score.toFixed(1)
  const topAdvantage = topIsWhite ? score > 0 || mateFor === 1 : score < 0 || mateFor === -1

  return (
    <div
      className={`relative w-5 shrink-0 self-stretch overflow-hidden rounded ${className ?? ''}`}
      style={{ background: topIsWhite ? '#f0f0f0' : '#403d3a' }}
      title={`Evaluation: ${label}`}
      aria-label={`Position evaluation ${label}`}
    >
      <div
        className="absolute inset-x-0 top-0 transition-[height] duration-300"
        style={{
          height: `${topShare * 100}%`,
          background: topIsWhite ? '#f0f0f0' : '#403d3a',
          borderBottom: topAdvantage ? '2px solid rgba(130,182,76,0.9)' : undefined,
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 transition-[height] duration-300"
        style={{
          height: `${(1 - topShare) * 100}%`,
          background: topIsWhite ? '#403d3a' : '#f0f0f0',
          borderTop: !topAdvantage ? '2px solid rgba(130,182,76,0.9)' : undefined,
        }}
      />
      <span
        className={`absolute left-1/2 z-10 -translate-x-1/2 rounded-sm px-0.5 text-[9px] font-bold leading-3.5 ${
          topAdvantage ? 'top-0.5 bg-[#403d3a] text-white' : 'bottom-0.5 bg-[#f0f0f0] text-[#403d3a]'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
