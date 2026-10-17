// Server-side puzzle grading. The one and only holder of puzzle solutions:
// the client never receives a solution, a title, a theme list or a source
// before the solver has earned it. Every puzzle surface (rated, daily, rush,
// battle) asks this module whether a move is correct, what the forced reply
// is, and when the scripted point is complete.
import 'server-only'
import { Chess } from 'chess.js'
import { PUZZLES } from '@/content/puzzles'
import { lichessById, lichessToAppPuzzle } from '@/lib/server/lichess-bank'
import { normSan } from '@/lib/chess/press'
import type { Puzzle } from '@/content/schema'

/** What the client may know about a puzzle before solving it. */
export interface PublicPuzzle {
  id: string
  fen: string
  rating: number
  themes: string[]
}

/** Strip everything that could hint at the answer. */
export function publicPuzzle(p: Puzzle): PublicPuzzle {
  return { id: p.id, fen: p.fen, rating: p.rating, themes: p.themes }
}

export function findPuzzle(id: string): Puzzle | undefined {
  const curated = PUZZLES.find((p) => p.id === id)
  if (curated) return curated
  // Lichess bank: resolve by id and convert once (UCI -> SAN server-side).
  // The title stays the neutral 'Lichess Puzzle' — no motif spoilers.
  const lp = lichessById(id)
  if (!lp) return undefined
  return lichessToAppPuzzle(lp) as Puzzle
}

export type PuzzleGoal = 'mate' | 'material' | 'other'

export interface PuzzleMeta {
  title: string
  themes: string[]
  source?: string
}

export interface MoveVerdict {
  /** false: the move is not the scripted point (the client may still ask the
   * engine whether it is an equally winning alternative). */
  correct: boolean
  /** SAN of the forced opponent reply that follows the last played move. */
  reply: string | null
  /** true: the scripted line is finished — no more solver moves in it. */
  scriptDone: boolean
  /** Only sent once the tactic has landed (never a pre-solve hint): what the
   * puzzle is ultimately about, so the surface knows whether to press to mate. */
  goal?: PuzzleGoal
  /** Post-tactic reveal: title, themes and source. */
  meta?: PuzzleMeta
  /** On a miss: the square the scripted piece starts from (the same nudge the
   * miss flow already showed, now computed where the answer lives). */
  hintFrom?: string | null
}

function goalOf(p: Puzzle): PuzzleGoal {
  const last = p.solution.trim().split(/\s+/).pop() ?? ''
  if (p.themes.includes('mate') || last.includes('#')) return 'mate'
  if (p.themes.includes('winningMaterial')) return 'material'
  return 'other'
}

function metaOf(p: Puzzle): PuzzleMeta {
  return { title: p.title, themes: p.themes, ...(p.source ? { source: p.source } : {}) }
}

/**
 * Grade a solver's played moves against the scripted line.
 * `played` holds the solver's own SAN moves in order (opponent replies are
 * implied — the server plays them from the script and reports the latest one
 * back so the client can animate it).
 * With `hint`, no grading happens: the response only carries the from-square
 * of the next scripted move, the same nudge "Show me the piece" always gave.
 */
export function gradePuzzleMoves(puzzleId: string, played: string[], hint = false): MoveVerdict | { error: string } {
  const puzzle = findPuzzle(puzzleId)
  if (!puzzle) return { error: 'puzzle not found' }
  if (!Array.isArray(played) || played.length > 20) return { error: 'bad played list' }

  const script = puzzle.solution.trim().split(/\s+/).filter(Boolean)
  let g: Chess
  try {
    g = new Chess(puzzle.fen)
  } catch {
    return { error: 'bad puzzle position' }
  }

  const playedClean = played.map((s) => String(s ?? '').trim()).filter(Boolean)

  for (let i = 0; i < playedClean.length; i++) {
    const solverIdx = 2 * i
    if (solverIdx >= script.length) {
      return { error: 'script exhausted' }
    }
    const expectedSan = normSan(script[solverIdx] ?? '')
    const actualSan = normSan(playedClean[i] ?? '')
    if (expectedSan === '' || actualSan !== expectedSan) {
      // The next scripted move is played on a probe only to find the square
      // the hint glow should mark. The board itself is left untouched.
      let hintFrom: string | null = null
      try {
        const probe = new Chess(g.fen())
        const probeMove = probe.move(script[solverIdx])
        if (probeMove) hintFrom = probeMove.from
      } catch {
        /* validated content */
      }
      return { correct: false, reply: null, scriptDone: false, hintFrom }
    }
    // On script: play the canonical SAN so formatting quirks never drift.
    try {
      g.move(script[solverIdx])
    } catch {
      return { error: 'script replay failed' }
    }
    const replyIdx = solverIdx + 1
    if (replyIdx < script.length) {
      try {
        g.move(script[replyIdx])
      } catch {
        /* the reply plays out client-side from the verdict; here it only
           keeps the replay aligned for the next grading step */
      }
    }
  }

  const nextSolverIdx = 2 * playedClean.length
  const scriptDone = nextSolverIdx >= script.length

  if (hint) {
    if (scriptDone) return { correct: true, reply: null, scriptDone: true }
    let hintFrom: string | null = null
    try {
      const probe = new Chess(g.fen())
      const probeMove = probe.move(script[nextSolverIdx])
      if (probeMove) hintFrom = probeMove.from
    } catch {
      /* validated content */
    }
    return { correct: true, reply: null, scriptDone: false, hintFrom }
  }

  // The opponent reply that follows the last played solver move. It is sent
  // even when the script ends on it — the client still has to animate it.
  const lastReplyIdx = nextSolverIdx - 1
  const reply = lastReplyIdx >= 0 && lastReplyIdx < script.length ? (script[lastReplyIdx] ?? null) : null

  const verdict: MoveVerdict = { correct: true, reply, scriptDone }
  if (scriptDone) {
    verdict.goal = goalOf(puzzle)
    verdict.meta = metaOf(puzzle)
  }
  return verdict
}

export interface RevealedPuzzle {
  solution: string
  rating: number
  title: string
  themes: string[]
  source?: string
}

/** The full answer, only for surfaces that have already shown the finish
 * (failed attempts and the explicit "Show solution" click). */
export function revealPuzzle(puzzleId: string): RevealedPuzzle | { error: string } {
  const puzzle = findPuzzle(puzzleId)
  if (!puzzle) return { error: 'puzzle not found' }
  return {
    solution: puzzle.solution,
    rating: puzzle.rating,
    title: puzzle.title,
    themes: puzzle.themes,
    ...(puzzle.source ? { source: puzzle.source } : {}),
  }
}
