'use client'

/**
 * Opening Puzzles — the chessreps.com per-opening puzzle mode ported from
 * the deep-dive evidence (docs/chessreps-arena-deep-dive.md, P4).
 *
 * Every puzzle is a real game position from THIS repertoire course's
 * opening, drawn from the 5.77M lichess bank through a rating window around
 * the player's own puzzle rating. The picker is their verbatim behavior:
 * a ±50 window that expands by 50, random unplayed candidate, buffer refill
 * when fewer than 10 unseen remain, and a 300-id "already seen" ring so a
 * session never repeats what you have played.
 *
 * Solutions never reach the client: moves are graded by /api/puzzles/move,
 * the same server-authoritative path every other puzzle surface uses, and
 * attempts are recorded through /api/puzzles/attempt so there is ONE honest
 * puzzle rating. A first-try solve is a win; a miss drops the rating at
 * once (their anti-sandbagging rule) but the puzzle stays for learning.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { playSound } from '@/lib/chess/sounds'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Check, ChevronLeft, FlaskConical, Lightbulb, Loader2, RefreshCcw, Target, X,
} from 'lucide-react'
import type { RepertoireCourse } from '@/lib/chess/opening-reps'
import { loadRatings, rememberPuzzlePlayed } from '@/lib/chess/arena-rating'
import type { ProfileData } from '@/lib/store'

interface BankPuzzle { id: string; fen: string; rating: number }
type Phase = 'loading' | 'solving' | 'empty' | 'warming' | 'error'

const PRAISE = [
  'Exactly right.', 'Tactic spotted.', 'That is the move.', 'Nailed it.', 'Clean solve.',
  'Sharp.', 'You saw it.', 'Flawless.', 'Automatic.', 'The move.',
]

const REFILL_THRESHOLD = 10
const WINDOW_START = 50
const WINDOW_STEP = 50
const WINDOW_MAX = 800

function readJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

export function OpeningPuzzles({ course, onExit }: { course: RepertoireCourse; onExit: () => void }) {
  const { profile, setProfile } = useApp()
  const soundOn = profile?.soundEnabled ?? true
  const boardTheme = profile?.theme ?? 'green'
  const showCoords = profile?.showCoords ?? true
  const puzzleRating = profile?.puzzleRating ?? null

  const [phase, setPhase] = useState<Phase>('loading')
  const [puzzle, setPuzzle] = useState<BankPuzzle | null>(null)
  const [fen, setFen] = useState(new Chess().fen())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [status, setStatus] = useState('Loading puzzles…')
  const [praise, setPraise] = useState<string | null>(null)
  const [streak, setStreak] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [missed, setMissed] = useState(false) // missed once -> a later solve is a recovery
  const [revealed, setRevealed] = useState(false) // failed AND shown -> advance
  const [totalInPool, setTotalInPool] = useState<number | null>(null)

  const bufferRef = useRef<BankPuzzle[]>([])
  const gameRef = useRef(new Chess())
  const solverSansRef = useRef<string[]>([])
  const recordedRef = useRef(false)
  const busyRef = useRef(false)
  const genRef = useRef(0)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = null
  }, [])

  useEffect(() => () => {
    genRef.current++
    clearTimers()
  }, [clearTimers])

  const [solverSide, setSolverSide] = useState<'w' | 'b'>('w')

  /** Fetch a fresh batch, excluding everything on the seen-ring. */
  const loadBatch = useCallback(async (): Promise<boolean> => {
    const played = loadRatings().playedPuzzleIds
    const params = new URLSearchParams()
    params.set('openings', course.openings.join(','))
    if (puzzleRating) params.set('elo', String(puzzleRating))
    if (played.length) params.set('exclude', played.join(','))
    try {
      const res = await fetch(`/api/puzzles/opening?${params.toString()}`)
      const data = await readJson<{ puzzles?: BankPuzzle[]; total?: number; lichessTotal?: number; warming?: boolean }>(res)
      setTotalInPool(data.lichessTotal ?? null)
      if (data.warming) {
        setPhase('warming')
        return false
      }
      const fresh = data.puzzles ?? []
      const seen = new Set(bufferRef.current.map((p) => p.id))
      for (const p of fresh) {
        if (!seen.has(p.id)) {
          bufferRef.current.push(p)
          seen.add(p.id)
        }
      }
      return true
    } catch {
      return false
    }
  }, [course.openings, puzzleRating])

  /** Their picker: ±50 window, expand by 50, random unplayed candidate. */
  const pickPuzzle = useCallback((gen: number): BankPuzzle | null => {
    const target = puzzleRating ?? 1200
    for (let window = WINDOW_START; window <= WINDOW_MAX; window += WINDOW_STEP) {
      const candidates = bufferRef.current.filter(
        (p) => Math.abs(p.rating - target) <= window,
      )
      if (candidates.length) {
        return candidates[Math.floor(Math.random() * candidates.length)]
      }
    }
    // Nothing within the window at all: any unplayed candidate beats stalling.
    const all = bufferRef.current
    if (all.length) return all[Math.floor(Math.random() * all.length)]
    void gen
    return null
  }, [puzzleRating])

  const startPuzzle = useCallback((p: BankPuzzle) => {
    recordedRef.current = false
    solverSansRef.current = []
    setMissed(false)
    setRevealed(false)
    setPraise(null)
    setFlashes([])
    let g: Chess
    try {
      g = new Chess(p.fen)
    } catch {
      // corrupt row: drop it and move on
      bufferRef.current = bufferRef.current.filter((x) => x.id !== p.id)
      return
    }
    gameRef.current = g
    setSolverSide(g.turn() as 'w' | 'b')
    setPuzzle(p)
    setFen(g.fen())
    setLastMove(null)
    setPhase('solving')
    setStatus(`Find the best move for ${g.turn() === 'w' ? 'White' : 'Black'} — rated ${p.rating}.`)
  }, [])

  /** Refill + advance: the session loop. */
  const nextPuzzle = useCallback(async () => {
    const gen = genRef.current
    const unseen = bufferRef.current.length
    if (unseen < REFILL_THRESHOLD) {
      setPhase('loading')
      const ok = await loadBatch()
      if (gen !== genRef.current) return
      if (!ok) {
        setPhase((prev) => (prev === 'warming' ? 'warming' : 'error'))
        return
      }
    }
    let p = pickPuzzle(gen)
    if (!p && bufferRef.current.length === 0) {
      setPhase('empty')
      return
    }
    if (!p) {
      // Everything in the buffer was already played this window: the honest
      // chessreps behavior is clearing the seen-ring and continuing.
      const r = loadRatings()
      r.playedPuzzleIds = []
      saveRings(r)
      bufferRef.current = []
      setPhase('loading')
      const ok = await loadBatch()
      if (gen !== genRef.current) return
      if (!ok) return
      p = pickPuzzle(gen)
      if (!p) {
        setPhase('empty')
        return
      }
    }
    bufferRef.current = bufferRef.current.filter((x) => x.id !== p!.id)
    rememberPuzzlePlayed(p.id)
    startPuzzle(p)
  }, [loadBatch, pickPuzzle, startPuzzle])

  // Initial load.
  useEffect(() => {
    const gen = ++genRef.current
    void (async () => {
      const ok = await loadBatch()
      if (gen !== genRef.current) return
      if (!ok) {
        setPhase('warming')
        return
      }
      const p = pickPuzzle(gen)
      if (!p) {
        setPhase('empty')
        return
      }
      bufferRef.current = bufferRef.current.filter((x) => x.id !== p.id)
      rememberPuzzlePlayed(p.id)
      startPuzzle(p)
    })()
  }, [course.id])

  /** One rated attempt per puzzle, recorded exactly once. */
  const recordAttempt = useCallback(async (solved: boolean) => {
    if (recordedRef.current || !puzzle) return
    recordedRef.current = true
    try {
      const res = await fetch('/api/puzzles/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puzzleId: puzzle.id, kind: 'rated', solved }),
      })
      const d = await readJson<{ profile?: ProfileData; ratingDelta?: number | null }>(res)
      if (d.profile) setProfile(d.profile)
      setRatingDelta(d.ratingDelta ?? null)
      window.setTimeout(() => setRatingDelta(null), 2400)
    } catch {
      /* offline: the solve still counts locally for the streak */
    }
  }, [puzzle, setProfile])

  const advanceSoon = useCallback((ms: number) => {
    clearTimers()
    const gen = genRef.current
    advanceTimerRef.current = setTimeout(() => {
      if (gen !== genRef.current) return
      void nextPuzzle()
    }, ms)
  }, [clearTimers, nextPuzzle])

  const onPlayerMove = useCallback((from: Square, to: Square, promotion?: string) => {
    if (phase !== 'solving' || busyRef.current || !puzzle) return
    const g = gameRef.current
    let playedSan: string | null = null
    try {
      const mv = g.move({ from, to, promotion: promotion || 'q' })
      playedSan = mv?.san ?? null
    } catch {
      playedSan = null
    }
    if (!playedSan) return
    const playedFrom = from
    const playedTo = to
    // Tentatively render the move while the grader checks it.
    setFen(g.fen())
    setLastMove({ from: playedFrom, to: playedTo })

    busyRef.current = true
    const gen = genRef.current
    void (async () => {
      const played = [...solverSansRef.current, playedSan!]
      let verdict: { correct: boolean; reply: string | null; scriptDone: boolean; hintFrom?: string | null } | null = null
      try {
        const res = await fetch('/api/puzzles/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ puzzleId: puzzle.id, played }),
        })
        verdict = await readJson(res)
      } catch {
        verdict = null
      }
      if (gen !== genRef.current) return
      busyRef.current = false
      if (!verdict || typeof verdict.correct !== 'boolean') {
        // Grader hiccup: roll the tentative move back, keep the session alive.
        g.undo()
        setFen(g.fen())
        setStatus('Connection hiccup — try that move again.')
        return
      }
      if (!verdict.correct) {
        // Snap back: a wrong move never lands on the board.
        g.undo()
        setFen(g.fen())
        setLastMove(null)
        playSound('wrong', soundOn)
        if (!missed) {
          setMissed(true)
          setStreak(0)
          void recordAttempt(false)
        }
        if (verdict.hintFrom) {
          setFlashes([{ square: verdict.hintFrom, color: 'gold' }])
          window.setTimeout(() => setFlashes([]), 1500)
        }
        setStatus(verdict.hintFrom ? `Not it — the piece starts on ${verdict.hintFrom}.` : 'Not it — look again.')
        return
      }
      // On script.
      solverSansRef.current.push(playedSan!)
      setFlashes([])
      const lastCorrect = !missed
      if (verdict.scriptDone) {
        if (lastCorrect) {
          setStreak((s) => s + 1)
          setSolvedCount((c) => c + 1)
          setPraise(PRAISE[Math.floor(Math.random() * PRAISE.length)])
          setStatus('Solved.')
          void recordAttempt(true)
        } else {
          setPraise('Recovered — the idea landed.')
          setStatus('Solved after a miss. Rating already settled for this one.')
        }
        playSound('win', soundOn)
        setPhase('solving') // board shows the final position
        advanceSoon(1100)
        return
      }
      // Opponent's forced reply, animated.
      if (verdict.reply) {
        busyRef.current = true
        window.setTimeout(() => {
          if (gen !== genRef.current) return
          try {
            const rm = gameRef.current.move(verdict.reply!)
            if (rm) {
              setFen(gameRef.current.fen())
              setLastMove({ from: rm.from, to: rm.to })
            }
          } catch { /* validated content */ }
          busyRef.current = false
          setStatus(lastCorrect ? 'Keep going.' : 'Find the rest of the idea.')
        }, 260)
      } else {
        setStatus('Keep going.')
      }
      playSound('correct', soundOn)
    })()
  }, [missed, phase, puzzle, recordAttempt, advanceSoon, soundOn])

  const hint = useCallback(() => {
    if (phase !== 'solving' || !puzzle) return
    void (async () => {
      try {
        const res = await fetch('/api/puzzles/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ puzzleId: puzzle.id, played: solverSansRef.current, hint: true }),
        })
        const v = await readJson<{ correct?: boolean; scriptDone?: boolean; hintFrom?: string | null }>(res)
        if (v.hintFrom) {
          setFlashes([{ square: v.hintFrom, color: 'green' }])
          window.setTimeout(() => setFlashes([]), 2000)
          setStatus('Start with the piece on that square.')
        }
      } catch { /* display only */ }
    })()
  }, [phase, puzzle])

  const retryLoad = useCallback(() => {
    genRef.current++
    setPhase('loading')
    void nextPuzzle()
  }, [nextPuzzle])

  /* ------------------------------ non-solving states ------------------------------ */
  if (phase === 'loading') {
    return (
      <Shell onExit={onExit} course={course}>
        <div className="flex flex-col items-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">Pulling {course.name} puzzles from real games…</p>
        </div>
      </Shell>
    )
  }
  if (phase === 'warming') {
    return (
      <Shell onExit={onExit} course={course}>
        <div className="flex flex-col items-center py-16 text-center">
          <FlaskConical className="h-8 w-8 text-amber-500" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-extrabold">Puzzle bank is warming up</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            The 5.77M-puzzle library installs itself in the background after a fresh boot. Give it a minute, then retry.
          </p>
          <Button className="mt-4" onClick={retryLoad}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </Shell>
    )
  }
  if (phase === 'empty') {
    return (
      <Shell onExit={onExit} course={course}>
        <div className="flex flex-col items-center py-16 text-center">
          <Target className="h-8 w-8 text-primary" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-extrabold">No puzzles left in this window</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Every {course.name} puzzle near your rating is already on your seen-list, and the pool is momentarily
            exhausted. This clears as the bank refreshes — or come back after your rating moves.
          </p>
          <Button variant="secondary" className="mt-4" onClick={onExit}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Back to repertoires
          </Button>
        </div>
      </Shell>
    )
  }
  if (phase === 'error') {
    return (
      <Shell onExit={onExit} course={course}>
        <div className="flex flex-col items-center py-16 text-center">
          <X className="h-8 w-8 text-red-400" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-extrabold">Could not load puzzles</h2>
          <p className="mt-1 text-sm text-muted-foreground">The network dropped on the way to the bank.</p>
          <Button className="mt-4" onClick={retryLoad}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </Shell>
    )
  }

  /* ------------------------------ solving ------------------------------ */
  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-4 pb-24 sm:px-4 lg:pb-8">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button onClick={onExit} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {course.name}
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          {ratingDelta != null && (
            <span className={cn(
              'rounded-full px-2 py-1 font-extrabold tabular-nums',
              ratingDelta >= 0 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-500',
            )}>
              {ratingDelta >= 0 ? '+' : ''}{ratingDelta} rating
            </span>
          )}
          <span className="rounded-full bg-accent/60 px-2 py-1 font-extrabold tabular-nums">
            <Check className="mr-0.5 inline h-3 w-3" aria-hidden /> {solvedCount}
          </span>
          {streak > 1 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-1 font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
              {streak} streak
            </span>
          )}
          {puzzleRating != null && (
            <span className="hidden rounded-full bg-accent/60 px-2 py-1 font-extrabold tabular-nums sm:inline">
              {puzzleRating}
            </span>
          )}
        </div>
      </div>

      <ChessBoard
        fen={fen}
        orientation={solverSide}
        onMove={onPlayerMove}
        interactive={phase === 'solving'}
        movableSide={solverSide}
        lastMove={lastMove}
        showLegal={phase === 'solving'}
        showCoords={showCoords}
        theme={boardTheme}
        flashes={flashes}
        className="h-full w-full"
      />

      <div className="mt-2 flex min-h-10 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-border/60">
        {phase === 'solving' ? <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />}
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {praise && !missed ? <span className="font-bold text-emerald-600 dark:text-emerald-400">{praise} </span> : null}
          {status}
        </span>
        <Button variant="secondary" size="sm" onClick={hint} disabled={revealed} title="Show me the piece">
          <Lightbulb className="h-3.5 w-3.5" aria-label="Hint" />
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Real games from the {course.name.replace(/ System| Game| Defense/i, '')} pool{totalInPool != null ? ` · ${totalInPool.toLocaleString()} puzzles in the bank` : ''}
      </p>
    </div>
  )
}

function Shell({ course, onExit, children }: { course: RepertoireCourse; onExit: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-4 pb-24 sm:px-4 lg:pb-8">
      <button onClick={onExit} className="mb-3 flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {course.name}
      </button>
      <div className="rounded-xl border bg-card">{children}</div>
    </div>
  )
}

/** Ring-buffer save helper (kept next to the loader for symmetry). */
function saveRings(r: ReturnType<typeof loadRatings>): void {
  try {
    window.localStorage.setItem('chessx.ratings.v1', JSON.stringify(r))
  } catch {
    /* storage blocked */
  }
}
