// Client-side puzzle solving talks to the grading API. The browser never
// holds a solution, a title or a source before the solver earns it: this
// module is the only channel, and it hands out one verdict at a time.
import { readJson } from '@/lib/api-client'
import type { PublicPuzzle } from '@/content/schema'

export type { PublicPuzzle }

export type PuzzleGoal = 'mate' | 'material' | 'other'

export interface PuzzleMeta {
  title: string
  themes: string[]
  source?: string
}

export interface MoveVerdict {
  correct: boolean
  reply: string | null
  scriptDone: boolean
  goal?: PuzzleGoal
  meta?: PuzzleMeta
  hintFrom?: string | null
}

export interface RevealedPuzzle {
  solution: string
  rating: number
  title: string
  themes: string[]
  source?: string
}

/** The sanitized pool every client surface picks from. */
export async function fetchPuzzleIndex(): Promise<PublicPuzzle[]> {
  const res = await fetch('/api/puzzles/index')
  const d = await readJson<{ puzzles?: PublicPuzzle[] }>(res)
  return d.puzzles ?? []
}

/** Grade the solver's moves so far; `hint` only asks for the next from-square. */
export async function gradePuzzleMove(puzzleId: string, played: string[], hint = false): Promise<MoveVerdict> {
  const res = await fetch('/api/puzzles/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzleId, played, hint }),
  })
  const d = await readJson<MoveVerdict & { error?: string }>(res)
  if (d && typeof d === 'object' && 'error' in d && d.error) throw new Error(d.error)
  return d
}

/** The full answer — for failed attempts and the explicit show-solution click. */
export async function revealPuzzleAnswer(puzzleId: string): Promise<RevealedPuzzle> {
  const res = await fetch('/api/puzzles/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzleId }),
  })
  const d = await readJson<RevealedPuzzle & { error?: string }>(res)
  if (d && typeof d === 'object' && 'error' in d && d.error) throw new Error(d.error)
  return d
}
