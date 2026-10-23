'use client'
// Brain games — the cognitive gym under Learn (chessigma's /brain hub,
// reverse-engineered and re-built for chessx: REA report §8.3). Five games,
// each training one named skill with honest, local best scores:
//
//   Find the check  — count every legal check in a real master position
//   Mate rush       — mate-in-1 speed round against the clock
//   Knight trail    — knight's-tour fragment: visit squares, never repeat
//   Legal or not    — is this piece move legal? (pins, checks, blocks)
//   Blind moves     — execute unambiguous SAN moves from memory alone
//
// Positions come from the master-game puzzle bank (the same sanitized index
// every other trainer uses). Bests persist locally — these games are about
// beating yourself, not farming XP, so there is deliberately no XP faucet.

import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Move, type Square } from 'chess.js'
import { ChessBoard, type Mark } from '@/components/chess/board'
import { fetchPuzzleIndex } from '@/lib/chess/solver'
import type { PuzzleStub } from '@/content/schema'
import { useApp } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowLeft, Brain, Crosshair, EyeOff, Gavel, Spline, Zap } from 'lucide-react'

type BrainGame = 'checks' | 'materush' | 'trail' | 'legal' | 'blind'
type Phase = 'idle' | 'running' | 'over'

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'

const BEST_KEYS: Record<BrainGame, string> = {
  checks: 'chessx.brain.checks',
  materush: 'chessx.brain.materush',
  trail: 'chessx.brain.trail',
  legal: 'chessx.brain.legal',
  blind: 'chessx.brain.blind',
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[r]] = [out[r], out[i]]
  }
  return out
}

function loadBest(game: BrainGame): number {
  if (typeof window === 'undefined') return 0
  return Number(window.localStorage.getItem(BEST_KEYS[game]) ?? '0') || 0
}

function saveBest(game: BrainGame, score: number): { isNew: boolean; previous: number } {
  const previous = loadBest(game)
  if (score > previous) {
    window.localStorage.setItem(BEST_KEYS[game], String(score))
    return { isNew: true, previous }
  }
  return { isNew: false, previous }
}

interface GameMeta {
  id: BrainGame
  title: string
  tagline: string
  description: string
  bestLabel: (best: number) => string
}

const GAMES: GameMeta[] = [
  {
    id: 'checks',
    title: 'Find the check',
    tagline: 'Count every legal check',
    description: 'Real master positions. Name how many checks the side to move has. Masters hold a live map of every check — that map is trainable.',
    bestLabel: (b) => (b > 0 ? `Best: ${b} of 8` : 'No runs yet'),
  },
  {
    id: 'materush',
    title: 'Mate rush',
    tagline: 'Mate in one, on the clock',
    description: 'Every position has exactly one mate-in-1. Find it on the board — each mate buys you extra seconds. One streak, one clock, no mercy.',
    bestLabel: (b) => (b > 0 ? `Best: ${b} mates` : 'No runs yet'),
  },
  {
    id: 'trail',
    title: 'Knight trail',
    tagline: 'Hop far, never repeat',
    description: 'A lone knight, sixty seconds. Every hop must be a real knight move and no square may be visited twice. Knight geometry becomes instinct.',
    bestLabel: (b) => (b > 0 ? `Best: ${b} squares` : 'No runs yet'),
  },
  {
    id: 'legal',
    title: 'Legal or not',
    tagline: 'Judge the move before you play it',
    description: 'A position and a proposed move. Legal, or not? Pins, pinned-to-the-king moves and blocked paths — the rules as reflexes.',
    bestLabel: (b) => (b > 0 ? `Best: ${b} of 10` : 'No runs yet'),
  },
  {
    id: 'blind',
    title: 'Blind moves',
    tagline: 'Play it with your eyes closed',
    description: 'Study the position, then the board goes dark. Unambiguous moves are announced — tap the from and to square from memory alone.',
    bestLabel: (b) => (b > 0 ? `Best: ${b} of 12` : 'No runs yet'),
  },
]

// ---------------------------------------------------------------------------
// Shared shells
// ---------------------------------------------------------------------------

function GameHeader({ title, onExit, left, right }: { title: string; onExit: () => void; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <Button variant="ghost" size="sm" onClick={onExit} className="shrink-0">
        <ArrowLeft className="h-4 w-4" /> Games
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
      {left}
      {right}
    </div>
  )
}

function ScorePill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}

function ResultCard({ score, bestLine, isNew, onAgain, onExit, note }: { score: number; bestLine: string; isNew: boolean; onAgain: () => void; onExit: () => void; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
      {isNew ? <div className="text-lg font-bold text-primary">New personal best</div> : null}
      <div className="text-5xl font-black tabular-nums">{score}</div>
      <div className="text-sm text-muted-foreground">{bestLine}</div>
      {note ? <div className="max-w-sm text-sm text-muted-foreground">{note}</div> : null}
      <div className="flex gap-2">
        <Button onClick={onAgain}>Play again</Button>
        <Button variant="outline" onClick={onExit}>
          All games
        </Button>
      </div>
    </div>
  )
}

function BoardFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>
}

// ---------------------------------------------------------------------------
// Position source: the shared, sanitized master-game puzzle index
// ---------------------------------------------------------------------------

function usePuzzles(themes?: string) {
  const [stubs, setStubs] = useState<PuzzleStub[] | null>(null)
  useEffect(() => {
    let alive = true
    const qs = themes ? `?themes=${encodeURIComponent(themes)}` : ''
    fetch(`/api/puzzles/index${qs}`)
      .then((r) => readJson<{ puzzles?: PuzzleStub[] }>(r))
      .then((d) => {
        if (alive) setStubs(d.puzzles ?? [])
      })
      .catch(() => {
        if (alive) setStubs([])
      })
    return () => {
      alive = false
    }
  }, [themes])
  return stubs
}

/** Does this position have a mate-in-1? Returns the mating move if so. */
function mateInOne(fen: string): Move | null {
  try {
    const c = new Chess(fen)
    for (const mv of c.moves({ verbose: true }) as Move[]) {
      c.move(mv.san)
      const mate = c.isCheckmate()
      c.undo()
      if (mate) return mv
    }
  } catch {
    /* corrupt fen */
  }
  return null
}

/**
 * Mate-rush supply. Lichess-format puzzle FENs hand the move to the
 * DEFENDER: the solver's mating move only exists after the opponent's
 * prelude (verified against the bank: e.g. `4r2k/… b - - 0 36` needs a
 * Rd8/c6/g6 prelude before Qxe8#). So a candidate counts as usable when
 * EITHER the side to move already has a mate-in-1, OR some defender
 * prelude produces a position that does — the game then presents that
 * post-prelude position. Returns null when neither holds.
 */
function findMatePuzzle(fen: string): { fen: string } | null {
  if (mateInOne(fen)) return { fen }
  try {
    const c = new Chess(fen)
    for (const pre of c.moves({ verbose: true }) as Move[]) {
      c.move(pre.san)
      const mate = mateInOne(c.fen())
      const afterFen = c.fen()
      c.undo()
      if (mate) return { fen: afterFen }
    }
  } catch {
    /* corrupt fen */
  }
  return null
}

/** All legal moves from `fen` that give check, as SAN strings. */
function checkingSans(fen: string): { sans: string[]; targets: string[] } {
  try {
    const c = new Chess(fen)
    const sans: string[] = []
    const targets: string[] = []
    for (const mv of c.moves({ verbose: true }) as Move[]) {
      c.move(mv.san)
      const check = c.isCheck()
      c.undo()
      if (check) {
        sans.push(mv.san)
        targets.push(mv.to)
      }
    }
    return { sans, targets }
  } catch {
    return { sans: [], targets: [] }
  }
}

// ---------------------------------------------------------------------------
// Game 1: Find the check
// ---------------------------------------------------------------------------

