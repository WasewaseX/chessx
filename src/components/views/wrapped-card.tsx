'use client'

/**
 * Chess Wrapped — a year-in-review story built from the account's own stored
 * data (recorded games, game reports, activity days, lessons). The numbers
 * come straight from /api/wrapped; nothing is seeded or invented, so the
 * dialog has an honest empty state when the year is still empty.
 */

import { useState } from 'react'
import { readJson } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ChessBoard } from '@/components/chess/board'
import { cn } from '@/lib/utils'
import { CalendarRange, Loader2, Sparkles, Swords } from 'lucide-react'

interface WrappedPayload {
  windowDays: number
  generatedAt: string
  hasData: boolean
  games: {
    total: number
    byMonth: { month: string; count: number }[]
    wins: number
    draws: number
    losses: number
    asWhite: number
    asBlack: number
    avgAccuracy: number | null
    bestAccuracyGame: { accuracy: number | null; date: string; opponent: string; opening: string | null } | null
    longestGamePlies: number
    favoriteOpening: { name: string; count: number } | null
    timeControls: { pool: string; count: number }[]
  }
  puzzles: { solved: number; solvedAllTime: number; bestStreak: number; currentRating: number | null; dailyDone: number }
  lessons: { stepsDone: number; completed: number }
  streaks: { bestActivityStreak: number; totalMinutes: number }
  pivotalMoment: { fen: string; san: string; lossCp: number; date: string } | null
  milestones: string[]
}

