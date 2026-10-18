'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, overallRating } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ALL_LEVELS } from '@/content/levels'
import { isLevelUnlocked, nextUnlockedId } from '@/lib/unlock'
import { potentialElo, titleForXp } from '@/lib/rating'
import { BOTS } from '@/lib/chess/bots'
import { GoalCard } from '@/components/shell/streak'
import { ChessDnaCard } from '@/components/views/chess-dna-card'
import { GlobeSection } from '@/components/chess/chess-globe'
import { cn } from '@/lib/utils'
import {
  Swords,
  GraduationCap,
  MessageSquareText,
  Target,
  CalendarDays,
  ChevronRight,
  RotateCcw,
  ListChecks,
  Shield,
  Repeat2,
  Check,
} from 'lucide-react'

interface GameRow {
  id: string
  kind?: 'bot' | 'online'
  pool?: string | null
  color: string
  opponent: string
  result: string
  reason: string
  rated: boolean
  ratingDelta: number | null
  createdAt: string
}

/** One shared card style so every home block lines up. */
const CARD = 'rounded-lg bg-card p-6 shadow-sm'

/** zeechess-style section eyebrow: a tiny mono index line above card titles. */
function eyebrowEl(text: string) {
  return <span aria-hidden="true" className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/60">{text}</span>
}

// ------------------------------ Today's Plan --------------------------------

interface PlanSlot {
  id: string
  title: string
  detail: string
  view: 'review' | 'puzzles'
  done: boolean
}

interface PlanSection {
  key: 'blunderFix' | 'blunderShield' | 'woodpecker'
  label: string
  slots: PlanSlot[]
}

/** Weakest Chess DNA domain, spotlighted by the plan when it is measurable. */
interface PlanFocus {
  domain: string
  label: string
  score: number | null
  tip: string | null
  view: 'review' | 'puzzles' | 'tools'
  arg?: string
}

interface PlanData {
  dayKey: string
  target: number
  doneCount: number
  sections: PlanSection[]
  focus: PlanFocus | null
}

const PLAN_SECTION_ICONS: Record<PlanSection['key'], typeof Target> = {
  blunderFix: Target,
  blunderShield: Shield,
  woodpecker: Repeat2,
}

/**
 * The chessigma loop at a glance: fix your own misses, shield against your
 * recurring traps, sharpen the woodpecker sets, take the daily shot. Every
 * slot is derived from the player's own data — sections shrink honestly when
 * there is nothing to train. Pending chips jump to the view where that work
 * lives; done slots strike through in green.
 */
