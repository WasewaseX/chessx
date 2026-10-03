'use client'

import { cn } from '@/lib/utils'

export interface MoveListProps {
  /** SAN moves in order */
  moves: string[]
  /** index of currently viewed ply (0-based), -1 = none */
  cursor?: number
  onSelect?: (ply: number) => void
  className?: string
  maxHeightClass?: string
}

export function MoveList({ moves, cursor = moves.length - 1, onSelect, className, maxHeightClass = 'max-h-56' }: MoveListProps) {
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
  return (
    <div className={cn('scroll-slim overflow-y-auto', maxHeightClass, className)}>
      {pairs.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No moves yet.</div>}
      <div className="grid grid-cols-[2.2rem_1fr_1fr] text-sm">
        {pairs.map((p) => (
          <div key={p.n} className="contents">
            <div className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">{p.n}.</div>
            <button
              className={cn('truncate px-2 py-1 text-left font-medium hover:bg-accent', cursor === p.wPly && 'bg-accent font-bold')}
              onClick={() => onSelect?.(p.wPly)}
            >
              {p.w}
            </button>
            <button
              className={cn('truncate px-2 py-1 text-left font-medium hover:bg-accent', p.b != null && cursor === p.bPly && 'bg-accent font-bold')}
              onClick={() => p.b != null && onSelect?.(p.bPly)}
            >
              {p.b ?? ''}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
