'use client'
// Openings to fix — the home card for the Opening Review Queue (port of
// chessigma's `opening_review_queue`, REA report §4/§6 item 3).
//
// Shows the openings that actually cost the player points, ranked by live
// drill state and their own reviewed-game errors, then deep-links into the
// Mistake Corrector scoped to one opening ("Practice this opening").
//
// Honesty rules:
//   - only openings with >= 2 reviewed games appear (one bad game is
//     variance, not a repertoire hole)
//   - an empty state says what earns a row (review more games), never a
//     fake weakness
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { readJson } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Loader2, Swords, TriangleAlert, BookOpen } from 'lucide-react'

interface OpeningRow {
  opening: string
  games: number
  avgAcc: number | null
  ownErrors: number
  record: string
  dueDrills: number
  totalDrills: number
  masteredDrills: number
  avgLossCp: number | null
}

export function OpeningsQueueCard() {
  const { navigate, setOpeningDrillFocus, openingDrillFocus } = useApp()
  const [rows, setRows] = useState<OpeningRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [practicing, setPracticing] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/openings/queue')
      .then((r) => readJson<{ openings?: OpeningRow[] }>(r))
      .then((d) => {
        if (alive) setRows(d.openings ?? [])
      })
      .catch(() => {
        if (alive) setLoadError(true)
      })
    return () => {
      alive = false
    }
  }, [])

  async function practice(opening: string) {
    if (practicing) return
    setPracticing(opening)
    try {
      const res = await fetch('/api/openings/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opening }),
      })
      await readJson<{ ready?: number }>(res).catch(() => ({}))
      setOpeningDrillFocus(opening)
      navigate('review')
    } finally {
      setPracticing(null)
    }
  }

  if (loadError || !rows || rows.length === 0) return null

  const top = rows.slice(0, 3)

  return (
    <section className="rounded-xl bg-card p-4 shadow-sm sm:p-6" aria-label="Openings to fix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <BookOpen className="h-4 w-4 text-primary" /> Openings to fix
        </div>
        <div className="text-xs text-muted-foreground">
          from your reviewed games · worst first
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {top.map((r) => {
          const isFocused = openingDrillFocus === r.opening
          return (
            <li
              key={r.opening}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-background/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{r.opening}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{r.games} games · {r.record}</span>
                  {r.avgAcc != null && <span>· {r.avgAcc}% accuracy</span>}
                  {r.ownErrors > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <TriangleAlert className="h-3 w-3" /> {r.ownErrors} own errors
                    </span>
                  )}
                  {r.totalDrills > 0 && (
                    <span>
                      · {r.dueDrills > 0 ? `${r.dueDrills} due` : `${r.masteredDrills}/${r.totalDrills} mastered`}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={isFocused ? 'secondary' : 'default'}
                className="h-8 shrink-0"
                disabled={practicing !== null}
                onClick={() => void practice(r.opening)}
              >
                {practicing === r.opening ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Swords className="h-3.5 w-3.5" />
                )}
                Practice
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