function Micro({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</div>
}

function BigStat({ value, label, note }: { value: string | number; label: string; note?: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 p-3">
      <div className="font-display text-2xl font-extrabold text-primary">{value}</div>
      <Micro className="mt-0.5">{label}</Micro>
      {note ? <div className="mt-0.5 text-[10px] text-muted-foreground">{note}</div> : null}
    </div>
  )
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

function minutesLabel(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function openInAnalysis(fen: string) {
  window.location.hash = `#/analysis?fen=${encodeURIComponent(fen)}`
}

export function WrappedCard() {
  const { profile } = useApp()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<WrappedPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadWrapped() {
    if (data || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/wrapped')
      const d = await readJson<WrappedPayload & { error?: string }>(res)
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your year')
    } finally {
      setLoading(false)
    }
  }

  const g = data?.games
  const puzzles = data?.puzzles
  const puzzleNote =
    puzzles && puzzles.solved === 0 && puzzles.solvedAllTime > 0 ? 'all time' : undefined
  const puzzleValue =
    puzzles && puzzles.solved === 0 && puzzles.solvedAllTime > 0 ? puzzles.solvedAllTime : (puzzles?.solved ?? 0)
  const maxMonth = g ? Math.max(1, ...g.byMonth.map((m) => m.count)) : 1

  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            Chess Wrapped
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your last 365 days, built from games, puzzles and study already stored in this account.
          </p>
        </div>
      </div>
      <Button
        className="mt-4"
        size="sm"
        onClick={() => {
          setOpen(true)
          void loadWrapped()
        }}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarRange className="h-4 w-4" aria-hidden />}
        See my year
      </Button>
      {error ? (
        <p role="alert" className="mt-3 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) void loadWrapped()
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden />
              Your year in chess
            </DialogTitle>
            <DialogDescription>
              {data ? `The last ${data.windowDays} days, from data stored in this account only.` : 'Loading your year…'}
            </DialogDescription>
          </DialogHeader>

          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Gathering your year…
            </div>
          ) : data && !data.hasData ? (
            <div className="py-8 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 font-display text-lg font-bold">Nothing to wrap yet</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                Play and review games — your year builds itself here.
              </p>
            </div>
          ) : data && g && puzzles ? (
            <div className="space-y-6">
              {/* big numbers */}
              <div className="grid grid-cols-2 gap-3">
                <BigStat value={g.total} label="Games played" note={`${g.wins}W · ${g.draws}D · ${g.losses}L`} />
                <BigStat value={puzzleValue} label="Puzzles solved" note={puzzleNote ?? (puzzles.currentRating != null ? `rated ${puzzles.currentRating}` : undefined)} />
                <BigStat value={data.lessons.stepsDone} label="Lesson steps" note={`${data.lessons.completed} lessons complete`} />
                <BigStat value={minutesLabel(data.streaks.totalMinutes)} label="Active minutes" note={`best run: ${data.streaks.bestActivityStreak} ${data.streaks.bestActivityStreak === 1 ? 'day' : 'days'}`} />
              </div>

              {/* games per month, pure divs */}
              <section aria-label="Games per month over the last 12 months">
                <Micro>Games per month</Micro>
                <div className="mt-2 flex h-24 items-end gap-1.5" role="img" aria-label={g.byMonth.map((m) => `${monthLabel(m.month)}: ${m.count}`).join(', ')}>
                  {g.byMonth.map((m) => (
                    <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div
                        aria-hidden
                        className={cn('w-full rounded-t-sm transition-all', m.count > 0 ? 'bg-primary/80' : 'bg-muted')}
                        style={{ height: `${Math.max(4, (m.count / maxMonth) * 76)}px` }}
                      />
                      <span className="text-[9px] font-semibold text-muted-foreground">{monthLabel(m.month)[0]}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.timeControls.map((t) => (
                    <span key={t.pool} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t.pool} · {t.count}
                    </span>
                  ))}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {g.asWhite} as white · {g.asBlack} as black
                  </span>
                </div>
              </section>

              {/* highlights */}
              {(g.favoriteOpening || g.bestAccuracyGame) && (
                <section className="grid gap-3 sm:grid-cols-2">
                  {g.favoriteOpening ? (
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <Micro>Favorite opening</Micro>
                      <div className="mt-1 text-sm font-bold">{g.favoriteOpening.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.favoriteOpening.count} {g.favoriteOpening.count === 1 ? 'game' : 'games'}
                      </div>
                    </div>
                  ) : null}
                  {g.bestAccuracyGame ? (
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <Micro>Best accuracy</Micro>
                      <div className="mt-1 text-sm font-bold">{g.bestAccuracyGame.accuracy}%</div>
                      <div className="truncate text-xs text-muted-foreground">
                        vs {g.bestAccuracyGame.opponent}
                        {g.bestAccuracyGame.opening ? ` · ${g.bestAccuracyGame.opening}` : ''}
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {/* pivotal moment with a read-only mini board */}
              {data.pivotalMoment ? (
                <section aria-label="Pivotal moment of the year">
                  <Micro>Pivotal moment</Micro>
                  <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                    <div className="w-[240px] max-w-full shrink-0">
                      <ChessBoard
                        fen={data.pivotalMoment.fen}
                        interactive={false}
                        showLegal={false}
                        showCoords={false}
                        theme={profile?.theme ?? 'green'}
                      />
                    </div>
                    <div className="min-w-0 text-sm">
                      <p>
                        The move{' '}
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider">
                          {data.pivotalMoment.san}
                        </span>{' '}
                        threw away{' '}
                        <span className="font-bold text-destructive">{(data.pivotalMoment.lossCp / 100).toFixed(1)} pawns</span>.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        The largest single eval drop Game review found in your year.
                      </p>
                      <Button variant="secondary" size="sm" className="mt-2" onClick={() => openInAnalysis(data.pivotalMoment!.fen)}>
                        <Swords className="h-4 w-4" aria-hidden />
                        Replay it in analysis
                      </Button>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* milestones */}
              {data.milestones.length > 0 ? (
                <section aria-label="Milestones">
                  <Micro>Milestones</Micro>
                  <ul className="mt-2 space-y-1.5">
                    {data.milestones.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">
                Built only from what this account stored: recorded games, the reports you ran, activity days and lessons. No estimates, no filler.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
