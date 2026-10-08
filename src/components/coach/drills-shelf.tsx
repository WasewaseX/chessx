'use client'

// The shelf of everything the coach has generated for this student: puzzles,
// drills and quizzes, each replayable and honestly marked with its result.

import type { ArtifactView } from '@/lib/coach-artifacts'
import { levelRefLabel } from '@/lib/coach-artifacts'
import { cn } from '@/lib/utils'
import { Brain, Check, CircleDot, Puzzle, Sparkles, Target, X } from 'lucide-react'

const KIND_ICON = {
  puzzle: Puzzle,
  drill: Target,
  quiz: Brain,
} as const

export function CoachDrillsShelf({
  drills,
  onOpen,
  onNavigateLessons,
  courseLabel,
}: {
  drills: ArtifactView[]
  onOpen: (a: ArtifactView) => void
  onNavigateLessons: () => void
  courseLabel: string | null
}) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold">Coach drills</h2>
        <span className="text-xs text-muted-foreground">{drills.length}</span>
        {courseLabel && (
          <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Calibrated to {courseLabel}
          </span>
        )}
      </div>

      {drills.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Nothing generated yet. Use the skill buttons in the chat: the coach builds a puzzle for{' '}
          {courseLabel ?? 'your level'}, a drill from the board position, or a quiz, and every line is
          engine-checked before you play it. Solved drills feed your concept strengths,{' '}
          <button className="font-semibold text-primary hover:underline" onClick={onNavigateLessons}>
            the course
          </button>{' '}
          stays the source of truth.
        </p>
      ) : (
        <ul className="scroll-slim mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {drills.map((d) => {
            const Icon = KIND_ICON[d.kind] ?? Puzzle
            return (
              <li key={d.id}>
                <button
                  onClick={() => onOpen(d)}
                  className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left transition hover:border-primary/50 hover:bg-secondary"
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[
                        levelRefLabel(d.levelRef) ?? 'Made by your coach',
                        d.rating != null ? `${d.rating} Elo` : null,
                        d.attempts > 0 ? `${d.attempts} ${d.attempts === 1 ? 'attempt' : 'attempts'}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                      d.solved === true && 'bg-emerald-500/15 text-emerald-600',
                      d.solved === false && 'bg-destructive/15 text-destructive',
                      d.solved == null && 'bg-secondary text-muted-foreground',
                    )}
                    title={d.solved === true ? 'Solved' : d.solved === false ? 'Missed so far' : 'Not attempted yet'}
                  >
                    {d.solved === true ? <Check className="h-3 w-3" /> : d.solved === false ? <X className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
