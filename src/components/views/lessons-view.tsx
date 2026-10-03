'use client'

import { useEffect, useState } from 'react'
import { LEVELS } from '@/content/levels'
import { useApp } from '@/lib/store'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { Clock, CheckCircle2, Circle, ChevronRight } from 'lucide-react'

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

  const byId = new Map(progress.map((p) => [p.lessonId, p]))
  const doneCount = progress.filter((p) => p.completed).length
  const totalLessons = LEVELS.reduce((n, l) => n + l.lessons.length, 0)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <h1 className="font-display text-2xl font-extrabold">Lessons</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {doneCount}/{totalLessons} complete. Work through the levels in order — every lesson ends with something you can do on the board.
      </p>

      {LEVELS.map((level) => {
        const levelDone = level.lessons.filter((l) => byId.get(l.id)?.completed).length
        return (
          <section key={level.id} className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-lg font-extrabold text-white"
                style={{ background: level.color }}
              >
                {level.n}
              </div>
              <div>
                <h2 className="font-display text-lg font-bold">{level.title}</h2>
                <p className="text-sm text-muted-foreground">{level.tagline}</p>
              </div>
              <div className="ml-auto text-sm font-semibold text-muted-foreground">
                {levelDone}/{level.lessons.length}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {level.lessons.map((lesson) => {
                const p = byId.get(lesson.id)
                const pct = p ? Math.round(((p.completed ? p.totalSteps : p.stepsDone) / lesson.steps.length) * 100) : 0
                return (
                  <button
                    key={lesson.id}
                    onClick={() => navigate('lesson', lesson.id)}
                    className="group rounded-lg bg-card p-4 text-left shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {p?.completed ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                          )}
                          <h3 className="truncate font-bold">{lesson.title}</h3>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{lesson.subtitle}</p>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5" />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" /> {lesson.minutes} min
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function LessonBadge({ done }: { done: boolean }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', done ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}>{done ? 'Done' : 'In progress'}</span>
}
