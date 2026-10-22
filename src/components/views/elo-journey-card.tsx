'use client'
import { useEffect, useState } from 'react'
import { readJson } from '@/lib/api-client'
import { TrendingUp } from 'lucide-react'

/**
 * Elo journey — a line of the account rating after every finished rated
 * online game. Honest by construction: it plots exactly the rows the rated
 * games wrote (no smoothing, no backfilled dots), needs two points to draw
 * a line, and says plainly that bot and puzzle ratings never appear here.
 */

interface Point {
  at: string
  rating: number
}

export function EloJourneyCard() {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ratings/history')
      .then((r) => readJson<{ points?: Point[] }>(r))
      .then((d) => {
        if (!cancelled) setPoints(d.points ?? [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pts = points ?? []
  const first = pts[0]
  const last = pts[pts.length - 1]
  const delta = pts.length >= 2 ? last.rating - first.rating : 0

  return (
    <section className="rounded-lg bg-card p-6 shadow-sm" aria-label="Elo journey">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-display text-lg font-bold">Elo journey</h2>
        </div>
        {pts.length >= 2 && (
          <span
            className={`text-sm font-extrabold tabular-nums ${delta > 0 ? 'text-primary' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-label={`Rating changed ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} points over ${pts.length} rated games`}
          >
            {delta > 0 ? '+' : ''}
            {delta} over {pts.length} rated {pts.length === 1 ? 'game' : 'games'}
          </span>
        )}
      </div>

      {failed ? (
        <p className="mt-3 text-sm text-destructive">Could not load your rating history.</p>
      ) : points === null ? (
        <div className="mt-4 h-28 w-full animate-pulse rounded-md bg-secondary motion-reduce:animate-none" role="status" aria-label="Loading your Elo journey" />
      ) : pts.length < 2 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {pts.length === 0
            ? 'Play a rated game — your journey starts with the first one.'
            : 'One rated game played. The line appears with your second.'}
        </p>
      ) : (
        <EloChart points={pts} />
      )}
      {pts.length >= 2 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          One dot per rated game, no smoothing. Bot and puzzle ratings never appear here — this line moves only to real opponents.
        </p>
      )}
    </section>
  )
}

function EloChart({ points }: { points: Point[] }) {
  const W = 600
  const H = 140
  const ratings = points.map((p) => p.rating)
  const min = Math.min(...ratings)
  const max = Math.max(...ratings)
  const pad = Math.max(15, (max - min) * 0.15)
  const lo = min - pad
  const hi = max + pad
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 8) + 4)
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  const up = points[points.length - 1].rating >= points[0].rating

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label={`Elo journey from ${points[0].rating} to ${points[points.length - 1].rating} across ${points.length} rated games`}>
        <path d={area} className={up ? 'fill-primary/10' : 'fill-destructive/10'} aria-hidden="true" />
        <path d={line} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={up ? 'stroke-primary' : 'stroke-destructive'} />
        <circle cx={x(0)} cy={y(points[0].rating)} r={3.5} className={up ? 'fill-primary' : 'fill-destructive'} aria-hidden="true" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].rating)} r={3.5} className={up ? 'fill-primary' : 'fill-destructive'} aria-hidden="true" />
      </svg>
      <div className="flex justify-between text-[11px] font-semibold text-muted-foreground">
        <span>{points[0].rating}</span>
        <span>{points[points.length - 1].rating} now</span>
      </div>
    </div>
  )
}
