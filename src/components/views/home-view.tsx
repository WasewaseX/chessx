'use client'
import { readJson } from '@/lib/api-client'

import { useEffect, useMemo, useState } from 'react'
import { useApp, overallRating } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ALL_LEVELS } from '@/content/levels'
import { isLevelUnlocked, nextUnlockedId } from '@/lib/unlock'
import { potentialElo, titleForXp } from '@/lib/rating'
import { GoalCard } from '@/components/shell/streak'
import {
  Swords,
  GraduationCap,
  MessageSquareText,
  Target,
  CalendarDays,
  ChevronRight,
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
  const [games, setGames] = useState<GameRow[]>([])
  const [dailyDone, setDailyDone] = useState<boolean | null>(null)
  const { dayKey, dailyDate } = useMemo(
    () => ({
      dayKey: new Date().toLocaleDateString('sv-SE'),
      dailyDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    }),
    // refreshed on every mount of the view
    [],
  )

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => readJson<unknown>(r))
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => {})
    fetch('/api/games?limit=5')
      .then((r) => readJson<unknown>(r))
      .then((d) => setGames(d.games ?? []))
      .catch(() => {})
    fetch(`/api/puzzles/daily?day=${dayKey}`)
      .then((r) => readJson<unknown>(r))
      .then((d) => setDailyDone(Boolean(d.completed)))
      .catch(() => {})
  }, [])

  if (!profile) return null

  const completed = new Set(progress.filter((p) => p.completed).map((p) => p.lessonId))
  const started = progress.filter((p) => !p.completed && p.stepsDone > 0)
  const mostRecent = started.length
    ? started.reduce((a, b) => ((a.updatedAt ?? '') > (b.updatedAt ?? '') ? a : b))
    : null
  // keep pointing at the most recent started lesson only while it is still
  // open; a stale start in a now locked level falls back to the next unlocked
  const nextId =
    mostRecent && isLevelUnlocked(mostRecent.lessonId, completed)
      ? mostRecent.lessonId
      : nextUnlockedId(completed)
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
            {titleForXp(profile.xp)} · {profile.xp} XP · {doneCount}/{totalLessons} lessons done
          </p>
        </div>
        <div className="flex gap-2 text-center">
          <div className="min-w-20 rounded-lg bg-card px-4 py-2 shadow-sm">
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

      {/* one grid for all five cards: equal gaps, equal row heights, no stray notches */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Continue learning */}
        <section className={`${CARD} flex flex-col md:col-span-2`}>
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">
              {doneCount === 0 ? 'Start here' : doneCount === totalLessons ? 'All lessons complete' : 'Continue learning'}
            </h2>
          </div>
          {nextLesson ? (
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
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Daily puzzle</h2>
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
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Play</h2>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            Rated online games move your Elo. Or practice casually against fourteen bot characters, est. 350 to 2600.
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
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Coach</h2>
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
          <button className="text-sm font-semibold text-primary" onClick={() => navigate('profile')}>
            Full history
          </button>
        </div>
        {games.length === 0 ? (
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
    </div>
  )
}
