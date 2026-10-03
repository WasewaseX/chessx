'use client'

import { useEffect, useMemo, useState } from 'react'
import { TIERS } from '@/content/levels'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Check, ChevronRight, Clock, Lock, Play } from 'lucide-react'

interface ProgressRow {
  lessonId: string
  completed: boolean
  stepsDone: number
  totalSteps: number
}

export function LessonsView() {
  const { navigate } = useApp()
  const [progress, setProgress] = useState<ProgressRow[]>([])

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => {})
  }, [])

  const byId = useMemo(() => new Map(progress.map((p) => [p.lessonId, p])), [progress])
  const doneCount = progress.filter((p) => p.completed).length
  const totalLessons = TIERS.reduce((n, t) => n + t.levels.length, 0)

  // first uncompleted level is the recommended next one
  const nextId = useMemo(() => {
    for (const tier of TIERS) {
      for (const level of tier.levels) {
        if (!byId.get(level.id)?.completed) return level.id
      }
    }
    return null
  }, [byId])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Lessons</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doneCount}/{totalLessons} levels done. Six tiers, twenty levels each: every level is a short interactive workout, not a textbook.
          </p>
        </div>
        {nextId && (
          <button
            onClick={() => navigate('lesson', nextId)}
            className="btn-hero inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm"
          >
            <Play className="h-4 w-4" /> Continue
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {TIERS.map((tier) => {
        const tierDone = tier.levels.filter((l) => byId.get(l.id)?.completed).length
        const pct = Math.round((tierDone / tier.levels.length) * 100)
        return (
          <section key={tier.id} className="mt-8">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-display text-lg font-extrabold text-white shadow-sm"
                style={{ background: tier.color }}
              >
                {tier.n}
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">{tier.title}</h2>
                <p className="truncate text-sm text-muted-foreground">{tier.tagline}</p>
              </div>
              <div className="ml-auto w-28 text-right">
                <div className="text-sm font-bold">{tierDone}/{tier.levels.length}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tier.color }} />
                </div>
              </div>
            </div>

            {/* 20-level grid */}
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10">
              {tier.levels.map((level) => {
                const p = byId.get(level.id)
                const isNext = level.id === nextId
                const isDone = Boolean(p?.completed)
                const started = !p?.completed && (p?.stepsDone ?? 0) > 0
                return (
                  <button
                    key={level.id}
                    onClick={() => navigate('lesson', level.id)}
                    title={level.title}
                    aria-label={`Level ${level.n}: ${level.title}`}
                    className={cn(
                      'group relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-center transition',
                      isDone && 'border-transparent text-white shadow-sm',
                      !isDone && isNext && 'border-primary bg-primary/10',
                      !isDone && !isNext && 'border-border bg-card hover:border-muted-foreground/40',
                    )}
                    style={isDone ? { background: tier.color } : undefined}
                  >
                    {isDone ? (
                      <Check className="h-5 w-5" />
                    ) : isNext ? (
                      <Play className="h-5 w-5 text-primary" />
                    ) : started ? (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground/40" />
                    )}
                    <span
                      className={cn(
                        'text-xs font-extrabold',
                        isDone ? 'text-white' : isNext ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {level.n}
                    </span>
                    {started && !isDone && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-6 -translate-x-1/2 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.round(((p?.stepsDone ?? 0) / Math.max(1, p?.totalSteps ?? 1)) * 100)}%` }}
                        />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* highlighted next lesson of the tier */}
            {tier.levels.find((l) => l.id === nextId) && (
              <button
                onClick={() => navigate('lesson', nextId as string)}
                className="mt-2 flex w-full items-center gap-3 rounded-lg bg-card p-3 text-left shadow-sm transition hover:shadow-md"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-extrabold text-white"
                  style={{ background: tier.color }}
                >
                  {tier.levels.find((l) => l.id === nextId)?.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{tier.levels.find((l) => l.id === nextId)?.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tier.levels.find((l) => l.id === nextId)?.subtitle}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
