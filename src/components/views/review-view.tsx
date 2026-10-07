'use client'
import { readJson } from '@/lib/api-client'
// Spaced-repetition Review: missed puzzles and shaky lessons resurface here
// on an SM-2 derived schedule, next to the weakest concepts from the skill model.

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { PUZZLE_THEMES } from '@/content/puzzles'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Loader2, Puzzle, BookOpen, CalendarClock, Layers, RotateCcw } from 'lucide-react'

interface QueueItem {
  id: string
  kind: 'puzzle' | 'lesson'
  refId: string
  concept: string | null
  reps: number
  lapses: number
  dueAt: string
  puzzle?: { id: string; title: string; rating: number; themes: string[]; fen: string } | null
  lesson?: { id: string; title: string; tierTitle: string } | null
}

interface MasteryRow {
  concept: string
  mastery: number
  attempts: number
  correct: number
}

const CONCEPT_LABELS: Record<string, string> = {
  ...PUZZLE_THEMES,
  development: 'Development',
  center: 'Center',
  castlingSafety: 'Castling safety',
  kingSafety: 'King safety',
  pawnStructure: 'Pawn structure',
  openFiles: 'Open files',
  pieceActivity: 'Piece activity',
  kingActivity: 'King activity',
  opposition: 'Opposition',
  outposts: 'Outposts',
  zugzwang: 'Zugzwang',
  calculation: 'Calculation',
  prophylaxis: 'Prophylaxis',
  coordination: 'Coordination',
  pawnBreaks: 'Pawn breaks',
  bishopPair: 'Bishop pair',
  initiative: 'Initiative',
  technique: 'Technique',
  tempo: 'Tempo',
  tradeDecisions: 'Trade decisions',
}

function conceptLabel(c: string): string {
  return CONCEPT_LABELS[c] ?? c
}

function dueLabel(iso: string): string {
  const d = new Date(iso)
  const days = Math.round((d.getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'due now'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

export function ReviewView() {
  const { navigate, setPendingReview } = useApp()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [mastery, setMastery] = useState<MasteryRow[]>([])

  const loadQueue = useCallback(() => {
    fetch('/api/review')
      .then((r) => readJson<unknown>(r))
      .then((d) => {
        setQueue(d.queue ?? [])
        setDueCount(d.dueCount ?? 0)
        setUpcomingCount(d.upcomingCount ?? 0)
        setMastery(d.mastery ?? [])
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  function retryQueue() {
    setLoading(true)
    setLoadError(false)
    loadQueue()
  }

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  function startPuzzle(item: QueueItem) {
    setPendingReview({ itemId: item.id, kind: 'puzzle', refId: item.refId })
    navigate('puzzles')
  }

  function startLesson(item: QueueItem) {
    setPendingReview({ itemId: item.id, kind: 'lesson', refId: item.refId })
    navigate('lesson', item.refId)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-extrabold">Review</h1>
        <div className="text-sm text-muted-foreground">
          Missed puzzles and lessons you finished with help come back here on a schedule, right before you would forget them.
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking the queue…
        </div>
      ) : loadError ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm" role="alert">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="mt-2 font-display text-lg font-bold">Could not load your review queue.</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Check your connection and try again. Nothing is lost, everything stays scheduled on the server.
          </p>
          <Button variant="secondary" className="mt-4" onClick={retryQueue}>
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <CalendarClock className="h-4 w-4 text-primary" /> Due now
              </div>
              <div className="mt-1 font-display text-3xl font-extrabold">{dueCount}</div>
              {upcomingCount > 0 && <div className="text-xs text-muted-foreground">{upcomingCount} more scheduled for later</div>}
            </div>
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Layers className="h-4 w-4 text-primary" /> Weakest concepts
              </div>
              {mastery.length === 0 ? (
                <div className="mt-1 text-sm text-muted-foreground">Solve puzzles and finish lessons to map your strengths.</div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mastery.slice(0, 4).map((m) => (
                    <span key={m.concept} className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">
                      {conceptLabel(m.concept)} {Math.round(m.mastery * 100)}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {queue.length === 0 ? (
            <div className="rounded-xl bg-card p-6 text-center shadow-sm">
              <div className="font-display text-lg font-bold">Nothing due right now.</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                When a rated puzzle gets the better of you, or a lesson only clicks with hints, it lands here so you can face it again with fresh eyes.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {queue.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.kind === 'puzzle' ? <Puzzle className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                      {item.kind === 'puzzle' ? 'Missed puzzle' : 'Lesson revisit'}
                      {item.concept && <span className="rounded bg-secondary px-1.5 py-0.5 normal-case">{conceptLabel(item.concept)}</span>}
                    </div>
                    <div className="mt-1 truncate font-bold">
                      {item.kind === 'puzzle'
                        ? item.puzzle
                          ? `${item.puzzle.title} · ${item.puzzle.rating}`
                          : 'Puzzle'
                        : item.lesson
                          ? item.lesson.title
                          : 'Lesson'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.kind === 'puzzle' && item.puzzle
                        ? item.puzzle.themes.map((t) => PUZZLE_THEMES[t] ?? t).join(', ')
                        : item.lesson
                          ? item.lesson.tierTitle
                          : ''}
                      {` · seen ${item.reps + item.lapses} time${item.reps + item.lapses === 1 ? '' : 's'} · ${dueLabel(item.dueAt)}`}
                    </div>
                  </div>
                  <Button className="btn-hero" size="sm" onClick={() => (item.kind === 'puzzle' ? startPuzzle(item) : startLesson(item))}>
                    {item.kind === 'puzzle' ? 'Face it again' : 'Replay lesson'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {mastery.length > 0 && (
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="font-display text-lg font-bold">Concept strength</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {mastery.map((m) => (
                  <div key={m.concept}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold">{conceptLabel(m.concept)}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.correct}/{m.attempts}
                      </span>
                    </div>
                    <Progress value={m.mastery * 100} className="mt-1 h-2" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
