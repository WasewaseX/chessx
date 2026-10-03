'use client'

import { useMemo } from 'react'
import { Chess } from 'chess.js'

const ORDER = ['q', 'r', 'b', 'n', 'p']
const VALUES: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 }

export function CapturedBar({ fen, className }: { fen: string; className?: string }) {
  const { whiteLost, blackLost, diff } = useMemo(() => {
    const g = new Chess(fen)
    const counts: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
    const w: Record<string, number> = { ...counts }
    const b: Record<string, number> = { ...counts }
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue
        if (sq.color === 'w') w[sq.type]--
        else b[sq.type]--
      }
    }
    const val = (m: Record<string, number>) => ORDER.reduce((s, t) => s + (m[t] ?? 0) * VALUES[t], 0)
    return { whiteLost: w, blackLost: b, diff: val(b) - val(w) } // + means white is ahead in captured material
  }, [fen])

  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <div className="flex items-center gap-2">
        <CapturedSide lost={blackLost} color="b" />
        {diff > 0 && <span className="text-xs font-bold text-muted-foreground">+{diff}</span>}
      </div>
      <div className="flex items-center gap-2">
        <CapturedSide lost={whiteLost} color="w" />
        {diff < 0 && <span className="text-xs font-bold text-muted-foreground">+{-diff}</span>}
      </div>
    </div>
  )
}

function CapturedSide({ lost, color }: { lost: Record<string, number>; color: 'w' | 'b' }) {
  return (
    <div className="flex h-5 items-center gap-0">
      {ORDER.flatMap((t) =>
        Array.from({ length: Math.max(0, lost[t] ?? 0) }, (_, i) => (
           
          <img
            key={`${t}-${i}`}
            src={`/pieces/${color}${t.toUpperCase()}.svg`}
            alt=""
            className="-ml-1.5 h-5 w-5 first:ml-0"
            draggable={false}
          />
        )),
      )}
    </div>
  )
}
