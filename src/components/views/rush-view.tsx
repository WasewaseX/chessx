'use client'
import { readJson } from '@/lib/api-client'
// Puzzle Rush: speed solving against the clock or survival with 3 strikes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import type { Puzzle } from '@/content/schema'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Loader2, Timer, Swords, Trophy, Zap } from 'lucide-react'

type Mode = 'threeMin' | 'survival'
type Phase = 'idle' | 'loading' | 'running' | 'over'

const THREE_MIN_SECONDS = 180

interface RunResult {
  score: number
  total: number
  seconds: number
  xpGain: number
  isNewBest: boolean
  previousBest: number
}

export function RushPanel() {
  const { profile, setProfile } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<Mode>('threeMin')
  const [batch, setBatch] = useState<Puzzle[]>([])
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [misses, setMisses] = useState(0)
  const [timeLeft, setTimeLeft] = useState(THREE_MIN_SECONDS)
  const [elapsed, setElapsed] = useState(0)
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [feedback, setFeedback] = useState<'none' | 'good' | 'bad'>('none')
  const [result, setResult] = useState<RunResult | null>(null)

  const gameRef = useRef(new Chess())
  const plyRef = useRef(0)
  const busyRef = useRef(false)
  const finishedRef = useRef(false)
  const soundEnabled = profile?.soundEnabled ?? true

  const puzzle = batch[idx] ?? null
  const solverSide = puzzle ? new Chess(puzzle.fen).turn() : 'w'

  const checkSquare = (() => {
    try {
      const g = new Chess(fen)
      if (!g.isCheck()) return null
      return g.board().flat().find((s) => s && s.type === 'k' && s.color === g.turn())?.square ?? null
    } catch {
      return null
    }
  })()

  const flash = useCallback((marks: FlashMark[], ms = 900) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), ms)
  }, [])

  const loadBatch = useCallback(async () => {
    setPhase('loading')
    try {
      const res = await fetch('/api/puzzles/rush')
      const d = await readJson<{ puzzles?: Puzzle[] }>(res)
      setBatch(d.puzzles ?? [])
      return (d.puzzles ?? []) as Puzzle[]
    } catch {
      setBatch([])
      return []
    }
  }, [])

  const startRun = useCallback(
    async (m: Mode) => {
      const puzzles = batch.length > 0 ? batch : await loadBatch()
      if (puzzles.length === 0) {
        setPhase('idle')
        return
      }
      setMode(m)
      setIdx(0)
      setScore(0)
      setMisses(0)
      setTimeLeft(THREE_MIN_SECONDS)
      setElapsed(0)
      setResult(null)
      setFeedback('none')
      finishedRef.current = false
      const first = puzzles[0]
      gameRef.current = new Chess(first.fen)
      plyRef.current = 0
      setFen(first.fen)
      setLastMove(null)
      setPhase('running')
    },
    [batch, loadBatch],
  )

  const finishRun = useCallback(
    async (finalScore: number, finalMisses: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      setPhase('over')
      const seconds = mode === 'threeMin' ? THREE_MIN_SECONDS - timeLeft : elapsed
      try {
        const res = await fetch('/api/puzzles/rush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            score: finalScore,
            total: finalScore + finalMisses,
            seconds: Math.max(0, seconds),
            dayKey: new Date().toLocaleDateString('sv-SE'),
          }),
        })
        const d = await readJson<{ profile?: ProfileData }>(res)
        if (d.profile) setProfile(d.profile)
        setResult({
          score: finalScore,
          total: finalScore + finalMisses,
          seconds: Math.max(0, seconds),
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        })
      } catch {
        setResult({ score: finalScore, total: finalScore + finalMisses, seconds, xpGain: 0, isNewBest: false, previousBest: 0 })
      }
    },
    [mode, timeLeft, elapsed, setProfile],
  )

  // clocks
  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => {
      if (mode === 'threeMin') {
        setTimeLeft((s) => {
          if (s <= 1) {
            clearInterval(t)
            void finishRun(score, misses)
            return 0
          }
          return s - 1
        })
      } else {
        setElapsed((s) => s + 1)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [phase, mode, score, misses, finishRun])

  const advance = useCallback(
    (newScore: number, newMisses: number) => {
      setFeedback('none')
      if (mode === 'survival' && newMisses >= 3) {
        void finishRun(newScore, newMisses)
        return
      }
      const next = idx + 1
      if (next >= batch.length) {
        // out of puzzles: run ends, count what was done
        void finishRun(newScore, newMisses)
        return
      }
      const p = batch[next]
      gameRef.current = new Chess(p.fen)
      plyRef.current = 0
      setIdx(next)
      setFen(p.fen)
      setLastMove(null)
      busyRef.current = false
    },
    [batch, idx, mode, finishRun],
  )

  const applyScriptedReply = useCallback(
    (p: Puzzle) => {
      const g = gameRef.current
      const expected = p.solution.split(' ').filter(Boolean)
      const reply = expected[plyRef.current]
      if (!reply) return
      try {
        const rmv = g.move(reply)
        if (rmv) {
          plyRef.current += 1
          setFen(g.fen())
          setLastMove({ from: rmv.from, to: rmv.to })
          playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
        }
      } catch {
        /* validated content */
      }
    },
    [soundEnabled],
  )

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'running' || busyRef.current || !puzzle) return
      const g = gameRef.current
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? undefined })
      } catch {
        return
      }
      if (!mv) return

      const expected = puzzle.solution.split(' ').filter(Boolean)
      const expectedSan = expected[plyRef.current]?.replace(/[+#]/g, '')
      const sanNorm = mv.san.replace(/[+#]/g, '')

      if (sanNorm !== expectedSan) {
        // miss: undo, show the idea briefly, strike
        g.undo()
        playSound('wrong', soundEnabled)
        setFeedback('bad')
        const newMisses = misses + 1
        setMisses(newMisses)
        busyRef.current = true
        try {
          const probe = new Chess(g.fen())
          const next = probe.move(expected[plyRef.current])
          if (next) flash([{ square: next.from, color: 'gold' }], 800)
        } catch {
          /* validated content */
        }
        setTimeout(() => {
          busyRef.current = false
          advance(score, newMisses)
        }, 750)
        return
      }

      // correct
      plyRef.current += 1
      setFen(g.fen())
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)

      const remaining = expected.length - plyRef.current
      if (remaining === 0) {
        const newScore = score + 1
        setScore(newScore)
        setFeedback('good')
        playSound('correct', soundEnabled)
        busyRef.current = true
        setTimeout(() => {
          busyRef.current = false
          advance(newScore, misses)
        }, 450)
      } else if (expected[plyRef.current]) {
        // opponent reply comes fast in rush
        busyRef.current = true
        setTimeout(() => {
          busyRef.current = false
          applyScriptedReply(puzzle)
        }, 220)
      }
    },
    [phase, puzzle, misses, score, advance, flash, soundEnabled, applyScriptedReply],
  )

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold">Puzzle Rush</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Solve as many puzzles as you can. Wrong moves cost time in the 3 minute run, and cost strikes in survival. Three strikes and the run is over.
          </p>
          {phase === 'loading' ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the puzzle pool…
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => void startRun('threeMin')}
                className="group rounded-xl border border-border p-6 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center gap-2 font-display text-lg font-bold">
                  <Timer className="h-5 w-5 text-primary" /> 3 minutes
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Beat the clock. Score as many solves as possible before time runs out.</p>
                <div className="mt-3 text-xs font-semibold text-muted-foreground">Best: {profile?.rushBest3m ?? 0} solves</div>
              </button>
              <button
                onClick={() => void startRun('survival')}
                className="group rounded-xl border border-border p-6 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center gap-2 font-display text-lg font-bold">
                  <Swords className="h-5 w-5 text-primary" /> Survival
                </div>
                <p className="mt-1 text-sm text-muted-foreground">No clock, no mercy. Three wrong moves end the run.</p>
                <div className="mt-3 text-xs font-semibold text-muted-foreground">Best: {profile?.rushBestSurvival ?? 0} solves</div>
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'over' && result) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl bg-card p-6 text-center shadow-sm">
          <Trophy className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[#e6a82c]' : 'text-primary')} />
          <div className="mt-3 font-display text-4xl font-extrabold">{result.score}</div>
          <div className="text-sm text-muted-foreground">
            solved in {mode === 'threeMin' ? '3 minutes' : `${result.seconds}s survival`} · {result.total - result.score} missed
          </div>
          {result.isNewBest ? (
            <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-bold">New personal best.</div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Best: {result.previousBest}</div>
          )}
          <div className="mt-2 text-sm font-semibold">+{result.xpGain} XP</div>
          <div className="mt-6 flex justify-center gap-2">
            <Button className="btn-hero" onClick={() => void startRun(mode)}>
              <Zap className="h-4 w-4" /> Play again
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              Change mode
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!puzzle) return null

  const timeLabel =
    mode === 'threeMin'
      ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`
      : `${elapsed}s`

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="relative mx-auto w-full max-w-[600px]">
        <ChessBoard
          fen={fen}
          orientation={solverSide}
          onMove={onMove}
          movableSide={solverSide}
          interactive
          lastMove={lastMove}
          checkSquare={checkSquare}
          flashes={flashes}
        />
        {feedback === 'good' && (
          <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-md bg-primary px-3 py-1 text-sm font-bold text-primary-foreground shadow">
            Solved
          </div>
        )}
        {feedback === 'bad' && (
          <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-md bg-destructive px-3 py-1 text-sm font-bold text-white shadow">
            Missed
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {mode === 'threeMin' ? 'Rush: 3 minutes' : 'Rush: survival'}
            </div>
            <div className="flex items-center gap-1 text-sm font-bold">
              {mode === 'survival' &&
                [0, 1, 2].map((i) => (
                  <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i < misses ? 'bg-destructive' : 'bg-muted')} />
                ))}
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono font-display text-4xl font-extrabold tabular-nums">{timeLabel}</span>
            <span className="text-sm text-muted-foreground">
              {score} solved{mode === 'threeMin' ? '' : ` · ${misses} ${misses === 1 ? 'miss' : 'misses'}`}
            </span>
          </div>
          <div className="mt-3 text-sm">
            <span className="font-bold">{solverSide === 'w' ? 'White' : 'Black'} to play</span>
            <span className="text-muted-foreground"> · puzzle {idx + 1} of {batch.length}</span>
          </div>
          {mode === 'threeMin' && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(timeLeft / THREE_MIN_SECONDS) * 100}%` }} />
            </div>
          )}
          <Button variant="outline" className="mt-4 w-full" onClick={() => void finishRun(score, misses)}>
            End run
          </Button>
        </div>
        <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
          Speed mode: the guided hints are off. A wrong move moves you to the next puzzle right away. In survival, three misses end the run.
        </div>
      </div>
    </div>
  )
}
