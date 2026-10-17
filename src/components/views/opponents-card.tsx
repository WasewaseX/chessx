'use client'

/**
 * Opponents — per-opponent stats mined from the game reports this account
 * already stored: how many games were played against each opponent, how often
 * THEY blundered or slipped in the analyzed subset, and the user's score
 * against them. Opponents without any analyzed game show up with games only —
 * no invented error rates.
 */

import { useEffect, useState } from 'react'
import { readJson } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Loader2, Users } from 'lucide-react'

interface OpponentRow {
  name: string
  games: number
  analyzed: number
  opponentBlundersPerGame: number | null
  opponentMistakesPerGame: number | null
  userWinRate: number | null
  mostRecentAt: string | null
}

function Micro({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</div>
}

function WinRateChip({ rate }: { rate: number | null }) {
  if (rate == null) return null
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
        rate >= 50 ? 'bg-primary/15 text-primary' : 'bg-destructive/10 text-destructive',
      )}
      aria-label={`you won ${rate}% of these games`}
    >
      {rate}% won
    </span>
  )
}

function OpponentLine({ o }: { o: OpponentRow }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{o.name}</div>
        <div className="text-xs text-muted-foreground">
          {o.games} {o.games === 1 ? 'game' : 'games'}
          {o.analyzed > 0 ? ` · ${o.analyzed} analyzed` : ' · not analyzed yet'}
          {o.opponentBlundersPerGame != null ? ` · ${o.opponentBlundersPerGame} their blunders/game` : ''}
          {o.opponentMistakesPerGame != null ? ` · ${o.opponentMistakesPerGame} their mistakes/game` : ''}
        </div>
      </div>
      <WinRateChip rate={o.userWinRate} />
    </div>
  )
}

export function OpponentsCard() {
  const [rows, setRows] = useState<OpponentRow[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/opponents')
      .then((r) => readJson<{ opponents?: OpponentRow[] }>(r))
      .then((d) => {
        if (alive) setRows(d.opponents ?? [])
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [])

  const top = rows?.slice(0, 5) ?? []
  const rest = rows?.slice(5) ?? []

  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Users className="h-5 w-5 text-primary" aria-hidden />
        Opponents
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        From your analyzed games — how often they erred, and how you scored.
      </p>

      {rows === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading opponents…
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No analyzed opponents yet — run a Game review and their habits show up here.
        </p>
      ) : (
        <>
          <div className="mt-2 divide-y divide-border">
            {top.map((o) => (
              <OpponentLine key={o.name} o={o} />
            ))}
          </div>
          {rest.length > 0 ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                {expanded ? 'Hide details' : `Details (${rows.length} opponents)`}
              </Button>
              {expanded ? (
                <div className="mt-1 max-h-72 divide-y divide-border overflow-y-auto scroll-slim">
                  {rest.map((o) => (
                    <OpponentLine key={o.name} o={o} />
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">
            Blunder and mistake rates come from the reports you ran; only games with a stored report count toward them.
          </p>
        </>
      )}
    </div>
  )
}