function FindTheCheckGame({ onExit }: { onExit: () => void }) {
  const { profile } = useApp()
  const sound = profile?.soundEnabled ?? true
  const stubs = usePuzzles()
  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<PuzzleStub[]>([])
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [result, setResult] = useState<{ marks: Mark[]; sans: string[] } | null>(null)
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; previous: number } | null>(null)

  const ROUNDS = 8

  const start = useCallback(() => {
    if (!stubs || stubs.length < ROUNDS) return
    setQueue(shuffle(stubs).slice(0, ROUNDS))
    setIdx(0)
    setScore(0)
    setResult(null)
    setBestInfo(null)
    setPhase('running')
  }, [stubs])

  const current = queue[idx]

  const answer = useCallback(
    (n: number) => {
      if (!current || result) return
      const { sans, targets } = checkingSans(current.fen)
      const actual = sans.length
      const correct = n === actual
      if (correct) {
        setScore((s) => s + 1)
        playSound('correct', sound)
      } else {
        playSound('wrong', sound)
      }
      setResult({
        marks: targets.map((t) => ({ square: t, color: correct ? 'green' : 'yellow' })),
        sans,
      })
      window.setTimeout(() => {
        setResult(null)
        if (idx + 1 >= ROUNDS) {
          const finalScore = score + (correct ? 1 : 0)
          setBestInfo(saveBest('checks', finalScore))
          setPhase('over')
        } else {
          setIdx((i) => i + 1)
        }
      }, 1400)
    },
    [current, result, idx, score, sound],
  )

  if (phase === 'idle' || phase === 'over') {
    const best = loadBest('checks')
    return phase === 'idle' ? (
      <div className="rounded-xl border bg-card p-6 text-center">
        <h2 className="mb-1 text-xl font-bold">Find the check</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
          {GAMES[0].description} {stubs ? '' : 'Loading positions…'}
        </p>
        <div className="mb-4 text-sm text-muted-foreground">{GAMES[0].bestLabel(best)}</div>
        <Button onClick={start} disabled={!stubs || stubs.length < ROUNDS}>
          Start · 8 positions
        </Button>
      </div>
    ) : (
      <ResultCard
        score={score}
        bestLine={bestInfo ? (bestInfo.isNew ? `Previous best: ${bestInfo.previous} of 8` : `Best: ${loadBest('checks')} of 8`) : ''}
        isNew={bestInfo?.isNew ?? false}
        onAgain={start}
        onExit={onExit}
      />
    )
  }

  if (!current) return null
  const { sans } = checkingSans(current.fen)
  const turn = current.fen.split(' ')[1] === 'b' ? 'Black' : 'White'

  return (
    <div>
      <GameHeader
        title="Find the check"
        onExit={onExit}
        left={<ScorePill label="Position" value={`${idx + 1}/${ROUNDS}`} />}
        right={<ScorePill label="Score" value={score} />}
      />
      <BoardFrame>
        <ChessBoard fen={current.fen} interactive={false} marks={result?.marks ?? []} showCoords />
      </BoardFrame>
      {result ? (
        <div className="mt-4 text-center text-sm">
          {sans.length === 0 ? (
            <span className="font-semibold">No checks exist here.</span>
          ) : (
            <span className="font-semibold">{sans.length === 1 ? 'The check was ' : `The checks: `} </span>
          )}
          {sans.length > 0 && <span className="font-mono text-xs">{sans.join(', ')}</span>}
        </div>
      ) : (
        <div className="mt-4 text-center">
          <div className="mb-3 text-sm font-medium">{turn} to move — how many legal checks?</div>
          <div className="mx-auto flex max-w-md flex-wrap justify-center gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <Button key={n} variant="outline" size="lg" className="min-w-11" onClick={() => answer(n)}>
                {n === 6 ? '6+' : n}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 2: Mate rush
// ---------------------------------------------------------------------------

function MateRushGame({ onExit }: { onExit: () => void }) {
  const { profile } = useApp()
  const sound = profile?.soundEnabled ?? true
  const [phase, setPhase] = useState<Phase>('idle')
  const [pos, setPos] = useState<{ fen: string } | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [msLeft, setMsLeft] = useState(0)
  const [shake, setShake] = useState(false)
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; previous: number } | null>(null)
  const startedAt = useRef(0)
  const scoreRef = useRef(0)
  // Lazy supply: candidates are verified JUST IN TIME. Verifying all 400
  // mate-themed rows upfront takes tens of seconds of chess.js make/undo; a
  // rolling buffer of 3 verified positions keeps the start instant.
  const candidatesRef = useRef<PuzzleStub[]>([])
  const bufferRef = useRef<{ fen: string }[]>([])
  const usedFensRef = useRef<Set<string>>(new Set())
  const [loadError, setLoadError] = useState(false)
  const END_BONUS_MS = 4000
  const START_MS = 60_000
  // Each takeVerified call verifies at most this many candidates before
  // yielding; skips/next-calls pull again. Prevents any long UI block.
  const VERIFY_BUDGET = 40

  const takeVerified = useCallback((): { fen: string } | null => {
    let budget = VERIFY_BUDGET
    while (bufferRef.current.length < 3 && candidatesRef.current.length > 0 && budget-- > 0) {
      const next = candidatesRef.current.pop()!
      if (usedFensRef.current.has(next.fen)) continue
      const usable = findMatePuzzle(next.fen)
      if (usable) {
        usedFensRef.current.add(next.fen)
        bufferRef.current.push(usable)
      }
    }
    return bufferRef.current.shift() ?? null
  }, [])

  const loadPositions = useCallback(async () => {
    bufferRef.current = []
    usedFensRef.current = new Set()
    setLoadError(false)
    setPos(null)
    const rating = profile?.puzzleRating ?? 1200
    const pulls = [`/api/puzzles/index?themes=mate&rating=${rating}`, '/api/puzzles/index']
    for (const url of pulls) {
      try {
        const res = await fetch(url)
        const d = await readJson<{ puzzles?: PuzzleStub[] }>(res)
        const list = d.puzzles ?? []
        if (list.length === 0) continue
        candidatesRef.current = shuffle(list)
        const first = takeVerified()
        if (first) {
          setPos(first)
          return
        }
      } catch {
        /* fall through to the next source; honest error below if all fail */
      }
    }
    setLoadError(true)
  }, [profile?.puzzleRating, takeVerified])

  const start = useCallback(async () => {
    playSound('click', sound)
    setScore(0)
    scoreRef.current = 0
    setStreak(0)
    setBestInfo(null)
    setMsLeft(START_MS)
    startedAt.current = Date.now()
    setPhase('running')
    await loadPositions()
  }, [sound, loadPositions])

  // clock — when it hits zero the run is over: persist the best (ref keeps the
  // final score current without adding score to the effect's deps) and play
  // the whistle right here, no cascading-render effect needed. Ticks only
  // once a position is on the board — fetching never burns the player's time.
  useEffect(() => {
    if (phase !== 'running' || !pos) return
    const t = window.setInterval(() => {
      setMsLeft((ms) => {
        const next = ms - 200
        if (next <= 0) {
          window.clearInterval(t)
          setPhase('over')
          setBestInfo(saveBest('materush', scoreRef.current))
          playSound('win', sound)
          return 0
        }
        return next
      })
    }, 200)
    return () => window.clearInterval(t)
  }, [phase, pos, sound])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!pos || phase !== 'running') return
      try {
        const c = new Chess(pos.fen)
        const mv = c.move({ from, to, promotion: promotion || undefined })
        if (!mv) return
        if (c.isCheckmate()) {
          playSound('win', sound)
          setScore((s) => {
            scoreRef.current = s + 1
            return s + 1
          })
          setStreak((s) => s + 1)
          setMsLeft((ms) => ms + END_BONUS_MS)
          const next = takeVerified()
          setPos(next)
        } else {
          playSound('wrong', sound)
          setShake(true)
          setStreak(0)
          window.setTimeout(() => setShake(false), 400)
        }
      } catch {
        /* illegal — board already filters most */
      }
    },
    [pos, phase, takeVerified, sound],
  )

  const skip = useCallback(() => {
    if (!pos) return
    playSound('click', sound)
    setStreak(0)
    const next = takeVerified()
    setPos(next)
  }, [pos, takeVerified, sound])

  if (phase === 'idle') {
    const best = loadBest('materush')
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <h2 className="mb-1 text-xl font-bold">Mate rush</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">{GAMES[1].description}</p>
        <div className="mb-4 text-sm text-muted-foreground">{GAMES[1].bestLabel(best)}</div>
        <Button onClick={() => void start()}>Start · 60 seconds</Button>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <ResultCard
        score={score}
        bestLine={bestInfo ? (bestInfo.isNew ? `Previous best: ${bestInfo.previous} mates` : `Best: ${loadBest('materush')} mates`) : ''}
        isNew={bestInfo?.isNew ?? false}
        onAgain={() => void start()}
        onExit={onExit}
      />
    )
  }

  const secs = Math.ceil(msLeft / 1000)

  return (
    <div>
      <GameHeader
        title="Mate rush"
        onExit={onExit}
        left={<ScorePill label="Mates" value={score} />}
        right={
          <>
            <ScorePill label="Streak" value={streak} />
            <ScorePill label="Clock" value={<span className={cn(secs <= 10 && 'text-red-600')}>{secs}s</span>} />
          </>
        }
      />
      <BoardFrame>
        {pos ? (
          <ChessBoard fen={pos.fen} interactive onMove={onMove} shake={shake} showCoords />
        ) : loadError ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-lg border text-center text-sm text-muted-foreground">
            <span>Couldn&apos;t load mate positions just now.</span>
            <Button size="sm" onClick={() => void loadPositions()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg border text-sm text-muted-foreground">Loading positions…</div>
        )}
      </BoardFrame>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={skip} disabled={!pos}>
          Skip (streak resets)
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 3: Knight trail
// ---------------------------------------------------------------------------

const ALL_SQUARES = 'abcdefgh'.split('').flatMap((f) => '12345678'.split('').map((r) => f + r))

function knightMovesFrom(sq: string): string[] {
  const f = 'abcdefgh'.indexOf(sq[0])
  const r = '12345678'.indexOf(sq[1])
  const deltas = [
    [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
  ]
  const out: string[] = []
  for (const [df, dr] of deltas) {
    const nf = f + df
    const nr = r + dr
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push('abcdefgh'[nf] + '12345678'[nr])
  }
  return out
}

function fenWithKnightAt(sq: string): string {
  const files = 'abcdefgh'
  const ranks = '87654321'
  let board = ''
  for (const r of ranks) {
    let row = ''
    let empty = 0
    for (const f of files) {
      if (f + r === sq) {
        if (empty) {
          row += String(empty)
          empty = 0
        }
        row += 'N'
      } else {
        empty++
      }
    }
    if (empty) row += String(empty)
    board += row + (r !== '1' ? '/' : '')
  }
  return `${board} w - - 0 1`
}

function KnightTrailGame({ onExit }: { onExit: () => void }) {
  const { profile } = useApp()
  const sound = profile?.soundEnabled ?? true
  const [phase, setPhase] = useState<Phase>('idle')
  const [knightAt, setKnightAt] = useState('d4')
  const [visited, setVisited] = useState<string[]>([])
  const [score, setScore] = useState(0)
  const [msLeft, setMsLeft] = useState(0)
  const [shake, setShake] = useState(false)
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; previous: number } | null>(null)
  const scoreRef = useRef(0)
  const DURATION = 60_000

  const start = useCallback(() => {
    const first = ALL_SQUARES[Math.floor(Math.random() * 64)]
    setKnightAt(first)
    setVisited([first])
    setScore(1)
    scoreRef.current = 1
    setMsLeft(DURATION)
    setBestInfo(null)
    setPhase('running')
    playSound('click', sound)
  }, [sound])

  // clock — same pattern as mate rush: the whistle, best-persist and sound all
  // happen in the tick callback so no cascading-render effect is needed.
  useEffect(() => {
    if (phase !== 'running') return
    const t = window.setInterval(() => {
      setMsLeft((ms) => {
        const next = ms - 200
        if (next <= 0) {
          window.clearInterval(t)
          setPhase('over')
          setBestInfo(saveBest('trail', scoreRef.current))
          playSound('win', sound)
          return 0
        }
        return next
      })
    }, 200)
    return () => window.clearInterval(t)
  }, [phase, sound])

  const onSquareTap = useCallback(
    (sq: string) => {
      if (phase !== 'running') return
      if (sq === knightAt) return
      const legal = knightMovesFrom(knightAt).includes(sq)
      const fresh = !visited.includes(sq)
      if (legal && fresh) {
        setKnightAt(sq)
        setVisited((v) => [...v, sq])
        setScore((s) => {
          scoreRef.current = s + 1
          return s + 1
        })
        playSound('move', sound)
      } else {
        setShake(true)
        playSound('wrong', sound)
        window.setTimeout(() => setShake(false), 400)
      }
    },
    [phase, knightAt, visited, sound],
  )

  const marks: Mark[] = useMemo(
    () => visited.map((s) => ({ square: s, color: s === knightAt ? 'gold' : 'green' })),
    [visited, knightAt],
  )

  if (phase === 'idle') {
    const best = loadBest('trail')
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <h2 className="mb-1 text-xl font-bold">Knight trail</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">{GAMES[2].description}</p>
        <div className="mb-4 text-sm text-muted-foreground">{GAMES[2].bestLabel(best)}</div>
        <Button onClick={start}>Start · 60 seconds</Button>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <ResultCard
        score={score}
        bestLine={bestInfo ? (bestInfo.isNew ? `Previous best: ${bestInfo.previous} squares` : `Best: ${loadBest('trail')} squares`) : ''}
        isNew={bestInfo?.isNew ?? false}
        onAgain={start}
        onExit={onExit}
        note="The theoretical maximum is 63 (a full knight's tour from your start square)."
      />
    )
  }

  return (
    <div>
      <GameHeader
        title="Knight trail"
        onExit={onExit}
        left={<ScorePill label="Squares" value={score} />}
        right={<ScorePill label="Clock" value={<span className={cn(Math.ceil(msLeft / 1000) <= 10 && 'text-red-600')}>{Math.ceil(msLeft / 1000)}s</span>} />}
      />
      <BoardFrame>
        <ChessBoard fen={fenWithKnightAt(knightAt)} interactive={false} onSquareTap={onSquareTap} marks={marks} showCoords />
      </BoardFrame>
      <p className="mt-4 text-center text-xs text-muted-foreground">Tap any square a knight&apos;s hop away. Green = visited, gold = you.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 4: Legal or not
// ---------------------------------------------------------------------------

interface LegalCase {
  fen: string
  pieceName: string
  from: string
  to: string
  legal: boolean
  reason: string
}

const PIECE_LETTER: Record<string, string> = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }

function buildLegalCase(stub: PuzzleStub): LegalCase {
  const c = new Chess(stub.fen)
  const turn = c.turn() === 'w' ? 'White' : 'Black'
  const verbose = c.moves({ verbose: true }) as Move[]
  const pieceMoves = verbose.filter((m) => m.piece !== 'p' && m.piece !== 'k')
  const showLegal = Math.random() < 0.5

  if (showLegal && pieceMoves.length > 0) {
    // a genuinely legal move, phrased from→to
    const mv = pieceMoves[Math.floor(Math.random() * pieceMoves.length)]
    return {
      fen: stub.fen,
      pieceName: PIECE_LETTER[mv.piece],
      from: mv.from,
      to: mv.to,
      legal: true,
      reason: `${turn}: ${PIECE_LETTER[mv.piece]} ${mv.from} → ${mv.to} is legal.`,
    }
  }

  // illegal: same piece, a square it cannot legally reach
  // pick a piece from the board of the side to move
  const board = c.board().flat()
  const own = board.filter((p) => p && p.color === c.turn() && p.type !== 'p' && p.type !== 'k') as { square: string; type: string; color: 'w' | 'b' }[]
  if (own.length === 0) {
    // degenerate position — fall back to a legal move so the round still works
    const mv = verbose[Math.floor(Math.random() * verbose.length)]
    return { fen: stub.fen, pieceName: PIECE_LETTER[mv.piece], from: mv.from, to: mv.to, legal: true, reason: `${turn}: ${PIECE_LETTER[mv.piece]} ${mv.from} → ${mv.to} is legal.` }
  }
  const piece = own[Math.floor(Math.random() * own.length)]
  // candidate targets: every square except the ones this piece may legally go to
  const reachable = new Set<string>(verbose.filter((m) => m.from === piece.square).map((m) => m.to))
  const candidates = ALL_SQUARES.filter((s) => s !== piece.square && !reachable.has(s))
  const to = candidates[Math.floor(Math.random() * candidates.length)]

  // why is it illegal?
  let reason = `${turn}: ${PIECE_LETTER[piece.type]} ${piece.square} → ${to} is not a legal move.`
  const probe = new Chess(stub.fen)
  try {
    const mv = probe.move({ from: piece.square as Square, to, promotion: 'q' })
    if (mv && probe.inCheck()) {
      reason = `Illegal — it leaves your own king in check.`
    } else if (mv) {
      reason = `Illegal — that piece may not move there in this position.`
    } else if (knightMovesFrom(piece.square).includes(to) === false && piece.type === 'n') {
      reason = `Illegal — that is not a knight's move.`
    } else {
      reason = `Illegal — the path is blocked or the pattern is wrong.`
    }
  } catch {
    if (piece.type === 'n' && !knightMovesFrom(piece.square).includes(to)) {
      reason = `Illegal — that is not a knight's move.`
    }
  }
  return { fen: stub.fen, pieceName: PIECE_LETTER[piece.type], from: piece.square, to, legal: false, reason }
}

function LegalOrNotGame({ onExit }: { onExit: () => void }) {
  const { profile } = useApp()
  const sound = profile?.soundEnabled ?? true
  const stubs = usePuzzles()
  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<LegalCase[]>([])
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [verdict, setVerdict] = useState<{ correct: boolean; case: LegalCase } | null>(null)
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; previous: number } | null>(null)
  const ROUNDS = 10

  const start = useCallback(() => {
    if (!stubs || stubs.length < ROUNDS) return
    setQueue(shuffle(stubs).slice(0, ROUNDS).map(buildLegalCase))
    setIdx(0)
    setScore(0)
    setVerdict(null)
    setBestInfo(null)
    setPhase('running')
  }, [stubs])

  const current = queue[idx]

  const answer = useCallback(
    (said: 'legal' | 'illegal') => {
      if (!current || verdict) return
      const correct = (said === 'legal') === current.legal
      if (correct) {
        setScore((s) => s + 1)
        playSound('correct', sound)
      } else {
        playSound('wrong', sound)
      }
      setVerdict({ correct, case: current })
      window.setTimeout(() => {
        setVerdict(null)
        if (idx + 1 >= ROUNDS) {
          const finalScore = score + (correct ? 1 : 0)
          setBestInfo(saveBest('legal', finalScore))
          setPhase('over')
        } else {
          setIdx((i) => i + 1)
        }
      }, 1800)
    },
    [current, verdict, idx, score, sound],
  )

  if (phase === 'idle' || phase === 'over') {
    const best = loadBest('legal')
    return phase === 'idle' ? (
      <div className="rounded-xl border bg-card p-6 text-center">
        <h2 className="mb-1 text-xl font-bold">Legal or not</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
          {GAMES[3].description} {stubs ? '' : 'Loading positions…'}
        </p>
        <div className="mb-4 text-sm text-muted-foreground">{GAMES[3].bestLabel(best)}</div>
        <Button onClick={start} disabled={!stubs || stubs.length < ROUNDS}>
          Start · 10 moves
        </Button>
      </div>
    ) : (
      <ResultCard
        score={score}
        bestLine={bestInfo ? (bestInfo.isNew ? `Previous best: ${bestInfo.previous} of 10` : `Best: ${loadBest('legal')} of 10`) : ''}
        isNew={bestInfo?.isNew ?? false}
        onAgain={start}
        onExit={onExit}
      />
    )
  }

  if (!current) return null
  const turn = current.fen.split(' ')[1] === 'b' ? 'Black' : 'White'

  return (
    <div>
      <GameHeader
        title="Legal or not"
        onExit={onExit}
        left={<ScorePill label="Move" value={`${idx + 1}/${ROUNDS}`} />}
        right={<ScorePill label="Score" value={score} />}
      />
      <BoardFrame>
        <ChessBoard fen={current.fen} interactive={false} showCoords marks={verdict ? [{ square: current.to, color: verdict.correct ? 'green' : 'red' }] : []} />
      </BoardFrame>
      <div className="mt-4 text-center">
        {verdict ? (
          <div className="text-sm">
            <span className={cn('font-bold', verdict.correct ? 'text-primary' : 'text-red-600')}>{verdict.correct ? 'Correct. ' : 'Wrong. '}</span>
            <span className="text-muted-foreground">{verdict.case.reason}</span>
          </div>
        ) : (
          <>
            <div className="mb-3 text-sm font-medium">
              {turn} to move — {current.pieceName} {current.from} → {current.to}:
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" className="min-w-28" onClick={() => answer('legal')}>
                Legal
              </Button>
              <Button variant="outline" className="min-w-28" onClick={() => answer('illegal')}>
                Not legal
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 5: Blind moves
// ---------------------------------------------------------------------------

interface BlindStep {
  san: string
  from: string
  to: string
}

interface BlindRound {
  fen: string
  steps: BlindStep[]
}

/** From a real position, extend with N unambiguous non-pawn legal moves. */
function buildBlindRound(stub: PuzzleStub, n = 4): BlindRound | null {
  try {
    const c = new Chess(stub.fen)
    const steps: BlindStep[] = []
    for (let i = 0; i < n; i++) {
      const verbose = c.moves({ verbose: true }) as Move[]
      // unambiguous piece moves only: SAN like "Nf3" (no file/rank disambiguator,
      // no pawn semantics). Keeps "which piece?" a real question.
      const clean = verbose.filter((m) => {
        if (m.piece === 'p') return false
        const san = m.san.replace(/[+#?!]/g, '')
        if (san.includes('x')) {
          // piece captures may still disambiguate ("Ndb4"); strip the 'x' and test
          const letters = san.slice(1).replace('x', '')
          return /^[a-h][1-8]$/.test(letters) === false
        }
        return new RegExp(`^[${m.piece.toUpperCase()}][a-h][1-8]$`).test(san)
      })
      if (clean.length === 0) break
      const mv = clean[Math.floor(Math.random() * clean.length)]
      steps.push({ san: mv.san, from: mv.from, to: mv.to })
      c.move(mv.san)
    }
    if (steps.length < 3) return null
    return { fen: stub.fen, steps }
  } catch {
    return null
  }
}

function BlindMovesGame({ onExit }: { onExit: () => void }) {
  const { profile } = useApp()
  const sound = profile?.soundEnabled ?? true
  const stubs = usePuzzles()
  const [phase, setPhase] = useState<Phase>('idle')
  const [rounds, setRounds] = useState<BlindRound[]>([])
  const [roundIdx, setRoundIdx] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [score, setScore] = useState(0)
  // memorize → dark → tapFrom → tapTo → verdict
  const [stage, setStage] = useState<'memorize' | 'dark'>('memorize')
  const [picked, setPicked] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<{ correct: boolean; step: BlindStep } | null>(null)
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; previous: number } | null>(null)
  const ROUNDS = 3
  const MOVES_PER_ROUND = 4
  const MEMORIZE_MS = 4000

  const start = useCallback(() => {
    if (!stubs) return
    const built = shuffle(stubs)
      .map((s) => buildBlindRound(s, MOVES_PER_ROUND))
      .filter((r): r is BlindRound => r !== null)
      .slice(0, ROUNDS)
    if (built.length === 0) return
    setRounds(built)
    setRoundIdx(0)
    setStepIdx(0)
    setScore(0)
    setBestInfo(null)
    setStage('memorize')
    setPicked(null)
    setVerdict(null)
    setPhase('running')
  }, [stubs])

  const round = rounds[roundIdx]
  const step = round?.steps[stepIdx]

  // memorize countdown
  useEffect(() => {
    if (phase !== 'running' || stage !== 'memorize' || !round) return
    const t = window.setTimeout(() => setStage('dark'), MEMORIZE_MS)
    return () => window.clearTimeout(t)
  }, [phase, stage, round])

  const finish = useCallback(
    (finalScore: number) => {
      setBestInfo(saveBest('blind', finalScore))
      setPhase('over')
    },
    [],
  )

  const onSquareTap = useCallback(
    (sq: string) => {
      if (phase !== 'running' || stage !== 'dark' || !step || verdict) return
      if (!picked) {
        setPicked(sq)
        playSound('click', sound)
        return
      }
      const from = picked
      const to = sq
      setPicked(null)
      const correct = from === step.from && to === step.to
      if (correct) {
        setScore((s) => s + 1)
        playSound('correct', sound)
      } else {
        playSound('wrong', sound)
      }
      setVerdict({ correct, step })
      window.setTimeout(() => {
        setVerdict(null)
        const nextScore = score + (correct ? 1 : 0)
        if (stepIdx + 1 >= round.steps.length) {
          if (roundIdx + 1 >= ROUNDS) {
            finish(nextScore)
          } else {
            setRoundIdx((r) => r + 1)
            setStepIdx(0)
            setStage('memorize')
          }
        } else {
          setStepIdx((s) => s + 1)
        }
      }, 1500)
    },
    [phase, stage, step, verdict, picked, score, stepIdx, roundIdx, round, sound, finish],
  )

  if (phase === 'idle' || phase === 'over') {
    const best = loadBest('blind')
    return phase === 'idle' ? (
      <div className="rounded-xl border bg-card p-6 text-center">
        <h2 className="mb-1 text-xl font-bold">Blind moves</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
          {GAMES[4].description} {stubs ? '' : 'Loading positions…'}
        </p>
        <div className="mb-4 text-sm text-muted-foreground">{GAMES[4].bestLabel(best)}</div>
        <Button onClick={start} disabled={!stubs}>
          Start · 3 rounds
        </Button>
      </div>
    ) : (
      <ResultCard
        score={score}
        bestLine={bestInfo ? (bestInfo.isNew ? `Previous best: ${bestInfo.previous} of 12` : `Best: ${loadBest('blind')} of 12`) : ''}
        isNew={bestInfo?.isNew ?? false}
        onAgain={start}
        onExit={onExit}
      />
    )
  }

  if (!round || !step) return null

  const marks: Mark[] = verdict
    ? [
        { square: verdict.step.from, color: 'green' },
        { square: verdict.step.to, color: verdict.correct ? 'green' : 'red' },
      ]
    : picked
      ? [{ square: picked, color: 'yellow' }]
      : []

  return (
    <div>
      <GameHeader
        title="Blind moves"
        onExit={onExit}
        left={<ScorePill label="Round" value={`${roundIdx + 1}/${ROUNDS}`} />}
        right={<ScorePill label="Score" value={score} />}
      />
      <BoardFrame>
        {stage === 'memorize' ? (
          <>
            <ChessBoard fen={round.fen} interactive={false} showCoords />
            <p className="mt-3 text-center text-sm text-muted-foreground">Memorize the position…</p>
          </>
        ) : (
          <>
            <ChessBoard fen={EMPTY_FEN} interactive={false} onSquareTap={onSquareTap} marks={marks} showCoords />
            <div className="mt-3 text-center">
              {verdict ? (
                <div className="text-sm">
                  <span className={cn('font-bold', verdict.correct ? 'text-primary' : 'text-red-600')}>{verdict.correct ? 'Correct. ' : 'Wrong. '}</span>
                  <span className="text-muted-foreground">
                    {verdict.step.san} was {verdict.step.from} → {verdict.step.to}.
                  </span>
                </div>
              ) : (
                <div className="text-sm">
                  Play <span className="font-mono font-bold">{step.san}</span>
                  {picked ? <span className="ml-2 text-xs text-muted-foreground">from {picked} — now tap the destination</span> : <span className="ml-2 text-xs text-muted-foreground">tap the from square</span>}
                </div>
              )}
            </div>
          </>
        )}
      </BoardFrame>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

const GAME_ICON: Record<BrainGame, React.ComponentType<{ className?: string }>> = {
  checks: Crosshair,
  materush: Zap,
  trail: Spline,
  legal: Gavel,
  blind: EyeOff,
}

export function BrainGamesView() {
  const { profile } = useApp()
  const [active, setActive] = useState<BrainGame | null>(null)

  const exit = useCallback(() => setActive(null), [])

  if (active === 'checks') return <FindTheCheckGame onExit={exit} />
  if (active === 'materush') return <MateRushGame onExit={exit} />
  if (active === 'trail') return <KnightTrailGame onExit={exit} />
  if (active === 'legal') return <LegalOrNotGame onExit={exit} />
  if (active === 'blind') return <BlindMovesGame onExit={exit} />

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Brain games</h1>
          <p className="text-sm text-muted-foreground">Five short games, each one named skill, honest local bests.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((g) => {
          const Icon = GAME_ICON[g.id]
          const best = loadBest(g.id)
          return (
            <button
              key={g.id}
              onClick={() => {
                playSound('click', true)
                setActive(g.id)
              }}
              className="group rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-semibold">{g.title}</h2>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{g.tagline}</div>
              <p className="mt-2 text-sm text-muted-foreground">{g.description}</p>
              <div className="mt-3 text-xs font-medium text-muted-foreground">{g.bestLabel(best)}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