function TodaysPlanCard({ dayKey }: { dayKey: string }) {
  const { navigate } = useApp()
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/plan?day=${dayKey}`)
      .then((r) => readJson<PlanData>(r))
      .then((d) => {
        setPlan(d)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [dayKey])

  useEffect(() => {
    load()
  }, [load])

  function refreshPlan() {
    setRefreshing(true)
    fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', dayKey }),
    })
      .then((r) => readJson<PlanData>(r))
      .then((d) => {
        setPlan(d)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setRefreshing(false))
  }

  const totalSlots = plan?.sections.reduce((n, s) => n + s.slots.length, 0) ?? 0

  return (
    <section className={CARD} aria-label="Today's Plan">
      <div>
        {eyebrowEl("00 / Today's plan")}
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Today&apos;s Plan</h2>
          </div>
          <div className="flex items-center gap-2">
            {plan && totalSlots > 0 && (
              <span className="text-sm font-extrabold tabular-nums" aria-label={`${plan.doneCount} of ${plan.target} done`}>
                {plan.doneCount} / {plan.target}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={refreshPlan}
              disabled={refreshing}
              aria-label="Rebuild today's plan from your latest data"
              title="Rebuild from your latest data"
            >
              <RotateCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>

      {plan && totalSlots > 0 && (
        <Progress
          value={Math.min(100, (plan.doneCount / Math.max(1, plan.target)) * 100)}
          className="mt-3 h-1.5"
          aria-label={`${plan.doneCount} of ${plan.target} plan slots done`}
        />
      )}

      {plan?.focus && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-primary/25 bg-primary/10 px-3.5 py-3">
          <div className="min-w-0 text-xs">
            <p className="font-bold text-primary">
              DNA focus · {plan.focus.label}
              {plan.focus.score != null && <span className="tabular-nums"> · {plan.focus.score}/100</span>}
            </p>
            {plan.focus.tip && <p className="mt-0.5 leading-relaxed text-muted-foreground">{plan.focus.tip}</p>}
          </div>
          <button
            onClick={() => navigate(plan.focus!.view, plan.focus!.arg)}
            className="inline-flex min-h-9 shrink-0 items-center rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            aria-label={`Go train ${plan.focus.label.toLowerCase()} — your weakest domain`}
          >
            Train it <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading today's plan">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
              <div className="flex flex-1 flex-wrap gap-1.5">
                <div className="h-9 w-32 animate-pulse rounded-md bg-secondary motion-reduce:animate-none" />
                <div className="h-9 w-28 animate-pulse rounded-md bg-secondary motion-reduce:animate-none" />
                <div className="h-9 w-36 animate-pulse rounded-md bg-secondary motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-destructive">Could not load your plan.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(false)
              load()
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : !plan || totalSlots === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Play or import a few games — your plan is built from your own misses.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {plan.sections.map((section) => {
            const Icon = PLAN_SECTION_ICONS[section.key]
            return (
              <div key={section.key} className="grid gap-1.5 sm:grid-cols-[9.5rem_1fr] sm:items-start sm:gap-3">
                <div className="flex items-center gap-1.5 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {section.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {section.slots.length === 0 ? (
                    <span className="inline-flex items-center rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                      Nothing queued — good.
                    </span>
                  ) : (
                    section.slots.map((slot) =>
                      slot.done ? (
                        <span
                          key={slot.id}
                          title={slot.detail}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary"
                        >
                          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="line-through opacity-80">{slot.title}</span>
                        </span>
                      ) : (
                        <button
                          key={slot.id}
                          onClick={() => navigate(slot.view)}
                          title={slot.detail}
                          aria-label={`${slot.title} — open it`}
                          className="inline-flex min-h-9 max-w-full items-center rounded-md bg-secondary px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-accent"
                        >
                          <span className="truncate">{slot.title}</span>
                        </button>
                      ),
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function HomeView() {
  const { navigate, profile, ratings } = useApp()
  const elo = overallRating(ratings)
  const potential = profile
    ? potentialElo({
        botElo: profile.botElo,
        botGames: profile.botEloGames,
        puzzleRating: profile.puzzleRating,
        puzzleCount: profile.puzzleCount,
      })
    : null
  const [progress, setProgress] = useState<{ lessonId: string; completed: boolean; stepsDone: number; totalSteps: number; updatedAt?: string }[]>([])
  const [progressError, setProgressError] = useState(false)
  const [games, setGames] = useState<GameRow[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [gamesError, setGamesError] = useState(false)
  const [dailyDone, setDailyDone] = useState<boolean | null>(null)
  const { dayKey, dailyDate } = useMemo(
    () => ({
      dayKey: new Date().toLocaleDateString('sv-SE'),
      dailyDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    }),
    // refreshed on every mount of the view
    [],
  )

  const loadProgress = useCallback(() => {
    fetch('/api/progress')
      .then((r) => readJson<{ progress?: { lessonId: string; completed: boolean; stepsDone: number; totalSteps: number; updatedAt?: string }[] }>(r))
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => setProgressError(true))
  }, [])

  function retryProgress() {
    setProgressError(false)
    loadProgress()
  }

  const loadGames = useCallback(() => {
    fetch('/api/games?limit=5')
      .then((r) => readJson<{ games?: GameRow[] }>(r))
      .then((d) => {
        setGames(d.games ?? [])
        setGamesLoading(false)
      })
      .catch(() => {
        setGamesError(true)
        setGamesLoading(false)
      })
  }, [])

  function retryGames() {
    setGamesLoading(true)
    setGamesError(false)
    loadGames()
  }

  useEffect(() => {
    loadProgress()
    loadGames()
    fetch(`/api/puzzles/daily?day=${dayKey}`)
      .then((r) => readJson<{ completed?: boolean }>(r))
      .then((d) => setDailyDone(Boolean(d.completed)))
      .catch(() => {})
  }, [loadProgress, loadGames, dayKey])

  if (!profile) return null

  const completed = new Set(progress.filter((p) => p.completed).map((p) => p.lessonId))
  const started = progress.filter((p) => !p.completed && p.stepsDone > 0)
  const mostRecent = started.length
    ? started.reduce((a, b) => ((a.updatedAt ?? '') > (b.updatedAt ?? '') ? a : b))
    : null
  // keep pointing at the most recent started lesson only while it is still
  // open; a stale start in a now locked level falls back to the next unlocked
  // (the self-assessment steers a fresh student's anchor the same way the
  // coach and the Study do: Intermediate onboarding means Intermediate start)
  const nextId =
    mostRecent && isLevelUnlocked(mostRecent.lessonId, completed)
      ? mostRecent.lessonId
      : nextUnlockedId(completed, profile.skillLevel)
  const nextLesson = ALL_LEVELS.find((l) => l.level.id === nextId)
  const doneCount = completed.size
  const totalLessons = ALL_LEVELS.length
  const lessonPct = totalLessons ? Math.round((doneCount / totalLessons) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      {/* header: identity left, three equal stat chips right */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{profile.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {titleForXp(profile.xp)} · {profile.xp} XP ·{' '}
            {progressError ? 'progress unavailable' : `${doneCount}/${totalLessons} lessons done`}
          </p>
        </div>
        <div className="flex gap-2 text-center">
          <div
            className="min-w-20 rounded-lg bg-card px-4 py-2 shadow-sm"
            title={elo ? (elo.games < 5 ? `${elo.rating} Elo, provisional: it sharpens as rated games come in` : `${elo.rating} Elo`) : 'Play a rated game to get an Elo'}
          >
            <div className="text-lg font-extrabold leading-6 tabular-nums">
              {elo ? (
                <>
                  {elo.rating}
                  {elo.games < 5 && <span className="text-muted-foreground">?</span>}
                </>
              ) : (
                '-'
              )}
            </div>
            <div className="text-[11px] leading-4 text-muted-foreground">Elo</div>
          </div>
          <div className="min-w-20 rounded-lg bg-card px-4 py-2 shadow-sm">
            <div className="text-lg font-extrabold leading-6 tabular-nums">{potential ? `~${potential.value}` : '-'}</div>
            <div className="text-[11px] leading-4 text-muted-foreground">Potential</div>
          </div>
          <div className="min-w-20 rounded-lg bg-card px-4 py-2 shadow-sm">
            <div className="text-lg font-extrabold leading-6 tabular-nums">{profile.puzzleRating ?? '-'}</div>
            <div className="text-[11px] leading-4 text-muted-foreground">Puzzles</div>
          </div>
        </div>
      </div>

      {/* Today's plan: the chessigma loop built from the player's own misses */}
      <TodaysPlanCard dayKey={dayKey} />

      {/* Chess DNA: the seven-domain report built from the player's analyzed games */}
      <ChessDnaCard />

      {/* one grid for all five cards: equal gaps, equal row heights, no stray notches */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Continue learning */}
        <section className={`${CARD} flex flex-col md:col-span-2`}>
          <div>
            {eyebrowEl('02 / Study')}
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Continue learning</h2>
            </div>
          </div>
          {progressError ? (
            <>
              <p className="mt-3 text-sm text-destructive">Could not load your progress.</p>
              <div className="mt-auto pt-4">
                <Button variant="secondary" onClick={retryProgress}>
                  <RotateCcw className="h-4 w-4" /> Retry
                </Button>
              </div>
            </>
          ) : nextLesson ? (
            <>
              <div className="mt-3 text-sm font-semibold">
                {nextLesson.tier.title} · Level {nextLesson.level.n}: {nextLesson.level.title}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{nextLesson.level.subtitle}</p>
              <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
                <Button className="btn-hero px-6" onClick={() => navigate('lesson', nextLesson.level.id)}>
                  {doneCount === 0 ? 'First lesson' : 'Resume'} <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="min-w-40 flex-1">
                  <Progress value={lessonPct} className="h-2" />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {doneCount} of {totalLessons} lessons complete
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Every lesson is done. Replay any of them from the Lessons tab, or test yourself online.
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
                <Button className="btn-hero px-6" onClick={() => navigate('lessons')}>
                  Browse lessons <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="min-w-40 flex-1">
                  <Progress value={100} className="h-2" />
                  <div className="mt-1.5 text-xs text-muted-foreground">{totalLessons} of {totalLessons} lessons complete</div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Daily goal + streak */}
        <GoalCard />

        {/* Daily puzzle */}
        <button className={`${CARD} pressable flex flex-col text-left hover:shadow-md`} onClick={() => navigate('puzzles')}>
          <div>
            {eyebrowEl('03 / Puzzle')}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Daily puzzle</h2>
            </div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">{dailyDate}</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-muted-foreground" />
            {dailyDone === null ? 'Loading…' : dailyDone ? 'Solved. Come back tomorrow' : 'Ready. Take your shot'}
          </div>
          <div className="mt-auto pt-3 text-xs text-muted-foreground">
            One a day, chosen from the full pool. Rated.
          </div>
        </button>

        {/* Play */}
        <button className={`${CARD} pressable flex flex-col text-left hover:shadow-md`} onClick={() => navigate('play')}>
          <div>
            {eyebrowEl('04 / Play')}
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Play</h2>
            </div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            Rated online games move your Elo. Or practice casually against {BOTS.length} bot characters, est. 350 to 2600.
          </div>
          <div className="mt-auto pt-3 text-sm font-semibold text-primary">
            {(() => {
              if (!elo || elo.games === 0) return 'Play a rated game to start your Elo'
              return `Your Elo: ${elo.rating} (${elo.games} rated ${elo.games === 1 ? 'game' : 'games'})`
            })()}
          </div>
        </button>

        {/* Coach */}
        <button className={`${CARD} pressable flex flex-col text-left hover:shadow-md`} onClick={() => navigate('coach')}>
          <div>
            {eyebrowEl('05 / Coach')}
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Coach</h2>
            </div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            Ask anything about your games and positions. Works with the built-in model or your own API key.
          </div>
          <div className="mt-auto pt-3 text-sm font-semibold text-primary">
            Finish a game, then ask the coach why
          </div>
        </button>
      </div>

      {/* Recent games */}
      <section className="rounded-lg bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <h2 className="font-display text-lg font-bold">Recent games</h2>
          <button className="inline-flex min-h-11 items-center rounded px-3 py-2 text-sm font-semibold text-primary" onClick={() => navigate('profile')}>
            Full history
          </button>
        </div>
        {gamesLoading ? (
          <div className="space-y-2 px-6 py-4" role="status" aria-label="Loading recent games">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            ))}
          </div>
        ) : gamesError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm">
            <span className="text-muted-foreground">Could not load recent games.</span>
            <Button variant="secondary" size="sm" onClick={retryGames}>
              <RotateCcw className="h-4 w-4" /> Retry
            </Button>
          </div>
        ) : games.length === 0 ? (
          <div className="px-6 py-6 text-sm text-muted-foreground">
            No games yet. The bots are waiting.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {games.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      g.result === 'win' ? 'bg-primary' : g.result === 'loss' ? 'bg-destructive' : 'bg-muted-foreground'
                    }`}
                  />
                  <span className="font-semibold">
                    {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'} vs {g.opponent}
                  </span>
                  {g.kind === 'online' && g.rated && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">rated</span>
                  )}
                  <span className="hidden truncate text-muted-foreground sm:inline">{g.reason}</span>
                  {g.rated && g.ratingDelta != null && (
                    <span className={g.ratingDelta >= 0 ? 'text-primary' : 'text-destructive'}>
                      {g.ratingDelta >= 0 ? '+' : ''}
                      {g.ratingDelta}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live chess around the world (lichess TV visualization) */}
      <GlobeSection />
    </div>
  )
}
