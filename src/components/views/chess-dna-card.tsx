'use client'
import { useCallback, useEffect, useState } from 'react'
import { readJson } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { coachMaybe } from '@/lib/coaches'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CharacterFace } from '@/components/chess/characters'
import { SpeakButton } from '@/components/chess/speak-button'
import { cn } from '@/lib/utils'
import {
  Activity,
  BookOpen,
  Castle,
  Crosshair,
  Dna,
  Flame,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Timer,
  TrendingUp,
} from 'lucide-react'

/**
 * Chess DNA — the seven-domain skill report built from the player's own
 * analyzed games (server-computed in src/lib/server/chess-dna.ts). The card
 * is honest by construction: fewer than three analyzed games shows the
 * import/review loop instead of a fake report; a domain without data shows
 * "not enough data"; a small percentile pool says so.
 */

interface DnaDomainDTO {
  key: 'tactics' | 'consistency' | 'opening' | 'aggression' | 'endgame' | 'clock' | 'conversion'
  label: string
  score: number | null
  percentile: number | null
  sample: string
  note: string
  drill: { view: 'review' | 'puzzles' | 'tools'; label: string; arg?: string } | null
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
  history: { day: string; games: number; scores: Record<DnaDomainDTO['key'], number | null> }[]
}

const DOMAIN_ICONS: Record<DnaDomainDTO['key'], typeof Crosshair> = {
  tactics: Crosshair,
  consistency: Activity,
  opening: BookOpen,
  aggression: Flame,
  endgame: Castle,
  clock: Timer,
  conversion: TrendingUp,
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

/**
 * One domain's history as a tiny inline SVG line. Honest by construction:
 * fewer than two measured points draws nothing and says why.
 */
function DomainTrend({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) {
    return <span className="text-[11px] text-muted-foreground">trend from 2nd day</span>
  }
  const W = 100
  const H = 26
  const xs = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W)
  const ys = (v: number) => H - 2 - (Math.max(0, Math.min(100, v)) / 100) * (H - 4)
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')
  const delta = points[points.length - 1] - points[0]
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24" aria-hidden="true">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-primary" />
      </svg>
      <span
        className={cn(
          'text-[11px] font-bold tabular-nums',
          delta > 0 ? 'text-primary' : delta < 0 ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-label={`${label} changed ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} points since your first report`}
      >
        {delta > 0 ? '+' : ''}
        {delta}
      </span>
    </span>
  )
}

export function ChessDnaCard({ variant = 'home' }: { variant?: 'home' | 'profile' } = {}) {
  const { navigate, profile } = useApp()
  const [report, setReport] = useState<DnaReportDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Coach narration: the persona reads the measured report back, in voice.
  const [narration, setNarration] = useState<string | null>(null)
  const [narrating, setNarrating] = useState(false)
  const [narrError, setNarrError] = useState<string | null>(null)

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

  const narrate = useCallback(() => {
    if (narrating) return
    setNarrating(true)
    setNarrError(null)
    fetch('/api/dna/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then((r) => readJson<{ text?: string; coach?: string; error?: string }>(r))
      .then((d) => {
        if (d.text) setNarration(d.text)
        else setNarrError(d.error ?? 'Your coach could not read the report right now.')
      })
      .catch(() => setNarrError('Your coach could not read the report right now.'))
      .finally(() => setNarrating(false))
  }, [narrating])

  const coach = coachMaybe(profile?.coach) ?? coachMaybe('nina')!

  const analyzed = report?.games ?? 0
  const ready = report?.ready === true

  return (
    <section className="rounded-lg bg-card p-6 shadow-sm" aria-label="Chess DNA report">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span aria-hidden="true" className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/60">
            {variant === 'profile' ? 'Skill report' : '01 / Chess DNA'}
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
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{d.sample}</span>
                    {d.drill && (
                      <button
                        onClick={() => navigate(d.drill!.view, d.drill!.arg)}
                        className={cn(
                          'inline-flex min-h-6 items-center font-semibold hover:underline',
                          isWeak ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                        )}
                        aria-label={`${d.drill.label} — train ${d.label.toLowerCase()}`}
                      >
                        {d.drill.label} →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {variant === 'profile' && (report?.history?.length ?? 0) > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Your trend</h3>
                <span className="text-[11px] text-muted-foreground">
                  {report?.history?.length} {report?.history?.length === 1 ? 'day' : 'days'} measured
                </span>
              </div>
              <div className="mt-2.5 grid gap-2">
                {report?.domains.map((d) => {
                  const pts = report.history
                    .map((h) => h.scores[d.key])
                    .filter((v): v is number => v != null)
                  return (
                    <div key={d.key} className="flex items-center justify-between gap-3">
                      <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-muted-foreground">{d.label}</span>
                      <DomainTrend points={pts} label={d.label} />
                    </div>
                  )
                })}
              </div>
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                One measurement per day, taken when this report opens. Come back tomorrow and the lines start to move.
              </p>
            </div>
          )}
          {report?.tip && (
            <p className="mt-4 rounded-md bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {report.tip}
            </p>
          )}

          {/* The coach reads the measured report, in persona and in voice. */}
          <div className="mt-4">
            {narration ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
                    <CharacterFace id={coach.id} label={coach.name} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-primary">{coach.name} reads your DNA</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground/90">{narration}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <SpeakButton text={narration} voice={coach.voice} speed={coach.speed} />
                      <button
                        onClick={() => setNarration(null)}
                        className="inline-flex min-h-6 items-center text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={narrate}
                  disabled={narrating}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-secondary disabled:opacity-60"
                  aria-label={`${coach.name} reads your DNA report aloud`}
                >
                  {narrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />}
                  {narrating ? `${coach.name} is reading…` : `Ask ${coach.name} to read it`}
                </button>
                {narrError && <span className="text-[11px] text-destructive">{narrError}</span>}
              </div>
            )}
          </div>
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
