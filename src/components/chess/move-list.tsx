'use client'

import { LABEL_META, type MoveLabel } from '@/lib/chess/move-classification'
import { cn } from '@/lib/utils'

/**
 * Move list, chess.com game-review style.
 *
 * Two annotation modes:
 *  - review mode (`labels` given): every reviewed move carries its
 *    classification glyph in the official label color plus its centipawn
 *    loss ("12cp") as a small muted mono number. 0cp shows nothing.
 *  - free-play mode (`quality` given): clean rows where only errors get a
 *    small colored dot (best/excellent/good stay unannotated).
 *
 * Label colors come from the frozen shared contract (move-classification.ts);
 * the parent coerces transported label strings at the data boundary, so the
 * meta lookup here is always on a valid MoveLabel and cannot crash.
 */

/** Legacy per-move quality (errors only). Kept for the free-play surfaces. */
export type MoveQuality = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

/** Dot + text styling for the qualities that get annotated (errors only). */
const QUALITY_META: Partial<Record<MoveQuality, { dot: string; text: string; title: string }>> = {
  inaccuracy: { dot: 'bg-[#f7c437]', text: 'text-[#8a6d10] dark:text-[#f7c437]', title: 'Inaccuracy' },
  mistake: { dot: 'bg-[#e8900c]', text: 'text-[#a35d05] dark:text-[#e8900c]', title: 'Mistake' },
  blunder: { dot: 'bg-destructive', text: 'text-destructive', title: 'Blunder' },
}

/** The classification glyph chess.com prints inside the colored circle. */
function MoveBadge({ label }: { label: MoveLabel }) {
  const meta = LABEL_META[label]
  return (
    <span
      className="ml-1 inline-flex h-4 min-w-4 translate-y-[-1px] items-center justify-center rounded-full px-0.5 align-middle text-[8px] font-bold leading-none text-white"
      style={{ background: meta.color }}
      title={meta.text}
      aria-label={meta.text}
    >
      {meta.glyph}
    </span>
  )
}

/** Centipawn loss tag: only rendered when the move actually cost something. */
function CplTag({ cpl }: { cpl: number }) {
  return <span className="ml-1 font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(cpl)}cp</span>
}

export interface MoveListProps {
  /** SAN moves in order */
  moves: string[]
  /** index of currently viewed ply (0-based), -1 = none */
  cursor?: number
  onSelect?: (ply: number) => void
  className?: string
  maxHeightClass?: string
  /** per-ply classification label (review mode), parallel to `moves` */
  labels?: (MoveLabel | null)[]
  /** per-ply centipawn loss (review mode), parallel to `moves` */
  cpls?: (number | null)[]
  /** per-ply quality, parallel to `moves` (legacy free-play mode); ignored when `labels` is given */
  quality?: (MoveQuality | null)[]
}

export function MoveList({
  moves,
  cursor = moves.length - 1,
  onSelect,
  className,
  maxHeightClass = 'max-h-56',
  labels,
  cpls,
  quality,
}: MoveListProps) {
  const pairs: { n: number; w?: string; b?: string; wPly: number; bPly: number }[] = []
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      n: i / 2 + 1,
      w: moves[i],
      b: moves[i + 1],
      wPly: i,
      bPly: i + 1,
    })
  }

  const cell = (san: string | undefined, ply: number) => {
    if (san == null) return <div className="px-2 py-1" aria-hidden />
    const label = labels?.[ply] ?? null
    const qRaw: MoveQuality | null = label ? null : (quality?.[ply] ?? null)
    const q = qRaw ? QUALITY_META[qRaw] : undefined
    const cpl = cpls?.[ply]
    const showCpl = cpl != null && cpl > 0
    return (
      <button
        className={cn(
          'truncate px-2 py-1 text-left font-medium hover:bg-accent',
          !label && q?.text,
          cursor === ply && 'bg-accent font-bold',
        )}
        onClick={() => onSelect?.(ply)}
        aria-label={`Move ${Math.floor(ply / 2) + 1}${ply % 2 === 1 ? '…' : ''} ${san}${label ? `, ${LABEL_META[label].text}` : ''}`}
      >
        {san}
        {label ? (
          <MoveBadge label={label} />
        ) : q ? (
          <span className={cn('ml-1 inline-block h-1.5 w-1.5 rounded-full', q.dot)} title={q.title} aria-label={q.title} />
        ) : null}
        {showCpl && <CplTag cpl={cpl} />}
      </button>
    )
  }

  return (
    <div className={cn('scroll-slim overflow-y-auto', maxHeightClass, className)}>
      {pairs.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No moves yet.</div>}
      <div className="grid grid-cols-[2.2rem_1fr_1fr] text-sm">
        {pairs.map((p) => (
          <div key={p.n} className="contents">
            <div className="px-2 py-1 text-right text-xs font-semibold tabular-nums text-muted-foreground">{p.n}.</div>
            {cell(p.w, p.wPly)}
            {cell(p.b, p.bPly)}
          </div>
        ))}
      </div>
    </div>
  )
}
