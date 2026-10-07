'use client'
// Coordinates Sprint: vision training on a bare board. Thirty seconds, a
// named square at a time: find it and tap it. The skill under every tactic
// is knowing the board without thinking, and this is how that gets built.
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Crosshair, Eye, EyeClosed, Shuffle, Timer } from 'lucide-react'

type Mode = 'white' | 'black' | 'both'
type Phase = 'idle' | 'running' | 'over'

const SPRINT_SECONDS = 30
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'
const FILES = 'abcdefgh'
const RANKS = '12345678'

const MODE_LABEL: Record<Mode, string> = {
  white: "White's eyes",
  black: "Black's eyes",
  both: 'Both, mixed',
}

const MODE_HINT: Record<Mode, string> = {
  white: 'Board faces White, like every game you start.',
  black: 'Board faces Black, flipped and unfamiliar on purpose.',
  both: 'The board re-flips on every square. No mercy.',
}

interface SprintResult {
  score: number
  mistakes: number
  xpGain: number
  isNewBest: boolean
  previousBest: number
}

function randomSquare(): string {
  return FILES[Math.floor(Math.random() * 8)] + RANKS[Math.floor(Math.random() * 8)]
}

export function VisionPanel() {
  const { profile, setProfile } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<Mode>('white')
  const [target, setTarget] = useState('e4')
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [score, setScore] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [timeLeft, setTimeLeft] = useState(SPRINT_SECONDS)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [bests, setBests] = useState<Record<Mode, number> | null>(null)
  const [result, setResult] = useState<SprintResult | null>(null)

  const timeRef = useRef(SPRINT_SECONDS)
  const scoreRef = useRef(0)
  const mistakesRef = useRef(0)
  const finishedRef = useRef(false)
  const soundEnabled = profile?.soundEnabled ?? true

  const fetchBests = useCallback(() => {
    fetch('/api/vision/sprint')
      .then((r) => readJson<{ best?: Record<Mode, number> }>(r))
      .then((d) => {
        if (d?.best) setBests({ white: d.best.white ?? 0, black: d.best.black ?? 0, both: d.best.both ?? 0 })
      })
      .catch(() => {
        /* bests are a nicety, sprinting works without them */
      })
  }, [])

  useEffect(() => {
    fetchBests()
  }, [fetchBests])

  const advanceTarget = useCallback((m: Mode) => {
    setTarget(randomSquare())
    setOrientation(m === 'white' ? 'w' : m === 'black' ? 'b' : Math.random() < 0.5 ? 'w' : 'b')
  }, [])

  const finishSprint = useCallback(
    async (finalScore: number, finalMistakes: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      setPhase('over')
      try {
        const res = await fetch('/api/vision/sprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            score: finalScore,
            mistakes: finalMistakes,
            seconds: SPRINT_SECONDS,
            dayKey: new Date().toLocaleDateString('sv-SE'),
          }),
        })
        const d = await readJson<{ profile?: ProfileData; xpGain?: number; isNewBest?: boolean; previousBest?: number }>(res)
        if (d.profile) setProfile(d.profile)
        const resData: SprintResult = {
          score: finalScore,
          mistakes: finalMistakes,
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        }
        setResult(resData)
        if (resData.isNewBest) playSound('win', soundEnabled)
        setBests((b) => (b ? { ...b, [mode]: Math.max(b[mode], finalScore) } : b))
      } catch {
        setResult({ score: finalScore, mistakes: finalMistakes, xpGain: 0, isNewBest: false, previousBest: 0 })
      }
    },
    [mode, setProfile, soundEnabled],
  )

  const startSprint = useCallback(
    (m: Mode) => {
      finishedRef.current = false
      setMode(m)
      scoreRef.current = 0
      mistakesRef.current = 0
      setScore(0)
      setMistakes(0)
      setTimeLeft(SPRINT_SECONDS)
      timeRef.current = SPRINT_SECONDS
      setResult(null)
      setFlashes([])
      playSound('click', soundEnabled)
      setPhase('running')
      advanceTarget(m)
    },
    [advanceTarget, soundEnabled],
  )

  // sprint clock: refs for the counters so the interval never restarts mid-run
  useEffect(() => {
    if (phase !== 'running') return
    const iv = setInterval(() => {
      timeRef.current -= 1
      setTimeLeft(Math.max(0, timeRef.current))
      if (timeRef.current <= 0) {
        clearInterval(iv)
        void finishSprint(scoreRef.current, mistakesRef.current)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, finishSprint])

  const flash = useCallback((marks: FlashMark[], ms = 450) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), ms)
  }, [])

  const onSquareTap = useCallback(
    (square: string) => {
      if (phase !== 'running') return
      if (square === target) {
        scoreRef.current += 1
        setScore(scoreRef.current)
        playSound('correct', soundEnabled)
        flash([{ square, color: 'green' }])
        advanceTarget(mode)
      } else {
        mistakesRef.current += 1
        setMistakes(mistakesRef.current)
        playSound('wrong', soundEnabled)
        flash([{ square, color: 'red' }])
      }
    },
    [phase, target, mode, advanceTarget, flash, soundEnabled],
  )

  /* ---------- idle ---------- */

  if (phase === 'idle') {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold">Vision: coordinates sprint</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Thirty seconds, one named square at a time: find it and tap it. Board coordinates are hidden during the run, the way a real game never labels anything for you. This is the skill under every tactic.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(['white', 'black', 'both'] as const).map((m) => (
              <button
                key={m}
                onClick={() => startSprint(m)}
                className="rounded-xl border border-border p-5 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center gap-2 font-display text-base font-bold">
                  {m === 'white' && <Eye className="h-4 w-4 text-primary" />}
                  {m === 'black' && <EyeClosed className="h-4 w-4 text-primary" />}
                  {m === 'both' && <Shuffle className="h-4 w-4 text-primary" />}
                  {MODE_LABEL[m]}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{MODE_HINT[m]}</p>
                <div className="mt-3 text-xs font-semibold text-muted-foreground">
                  {bests ? (bests[m] > 0 ? `Best: ${bests[m]} squares` : 'No runs yet') : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ---------- over ---------- */

  if (phase === 'over' && result) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl bg-card p-6 text-center shadow-sm">
          <Crosshair className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[var(--gold)]' : 'text-primary')} />
          <div className="mt-3 font-display text-4xl font-extrabold tabular-nums">{result.score}</div>
          <div className="text-sm text-muted-foreground">
            squares found in {SPRINT_SECONDS}s · {result.mistakes} {result.mistakes === 1 ? 'misstep' : 'missteps'} · {MODE_LABEL[mode]}
          </div>
          {result.isNewBest ? (
            <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-bold">New personal best.</div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Best in this perspective: {result.previousBest}</div>
          )}
          {result.xpGain > 0 && <div className="mt-2 text-sm font-semibold">+{result.xpGain} XP</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Button className="btn-hero" onClick={() => startSprint(mode)}>
              <Timer className="h-4 w-4" /> Go again
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              Change perspective
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- running ---------- */

  const timeLabel = `0:${String(timeLeft).padStart(2, '0')}`

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="mx-auto w-full max-w-[600px]">
        <ChessBoard
          fen={EMPTY_FEN}
          orientation={orientation}
          onSquareTap={onSquareTap}
          interactive={false}
          showCoords={false}
          showLegal={false}
          flashes={flashes}
          theme={profile?.theme ?? 'green'}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-card p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sprint · {MODE_LABEL[mode]}</div>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            Tap the square
          </p>
          <div className="mt-1 font-display text-5xl font-extrabold tracking-wide">{target}</div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono font-display text-3xl font-extrabold tabular-nums">{timeLabel}</span>
            <span className="text-sm text-muted-foreground">
              {score} found · {mistakes} missed
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${(timeLeft / SPRINT_SECONDS) * 100}%` }} />
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => void finishSprint(scoreRef.current, mistakesRef.current)}
          >
            End run
          </Button>
        </div>
        <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
          A wrong tap does not move the target: the square stays until you find it. Accuracy matters, speed matters more.
        </div>
      </div>
    </div>
  )
}
