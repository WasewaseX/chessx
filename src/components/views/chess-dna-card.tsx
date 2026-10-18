'use client'
import { useCallback, useEffect, useState } from 'react'
import { readJson } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  Activity,
  BookOpen,
  Castle,
  Crosshair,
  Dna,
  Flame,
  RotateCcw,
  Sparkles,
} from 'lucide-react'

/**
 * Chess DNA — the five-domain skill report built from the player's own
 * analyzed games (server-computed in src/lib/server/chess-dna.ts). The card
 * is honest by construction: fewer than three analyzed games shows the
 * import/review loop instead of a fake report; a domain without data shows
 * "not enough data"; a small percentile pool says so.
 */

interface DnaDomainDTO {
  key: 'tactics' | 'consistency' | 'opening' | 'aggression' | 'endgame'
  label: string
  score: number | null
  percentile: number | null
  sample: string
  note: string
}

interface DnaReportDTO {
  ready: boolean
  games: number
  archetype: { key: string; name: string; tagline: string } | null
  domains: DnaDomainDTO[]
  strongest: string | null
  weakest: string | null
  trainView: { view: 'review' | 'puzzles' | 'tools'; label: string } | null
  tip: string | null
  population: number
  computedAt: string
}

const DOMAIN_ICONS: Record<DnaDomainDTO['key'], typeof Crosshair> = {
  tactics: Crosshair,
  consistency: Activity,
  opening: BookOpen,
  aggression: Flame,
  endgame: Castle,
}

const MIN_GAMES = 3

function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

export function ChessDnaCard() {
  const { navigate } = useApp()
  const [report, setReport] = useState<DnaReportDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    function run(attempt: number) {
      fetch('/api/dna')
        .then((r) => readJson<DnaReportDTO>(r))
        .then((d) => {
          setReport(d)
          setError(false)
        })
        .catch(() => {
          // dev-mode compile races can 500 a first hit before the handler runs;
          // one silent retry absorbs that, real failures still surface
          if (attempt < 2) {
            setTimeout(() => run(attempt + 1), 900)
            return
          }
          setError(true)
        })
        .finally(() => setLoading(false))
    }
    run(1)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const analyzed = report?.games ?? 0
  const ready = report?.ready === true

  return (
    <section className="rounded-lg bg-card p-6 shadow-sm" aria-label="Chess DNA report">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span aria-hidden="true" className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/60">
            01 / Chess DNA
          </span>
          <div className="mt-1 flex items-center gap-2">
            <Dna className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Your Chess DNA</h2>
          </div>
        </div>
        {ready && (
          <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-bold text-primary" title={`Strongest domain: ${report?.archetype?.name ?? ''}`}>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {report?.archetype?.name ?? 'Measured'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading your Chess DNA">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3.5 w-28 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
              <div className="h-1.5 w-full animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-destructive">Could not load your Chess DNA.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading(true)
              setError(false)
              load()
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : !ready ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Your DNA is measured from analyzed games — accuracy, misses, book depth, king hunting and
            endgame conversion. {analyzed > 0 ? `${analyzed} of ${MIN_GAMES} analyzed games so far.` : 'None analyzed yet.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="btn-hero px-5" onClick={() => navigate('analysis')}>
              Import your games
            </Button>
            <Button variant="secondary" onClick={() => navigate('review')}>
              Review a game here
            </Button>
          </div>
        </>
      ) : (
        <>
          {report?.archetype && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">{report.archetype.name}</span>
              <span className="text-muted-foreground"> — {report.archetype.tagline}</span>
            </p>
          )}
          <div className="mt-4 grid gap-3.5">
            {report?.domains.map((d) => {
              const Icon = DOMAIN_ICONS[d.key]
              const isWeak = report.weakest === d.key && report.domains.filter((x) => x.score != null).length > 1
              return (
                <div key={d.key}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="text-sm font-semibold">{d.label}</span>
                    {d.score != null ? (
                      <span className="text-sm font-extrabold tabular-nums" aria-label={`${d.label} score ${d.score} out of 100`}>
                        {d.score}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">not enough data</span>
                    )}
                    {d.score != null && (
                      <span
                        className="ml-auto text-[11px] font-semibold text-muted-foreground"
                        title={report.population >= 3 ? `Better than ${d.percentile}% of ${report.population} measured players on ChessX` : 'Percentile pool is still building'}
                      >
                        {d.percentile != null ? `${ordinal(d.percentile)} pct` : 'pool building'}
                      </span>
                    )}
                  </div>
                  {d.score != null ? (
                    <Progress
                      value={Math.max(2, d.score)}
                      className={cn('mt-1.5 h-1.5', isWeak && 'opacity-80')}
                      aria-label={`${d.label}: ${d.score} of 100`}
                    />
                  ) : (
                    <div className="mt-1.5 h-1.5 rounded-full bg-secondary" aria-hidden="true" />
                  )}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-muted-foreground">
                    <span>{d.sample}</span>
                    {isWeak && report.trainView && (
                      <button
                        onClick={() => navigate(report.trainView!.view)}
                        className="inline-flex min-h-6 items-center font-semibold text-primary hover:underline"
                        aria-label={`${report.trainView.label} — improve your weakest domain`}
                      >
                        {report.trainView.label} →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {report?.tip && (
            <p className="mt-4 rounded-md bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {report.tip}
            </p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            From {report?.games} analyzed {report?.games === 1 ? 'game' : 'games'}
            {report && report.population >= 3 ? ` · percentiles vs ${report.population} ChessX players` : ' · percentile pool still building'}
            . Review more games to sharpen it.
          </p>
        </>
      )}
    </section>
  )
}
