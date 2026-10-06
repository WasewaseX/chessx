'use client'
import { readJson } from '@/lib/api-client'

import { useEffect, useState } from 'react'
import { useApp, overallRating } from '@/lib/store'
import { ALL_LEVELS, TIERS } from '@/content/levels'
import { potentialElo, tcLabel, titleForXp } from '@/lib/rating'
import { Progress } from '@/components/ui/progress'
import { useActivity, StreakCalendar } from '@/components/shell/streak'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'

interface GameRow {
  id: string
  kind?: 'bot' | 'online'
  pool?: string | null
  initialSec?: number | null
  incSec?: number | null
  color: string
  opponent: string
  result: string
  reason: string
  rated: boolean
  ratingDelta: number | null
  createdAt: string
}

export function ProfileView() {
  const { profile, patchProfile, ratings } = useApp()
  const elo = overallRating(ratings)
  const [games, setGames] = useState<GameRow[]>([])
  const [progress, setProgress] = useState<{ lessonId: string; completed: boolean; stepsDone: number }[]>([])
  const activity = useActivity()

  useEffect(() => {
    fetch('/api/games?limit=50')
      .then((r) => readJson<unknown>(r))
      .then((d) => setGames(d.games ?? []))
      .catch(() => {})
    fetch('/api/progress')
      .then((r) => readJson<unknown>(r))
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => {})
  }, [])

  async function setGoal(goal: number) {
    if (!profile) return
    patchProfile({ goalMinutes: goal })
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalMinutes: goal }),
      })
      const d = await res.json()
      if (d.profile) patchProfile(d.profile)
    } catch {
      /* keep optimistic value */
    }
  }

  if (!profile) return null

  const wins = games.filter((g) => g.result === 'win').length
  const losses = games.filter((g) => g.result === 'loss').length
  const draws = games.filter((g) => g.result === 'draw').length
  const total = wins + losses + draws
  const winRate = total ? Math.round((wins / total) * 100) : null
  const completedLessons = progress.filter((p) => p.completed).length
  const totalLessons = ALL_LEVELS.length
  const puzzleTotal = profile.puzzleSolved + profile.puzzleFailed
  const solveRate = puzzleTotal ? Math.round((profile.puzzleSolved / puzzleTotal) * 100) : null
  const potential = potentialElo({
    botElo: profile.botElo,
    botGames: profile.botEloGames,
    puzzleRating: profile.puzzleRating,
    puzzleCount: profile.puzzleCount,
  })

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary font-display text-2xl font-extrabold text-white">
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-2xl font-extrabold">{profile.name}</h1>
          <p className="text-sm text-muted-foreground">
            {titleForXp(profile.xp)} · {profile.xp} XP ·{' '}
            {profile.skillLevel[0].toUpperCase() + profile.skillLevel.slice(1)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Elo"
          value={elo ? `${elo.rating}${elo.games < 5 ? '?' : ''}` : '-'}
          sub={(() => {
            if (!elo || elo.games === 0) return 'Rated online games only. Seeded from your level'
            return `${elo.games} rated ${elo.games === 1 ? 'game' : 'games'} · ${elo.wins}W ${elo.losses}L ${elo.draws}D`
          })()}
        />
        <StatCard
          label="Potential"
          value={potential ? `~${potential.value}` : '-'}
          sub={
            potential
              ? `Estimated from ${potential.from}`
              : 'Play bot games or puzzles to get an estimate'
          }
        />
        <StatCard
          label="Puzzle rating"
          value={profile.puzzleRating ?? '-'}
          sub={profile.puzzleCount < 10 && profile.puzzleRating ? 'Provisional' : profile.puzzleRating ? `${profile.puzzleCount} rated puzzles` : 'Solve a puzzle to get rated'}
        />
        <StatCard label="Puzzle streak" value={profile.puzzleStreak} sub={`Best: ${profile.bestPuzzleStreak}`} />
        <StatCard label="Games" value={total} sub={winRate != null ? `${winRate}% won` : 'No games yet'} />
      </div>

      {/* Daily goal, streak calendar, rush bests */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold">Daily goal</h2>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-display text-3xl font-extrabold">
              <Zap className="h-6 w-6 text-primary" />
              {activity?.streaks.current ?? 0}
            </div>
            <div className="text-sm text-muted-foreground">
              day streak
              <br />
              best: {activity?.streaks.best ?? 0}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">Goal: {profile.goalMinutes} active minutes a day</div>
            <div className="flex flex-wrap gap-2">
              {[10, 15, 30, 45, 60].map((g) => (
                <button
                  key={g}
                  onClick={() => void setGoal(g)}
                  aria-pressed={profile.goalMinutes === g}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-semibold transition-all duration-150 active:scale-95',
                    profile.goalMinutes === g
                      ? 'border-primary bg-primary/15'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  {g} min
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Active minutes are counted while you actually play, solve or study. Idle time never counts.
            </p>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">Last 12 weeks</div>
            {activity ? <StreakCalendar days={activity.days} goalMinutes={activity.goalMinutes} weeks={12} /> : null}
          </div>
        </div>

        <div className="rounded-lg bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold">Puzzle Rush</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-md bg-secondary/60 p-4">
              <div className="font-display text-2xl font-extrabold text-primary">{profile.rushBest3m}</div>
              <div className="text-xs text-muted-foreground">3 minute best</div>
            </div>
            <div className="rounded-md bg-secondary/60 p-4">
              <div className="font-display text-2xl font-extrabold text-primary">{profile.rushBestSurvival}</div>
              <div className="text-xs text-muted-foreground">Survival best</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Rush lives in the Puzzles tab. The 3 minute run scores as many solves as the clock allows, survival ends at three misses.
          </p>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Puzzles solved all time</span>
              <span className="font-semibold">{profile.puzzleSolved}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Puzzles missed all time</span>
              <span className="font-semibold">{profile.puzzleFailed}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold">Lessons</h2>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold">
                {completedLessons}/{totalLessons} complete
              </span>
              <span className="text-muted-foreground">
                {totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0}%
              </span>
            </div>
            <Progress value={totalLessons ? (completedLessons / totalLessons) * 100 : 0} />
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            {TIERS.map((t) => {
              const done = t.levels.filter((les) => progress.find((p) => p.lessonId === les.id)?.completed).length
              return (
                <div key={t.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.color }} />
                    Tier {t.n} · {t.title}
                  </span>
                  <span className="font-semibold">
                    {done}/{t.levels.length}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-lg bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold">Puzzles</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="font-display text-2xl font-extrabold text-primary">{profile.puzzleSolved}</div>
              <div className="text-xs text-muted-foreground">Solved</div>
            </div>
            <div>
              <div className="font-display text-2xl font-extrabold text-destructive">{profile.puzzleFailed}</div>
              <div className="text-xs text-muted-foreground">Missed</div>
            </div>
            <div>
              <div className="font-display text-2xl font-extrabold">{solveRate != null ? `${solveRate}%` : '-'}</div>
              <div className="text-xs text-muted-foreground">Solve rate</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current streak</span>
              <span className="font-semibold">{profile.puzzleStreak}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Best streak</span>
              <span className="font-semibold">{profile.bestPuzzleStreak}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily puzzles done</span>
              <span className="font-semibold">{profile.dailyDoneDate ? 'Today' : 'Not yet today'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-card shadow-sm">
        <div className="border-b border-border px-6 py-3">
          <h2 className="font-display text-lg font-bold">Game history</h2>
        </div>
        {games.length === 0 ? (
          <div className="px-6 py-6 text-sm text-muted-foreground">No games played yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {games.map((g) => (
              <div key={g.id} className="flex items-center justify-between px-6 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
                      g.result === 'win' ? 'bg-primary' : g.result === 'loss' ? 'bg-destructive' : 'bg-muted-foreground',
                    )}
                  />
                  <span className="font-semibold">
                    {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'} as {g.color === 'w' ? 'White' : 'Black'}
                  </span>
                  <span className="truncate text-muted-foreground">vs {g.opponent}</span>
                  {g.kind === 'online' && g.rated && g.initialSec != null && (
                    <span className="hidden rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground sm:inline">
                      {tcLabel(g.initialSec, g.incSec ?? 0)}
                    </span>
                  )}
                  <span className="hidden text-xs text-muted-foreground sm:inline">by {g.reason}</span>
                  {g.rated && g.ratingDelta != null && (
                    <span className={g.ratingDelta >= 0 ? 'font-semibold text-primary' : 'font-semibold text-destructive'}>
                      {g.ratingDelta >= 0 ? '+' : ''}
                      {g.ratingDelta}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-extrabold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
