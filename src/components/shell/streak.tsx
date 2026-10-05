// Shared activity pieces: the daily-goal card and the streak calendar.
'use client'

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { dayKeyLocal, dayKeyShift } from '@/lib/day'
import { Progress } from '@/components/ui/progress'
import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActivityRow {
  id: string
  minutes: number
  puzzlesSolved: number
  lessonSteps: number
  gamesPlayed: number
  goalMet: boolean
}

export interface ActivityData {
  days: ActivityRow[]
  today: ActivityRow | null
  streaks: { current: number; best: number }
  goalMinutes: number
}

export function useActivity(enabled = true): ActivityData | null {
  const [data, setData] = useState<ActivityData | null>(null)
  const { view } = useApp()
  useEffect(() => {
    if (!enabled) return
    fetch(`/api/activity?day=${dayKeyLocal()}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [enabled, view.name])
  return data
}

/** Square grid of the last `weeks` weeks, oldest first. */
export function StreakCalendar({ days, goalMinutes, weeks }: { days: ActivityRow[]; goalMinutes: number; weeks: number }) {
  const byKey = new Map(days.map((d) => [d.id, d]))
  const today = dayKeyLocal()
  const total = weeks * 7
  // align: end the grid on today's weekday slot so columns are weeks
  const keys: string[] = []
  for (let i = total - 1; i >= 0; i--) keys.push(dayKeyShift(today, -i))
  const columns: string[][] = []
  for (let i = 0; i < keys.length; i += 7) columns.push(keys.slice(i, i + 7))

  return (
    <div className="flex gap-1 overflow-x-auto">
      {columns.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {col.map((k) => {
            const row = byKey.get(k)
            const future = k > today
            return (
              <div
                key={k}
                title={
                  future
                    ? k
                    : row
                      ? `${k}: ${row.minutes} active min, ${row.puzzlesSolved} puzzles, ${row.lessonSteps} lesson steps, ${row.gamesPlayed} games`
                      : `${k}: no activity`
                }
                className={cn(
                  'h-3 w-3 rounded-[3px]',
                  future && 'bg-transparent',
                  !future && !row && 'bg-muted',
                  row && !row.goalMet && 'bg-primary/30',
                  row?.goalMet && 'bg-primary',
                )}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Home card: today's goal progress and the current streak. */
export function GoalCard() {
  const data = useActivity()
  const { navigate } = useApp()
  if (!data) return null
  const today = data.today
  const minutes = today?.minutes ?? 0
  const pct = Math.min(100, Math.round((minutes / Math.max(1, data.goalMinutes)) * 100))
  return (
    <button
      className="pressable flex h-full w-full flex-col rounded-lg bg-card p-6 text-left shadow-sm hover:shadow-md"
      onClick={() => navigate('profile')}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Daily goal</h2>
        <div className="flex items-center gap-1.5 text-lg font-extrabold">
          <Flame className="h-5 w-5 text-[#e6a82c]" />
          {data.streaks.current}
          <span className="text-xs font-semibold text-muted-foreground">day streak</span>
        </div>
      </div>
      <Progress value={pct} className="h-2.5" />
      <div className="mt-2 text-sm text-muted-foreground">
        {minutes} of {data.goalMinutes} active minutes today
        {today?.goalMet ? ' · goal met' : ''}
      </div>
      <div className="mt-auto pt-3">
        <StreakCalendar days={data.days} goalMinutes={data.goalMinutes} weeks={5} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Best streak: {data.streaks.best} {data.streaks.best === 1 ? 'day' : 'days'}
      </div>
    </button>
  )
}
