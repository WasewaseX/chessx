'use client'

import { cn } from '@/lib/utils'

/**
 * The full chess.com-style move-classification icon set. Every label is a
 * flat colored disc with a white glyph and the subtle darker bottom edge the
 * originals have, drawn as pure SVG so it renders crisp at any size and in
 * both light and dark themes.
 *
 * Shared by the move list, the game report, the chat move chips and the
 * insights tables — the single source of truth for label order and colors.
 */

export type QualityLabel =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

/** Chess.com's exact palette. */
export const QUALITY_META: Record<QualityLabel, { name: string; color: string; short: string }> = {
  brilliant: { name: 'Brilliant', color: '#26c2a3', short: '!!' },
  great: { name: 'Great Move', color: '#5c8bb0', short: '!' },
  best: { name: 'Best Move', color: '#95bb4a', short: '★' },
  excellent: { name: 'Excellent', color: '#96bc4b', short: '👍' },
  good: { name: 'Good', color: '#96af8b', short: '✓' },
  book: { name: 'Book', color: '#a88865', short: '📖' },
  inaccuracy: { name: 'Inaccuracy', color: '#f7c631', short: '?!' },
  mistake: { name: 'Mistake', color: '#e8903a', short: '?' },
  miss: { name: 'Miss', color: '#e66f5c', short: '✕' },
  blunder: { name: 'Blunder', color: '#ca3431', short: '??' },
}

/** Report-table order: classy first, painful last. */
export const QUALITY_ORDER: QualityLabel[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
]

/** Legacy quality arrays (analysis fallback, play view) map cleanly in. */
export function asQualityLabel(v: string | null | undefined): QualityLabel | null {
  if (!v) return null
  if (v in QUALITY_META) return v as QualityLabel
  return null
}

interface QualityIconProps {
  label: QualityLabel
  /** Pixel size of the disc. Default 20. */
  size?: number
  className?: string
  /** Show nothing for a falsy label (helper for inline use). */
}

/** White glyph paths (24×24 viewBox, Material-style). */
const GLYPHS: Partial<Record<QualityLabel, string>> = {
  best: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  excellent:
    'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
  good: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  book: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm-9 13.5C10.61 17.55 8.4 17 6.5 17c-1.19 0-2.65.21-4 .66V7.5c1.34-.46 2.81-.75 4-.75 1.9 0 4.11.55 5.5 1.5v11.25z',
  miss: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
}

/** Labels drawn as bold text glyphs instead of paths. */
const TEXT_GLYPHS: Partial<Record<QualityLabel, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
}

export function QualityIcon({ label, size = 20, className }: QualityIconProps) {
  const meta = QUALITY_META[label]
  const textGlyph = TEXT_GLYPHS[label]
  const pathGlyph = GLYPHS[label]
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0 select-none', className)}
      role="img"
      aria-label={meta.name}
    >
      {/* disc */}
      <circle cx="12" cy="12" r="12" fill={meta.color} />
      {/* the originals carry a subtle darker bottom edge; a clipped arc fakes it cheaply */}
      <path d="M12 24a12 12 0 0 0 12-12A17 17 0 0 1 8 23.2 12 12 0 0 0 12 24Z" fill="rgba(0,0,0,0.14)" />
      {pathGlyph && (
        <path
          d={pathGlyph}
          fill="#fff"
          transform={
            label === 'book'
              ? 'translate(1.2 0.4) scale(0.92)'
              : label === 'excellent'
                ? 'translate(0.4 0.4) scale(0.92)'
                : 'scale(0.82) translate(2.6 2.6)'
          }
        />
      )}
      {textGlyph && (
        <text
          x="12"
          y="13"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={textGlyph.length > 1 ? 11 : 14}
          fontWeight={900}
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        >
          {textGlyph}
        </text>
      )}
    </svg>
  )
}

/** Chess.com legend style: icon + bold colored name. */
export function QualityName({
  label,
  size = 22,
  className,
  textClassName,
}: {
  label: QualityLabel
  size?: number
  className?: string
  textClassName?: string
}) {
  const meta = QUALITY_META[label]
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <QualityIcon label={label} size={size} />
      <span className="font-bold" style={{ color: meta.color }}>
        <span className={cn('text-base', textClassName)}>{meta.name}</span>
      </span>
    </span>
  )
}

/** Small inline icon that tolerates a nullable label. */
export function QualityDot({
  label,
  size = 15,
  className,
}: {
  label: QualityLabel | null | undefined
  size?: number
  className?: string
}) {
  if (!label) return null
  return <QualityIcon label={label} size={size} className={className} />
}

/** Full legend row, e.g. under the game report. */
export function QualityLegend({ labels, className }: { labels?: QualityLabel[]; className?: string }) {
  const list = labels ?? QUALITY_ORDER
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)}>
      {list.map((l) => (
        <QualityName key={l} label={l} size={20} textClassName="text-sm" />
      ))}
    </div>
  )
}
