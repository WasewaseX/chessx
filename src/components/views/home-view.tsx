'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ALL_LEVELS } from '@/content/levels'
import { titleForXp } from '@/lib/rating'
import { GoalCard } from '@/components/shell/streak'
import {
  Swords,
  GraduationCap,
  MessageSquareText,
  Flame,
  Target,
  CalendarDays,
  ChevronRight,
} from 'lucide-react'

interface GameRow {
  id: string
  color: string
  botName: string
  botLevel: number
  result: string
  reason: string
  rated: boolean
  ratingDelta: number | null
  createdAt: string
}

function nextLessonId(completed: Set<string>): string | null {
  for (const { level } of ALL_LEVELS) {
    if (!completed.has(level.id)) return level.id
  }
  return null
}

export function HomeView() {
  const { navigate, profile, ratings } = useApp()
  const [progress, setProgress] = useState<{ lessonId: string; completed: boolean; stepsDone: number; totalSteps: number }[]>([])
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
      .then((r) => r.json())
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => {})
    fetch('/api/games?limit=5')
      .then((r) => r.json())
      .then((d) => setGames(d.games ?? []))
      .catch(() => {})
    fetch(`/api/puzzles/daily?day=${dayKey}`)
      .then((r) => r.json())
      .then((d) => setDailyDone(Boolean(d.completed)))
      .catch(() => {})
  }, [])

  if (!profile) return null

  const completed = new Set(progress.filter((p) => p.completed).map((p) => p.lessonId))
  const started = progress.filter((p) => !p.completed && p.stepsDone > 0)
  const mostRecent = started.length
    ? started.reduce((a, b) => ((a.updatedAt ?? '') > (b.updatedAt ?? '') ? a : b))
    : null
  const nextId = mostRecent?.lessonId ?? nextLessonId(completed)
  const nextLesson = ALL_LEVELS.find((l) => l.level.id === nextId)
  const doneCount = completed.size
  const totalLessons = ALL_LEVELS.length

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{profile.name}</h1>
          <p className="text-sm text-muted-foreground">
            {titleForXp(profile.xp)} · {profile.xp} XP · {doneCount}/{totalLessons} lessons done
          </p>
        </div>
        <div className="flex gap-2 text-center">
          <div className="rounded-md bg-card px-4 py-2 shadow-sm">
            <div className="text-lg font-extrabold leading-5">
              {(ratings.find((r) => r.pool === 'blitz')?.rating ?? 1000).toString()}
            </div>
            <div className="text-[11px] text-muted-foreground">Blitz rating</div>
          </div>
          <div className="rounded-md bg-card px-4 py-2 shadow-sm">
            <div className="text-lg font-extrabold leading-5">
              {profile.puzzleRating ?? '-'}
            </div>
            <div className="text-[11px] text-muted-foreground">Puzzle rating</div>
          </div>
          <div className="rounded-md bg-card px-4 py-2 shadow-sm">
            <div className="flex items-center justify-center gap-1 text-lg font-extrabold leading-5">
              <Flame className="h-4 w-4 text-[#e6a82c]" />
              {profile.puzzleStreak}
            </div>
            <div className="text-[11px] text-muted-foreground">Puzzle streak</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Continue learning */}
        <div className="rounded-lg bg-card p-5 shadow-sm md:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">
              {doneCount === 0 ? 'Start here' : doneCount === totalLessons ? 'All lessons complete' : 'Continue learning'}
            </h2>
          </div>
          {nextLesson ? (
            <>
              <div className="text-sm font-semibold">
                {nextLesson.tier.title} · Level {nextLesson.level.n}: {nextLesson.level.title}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{nextLesson.level.subtitle}</p>
              <Button className="btn-hero mt-4 px-6" onClick={() => navigate('lesson', nextLesson.level.id)}>
                {doneCount === 0 ? 'First lesson' : 'Resume'} <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Every lesson is done. Replay any of them from the Lessons tab, or test yourself online.
            </p>
          )}
        </div>

        {/* Daily goal + streak */}
        <GoalCard />

      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Daily puzzle */}
        <button
          className="pressable rounded-lg bg-card p-5 text-left shadow-sm hover:shadow-md"
          onClick={() => navigate('puzzles')}
        >
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Daily puzzle</h2>
          </div>
          <div className="text-sm text-muted-foreground">{dailyDate}</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-muted-foreground" />
            {dailyDone === null ? 'Loading…' : dailyDone ? 'Solved. Come back tomorrow' : 'Ready. Take your shot'}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            One a day, chosen from the full pool. Rated.
          </div>
        </button>

        {/* Play */}
        <button
          className="pressable rounded-lg bg-card p-5 text-left shadow-sm hover:shadow-md"
          onClick={() => navigate('play')}
        >
          <div className="mb-3 flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Play</h2>
          </div>
          <div className="text-sm text-muted-foreground">
            Rated online games in bullet, blitz and rapid. Or practice casually against fourteen bot characters, est. 350 to 2600.
          </div>
          <div className="mt-3 text-sm font-semibold text-primary">
            {ratings.length > 0
              ? `Your blitz: ${ratings.find((r) => r.pool === 'blitz')?.rating ?? 1000} (${ratings.find((r) => r.pool === 'blitz')?.games ?? 0} games)`
              : 'Play a rated game to start your rating'}
          </div>
        </button>

        {/* Coach */}
        <button
          className="pressable rounded-lg bg-card p-5 text-left shadow-sm hover:shadow-md"
          onClick={() => navigate('coach')}
        >
          <div className="mb-3 flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Coach</h2>
          </div>
          <div className="text-sm text-muted-foreground">
            Ask anything about your games and positions. Works with the built-in model or your own API key.
          </div>
        </button>
      </div>

      {/* Recent games */}
      <div className="mt-6 rounded-lg bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg font-bold">Recent games</h2>
          <button className="text-sm font-semibold text-primary" onClick={() => navigate('profile')}>
            Full history
          </button>
        </div>
        {games.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            No games yet. The bots are waiting.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {games.map((g) => (
              <div key={g.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      g.result === 'win' ? 'bg-primary' : g.result === 'loss' ? 'bg-destructive' : 'bg-muted-foreground'
                    }`}
                  />
                  <span className="font-semibold">
                    {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'} vs {g.botName}
                  </span>
                  <span className="text-muted-foreground">{g.reason}</span>
                  {g.rated && g.ratingDelta != null && (
                    <span className={g.ratingDelta >= 0 ? 'text-primary' : 'text-destructive'}>
                      {g.ratingDelta >= 0 ? '+' : ''}
                      {g.ratingDelta}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
