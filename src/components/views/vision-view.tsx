'use client'
// Vision training: two drills.
// Coordinates sprint: thirty seconds on a bare board, a named square at a
// time. The skill under every tactic is knowing the board without thinking.
// Piece hunt: a position flashes for four seconds, then the board goes dark
// and you name the piece that stood on the square they ask for. Blindfold
// memory, built from real positions.
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { PUZZLES } from '@/content/puzzles'
import type { Puzzle } from '@/content/schema'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Brain, Crosshair, Eye, EyeClosed, Shuffle, Timer } from 'lucide-react'

type Mode = 'white' | 'black' | 'both' | 'hunt'
type Phase = 'idle' | 'running' | 'over'
type HuntPhase = 'memorize' | 'question' | 'reveal'

const SPRINT_SECONDS = 30
const HUNT_ROUNDS = 5
const MEMORIZE_SECONDS = 4
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'
const FILES = 'abcdefgh'
const RANKS = '12345678'

const MODE_LABEL: Record<Mode, string> = {
  white: "White's eyes",
  black: "Black's eyes",
  both: 'Both, mixed',
  hunt: 'Piece hunt',
}

const MODE_HINT: Record<Mode, string> = {
  white: 'Board faces White, like every game you start.',
  black: 'Board faces Black, flipped and unfamiliar on purpose.',
  both: 'The board re-flips on every square. No mercy.',
  hunt: 'Four seconds to memorize, then name the piece on the square they ask for.',
}

interface SprintResult {
  score: number
  mistakes: number
  seconds: number
  xpGain: number
  isNewBest: boolean
  previousBest: number
}

interface PieceOpt {
  key: string
  color: 'w' | 'b'
  type: string
}

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

function randomSquare(): string {
  return FILES[Math.floor(Math.random() * 8)] + RANKS[Math.floor(Math.random() * 8)]
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[r]] = [arr[r], arr[i]]
  }
  return arr
}

/** Six piece choices for a square: the real piece plus five distractors. */
function buildOptions(fen: string, square: string): PieceOpt[] {
  const g = new Chess(fen)
  const pieces = g.board().flat().filter(Boolean) as Array<{ square: string; color: 'w' | 'b'; type: string }>
  const correct = pieces.find((pc) => pc.square === square)
  if (!correct) return []
  const seen = new Set([correct.color + correct.type])
  const distractors: PieceOpt[] = []
  for (const pc of pieces) {
    const k = pc.color + pc.type
    if (seen.has(k)) continue
    seen.add(k)
    distractors.push({ key: k, color: pc.color, type: pc.type })
  }
  for (const c of ['w', 'b'] as const) {
    for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
      if (distractors.length >= 5) break
      const k = c + t
      if (seen.has(k)) continue
      seen.add(k)
      distractors.push({ key: k, color: c, type: t })
    }
  }
  return shuffle([correct, ...distractors.slice(0, 5)].map((pc) => ({ key: pc.color + pc.type, color: pc.color, type: pc.type })))
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

  // piece hunt state
  const [huntPhase, setHuntPhase] = useState<HuntPhase | null>(null)
  const [huntRound, setHuntRound] = useState(0)
  const [huntFen, setHuntFen] = useState(EMPTY_FEN)
  const [huntSquare, setHuntSquare] = useState('')
  const [huntOptions, setHuntOptions] = useState<PieceOpt[]>([])
  const [huntPick, setHuntPick] = useState<string | null>(null)
  const [huntCorrectKey, setHuntCorrectKey] = useState<string | null>(null)
  const [huntAnswerName, setHuntAnswerName] = useState('piece')
  const [memTime, setMemTime] = useState(MEMORIZE_SECONDS)

  const timeRef = useRef(SPRINT_SECONDS)
  const scoreRef = useRef(0)
  const mistakesRef = useRef(0)
  const finishedRef = useRef(false)
  const soundEnabled = profile?.soundEnabled ?? true
  const huntPuzzlesRef = useRef<Puzzle[]>([])
  const huntTokenRef = useRef(0)
  const huntTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const memTimeRef = useRef(MEMORIZE_SECONDS)
  const elapsedRef = useRef(0)

  const clearHuntTimers = useCallback(() => {
    for (const t of huntTimersRef.current) clearInterval(t as unknown as ReturnType<typeof setTimeout>)
    huntTimersRef.current = []
  }, [])

  // every pending hunt timer dies with the component
  useEffect(() => clearHuntTimers, [clearHuntTimers])

  const fetchBests = useCallback(() => {
    fetch('/api/vision/sprint')
      .then((r) => readJson<{ best?: Record<Mode, number> }>(r))
      .then((d) => {
        if (d?.best)
          setBests({ white: d.best.white ?? 0, black: d.best.black ?? 0, both: d.best.both ?? 0, hunt: d.best.hunt ?? 0 })
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

  /* ---------- piece hunt ---------- */

  const finishHunt = useCallback(
    async (finalScore: number, finalMistakes: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      clearHuntTimers()
      setPhase('over')
      try {
        const res = await fetch('/api/vision/sprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'hunt',
            score: finalScore,
            mistakes: finalMistakes,
            seconds: elapsedRef.current,
            dayKey: new Date().toLocaleDateString('sv-SE'),
          }),
        })
        const d = await readJson<{ profile?: ProfileData; xpGain?: number; isNewBest?: boolean; previousBest?: number }>(res)
        if (d.profile) setProfile(d.profile)
        setResult({
          score: finalScore,
          mistakes: finalMistakes,
          seconds: elapsedRef.current,
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        })
        if (d.isNewBest) playSound('win', soundEnabled)
        setBests((b) => (b ? { ...b, hunt: Math.max(b.hunt, finalScore) } : b))
      } catch {
        setResult({ score: finalScore, mistakes: finalMistakes, seconds: elapsedRef.current, xpGain: 0, isNewBest: false, previousBest: 0 })
      }
    },
    [clearHuntTimers, setProfile, soundEnabled],
  )

  const beginMemorize = useCallback(
    (round: number) => {
      const p = huntPuzzlesRef.current[round]
      if (!p) {
        void finishHunt(scoreRef.current, mistakesRef.current)
        return
      }
      const token = ++huntTokenRef.current
      clearHuntTimers()
      setHuntRound(round)
      setHuntFen(p.fen)
      setHuntPick(null)
      setFlashes([])
      setHuntPhase('memorize')
      memTimeRef.current = MEMORIZE_SECONDS
      setMemTime(MEMORIZE_SECONDS)
      const iv = setInterval(() => {
        if (huntTokenRef.current !== token) {
          clearInterval(iv)
          return
        }
        memTimeRef.current -= 1
        setMemTime(Math.max(0, memTimeRef.current))
        if (memTimeRef.current <= 0) {
          clearInterval(iv)
          // the board goes dark: empty fen, then the question
          const g = new Chess(p.fen)
          const occupied = (g.board().flat().filter(Boolean) as Array<{ square: string }>).map((pc) => pc.square)
          const square = occupied[Math.floor(Math.random() * occupied.length)] ?? 'e4'
          const realPiece = g.get(square as Square)
          setHuntSquare(square)
          setHuntCorrectKey(realPiece ? realPiece.color + realPiece.type : null)
          setHuntAnswerName(realPiece ? `${realPiece.color === 'w' ? 'white' : 'black'} ${PIECE_NAME[realPiece.type]}` : 'piece')
          setHuntOptions(buildOptions(p.fen, square))
          setHuntFen(EMPTY_FEN)
          setHuntPhase('question')
        }
      }, 1000)
      huntTimersRef.current.push(iv)
    },
    [clearHuntTimers, finishHunt],
  )

  const startHunt = useCallback(() => {
    finishedRef.current = false
    clearHuntTimers()
    const target = profile?.puzzleRating ?? 800
    const deal = shuffle([...PUZZLES].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)).slice(0, Math.min(14, PUZZLES.length))).slice(0, HUNT_ROUNDS)
    if (deal.length === 0) return
    huntPuzzlesRef.current = deal
    scoreRef.current = 0
    mistakesRef.current = 0
    elapsedRef.current = 0
    setMode('hunt')
    setScore(0)
    setMistakes(0)
    setResult(null)
    playSound('click', soundEnabled)
    setPhase('running')
    beginMemorize(0)
  }, [profile?.puzzleRating, soundEnabled, beginMemorize, clearHuntTimers])

  // hunt elapsed clock (whole run, not per round)
  useEffect(() => {
    if (phase !== 'running' || mode !== 'hunt') return
    const iv = setInterval(() => {
      elapsedRef.current += 1
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, mode])

  const resolvePick = useCallback(
    (opt: PieceOpt) => {
      if (huntPhase !== 'question') return
      const isRight = huntCorrectKey !== null && opt.key === huntCorrectKey
      setHuntPick(opt.key)
      if (isRight) {
        scoreRef.current += 1
        setScore(scoreRef.current)
        playSound('correct', soundEnabled)
        const token = huntTokenRef.current
        const t = setTimeout(() => {
          if (huntTokenRef.current !== token) return
          if (huntRound + 1 >= HUNT_ROUNDS) void finishHunt(scoreRef.current, mistakesRef.current)
          else beginMemorize(huntRound + 1)
        }, 800)
        huntTimersRef.current.push(t)
      } else {
        mistakesRef.current += 1
        setMistakes(mistakesRef.current)
        playSound('wrong', soundEnabled)
        // reveal the truth for a beat before the next round
        setHuntFen(huntPuzzlesRef.current[huntRound]?.fen ?? EMPTY_FEN)
        setFlashes([{ square: huntSquare, color: 'gold' }])
        setHuntPhase('reveal')
        const token = huntTokenRef.current
        const t = setTimeout(() => {
          if (huntTokenRef.current !== token) return
          setFlashes([])
          if (huntRound + 1 >= HUNT_ROUNDS) void finishHunt(scoreRef.current, mistakesRef.current)
          else beginMemorize(huntRound + 1)
        }, 1600)
        huntTimersRef.current.push(t)
      }
    },
    [huntPhase, huntCorrectKey, huntRound, huntSquare, beginMemorize, finishHunt, soundEnabled],
  )

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
          seconds: SPRINT_SECONDS,
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        }
        setResult(resData)
        if (resData.isNewBest) playSound('win', soundEnabled)
        setBests((b) => (b ? { ...b, [mode]: Math.max(b[mode], finalScore) } : b))
      } catch {
        setResult({ score: finalScore, mistakes: finalMistakes, seconds: SPRINT_SECONDS, xpGain: 0, isNewBest: false, previousBest: 0 })
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

  // sprint clock: refs for the counters so the interval never restarts mid-run.
  // The hunt is round-based, not timed: it never touches this clock.
  useEffect(() => {
    if (phase !== 'running' || mode === 'hunt') return
    const iv = setInterval(() => {
      timeRef.current -= 1
      setTimeLeft(Math.max(0, timeRef.current))
      if (timeRef.current <= 0) {
        clearInterval(iv)
        void finishSprint(scoreRef.current, mistakesRef.current)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, mode, finishSprint])

  const flash = useCallback((marks: FlashMark[], ms = 450) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), ms)
  }, [])

  const onSquareTap = useCallback(
    (square: string) => {
      if (phase !== 'running' || mode === 'hunt') return
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
          <h2 className="font-display text-xl font-extrabold">Vision training</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Two drills, one goal: know the board without thinking. The sprint trains coordinates, the hunt trains your blindfold memory. Both run on real positions and honest bests.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
            <button
              onClick={startHunt}
              className="rounded-xl border border-border p-5 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
            >
              <div className="flex items-center gap-2 font-display text-base font-bold">
                <Brain className="h-4 w-4 text-primary" /> {MODE_LABEL.hunt}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{MODE_HINT.hunt}</p>
              <div className="mt-3 text-xs font-semibold text-muted-foreground">
                {bests ? (bests.hunt > 0 ? `Best: ${bests.hunt} of ${HUNT_ROUNDS}` : 'No runs yet') : ''}
              </div>
            </button>
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
          {mode === 'hunt' ? (
            <Brain className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[var(--gold)]' : 'text-primary')} />
          ) : (
            <Crosshair className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[var(--gold)]' : 'text-primary')} />
          )}
          <div className="mt-3 font-display text-4xl font-extrabold tabular-nums">{result.score}</div>
          <div className="text-sm text-muted-foreground">
            {mode === 'hunt'
              ? `of ${HUNT_ROUNDS} named · ${result.mistakes} ${result.mistakes === 1 ? 'miss' : 'misses'} · ${result.seconds}s`
              : `squares found in ${SPRINT_SECONDS}s · ${result.mistakes} ${result.mistakes === 1 ? 'misstep' : 'missteps'} · ${MODE_LABEL[mode]}`}
          </div>
          {result.isNewBest ? (
            <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-bold">New personal best.</div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Best: {result.previousBest}</div>
          )}
          {result.xpGain > 0 && <div className="mt-2 text-sm font-semibold">+{result.xpGain} XP</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Button className="btn-hero" onClick={() => (mode === 'hunt' ? startHunt() : startSprint(mode))}>
              <Timer className="h-4 w-4" /> Go again
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              {mode === 'hunt' ? 'Other drills' : 'Change perspective'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- running: piece hunt ---------- */

  if (mode === 'hunt') {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="relative mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={huntFen}
            orientation="w"
            interactive={false}
            showCoords={huntPhase !== 'memorize'}
            showLegal={false}
            flashes={flashes}
            theme={profile?.theme ?? 'green'}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Piece hunt · round {huntRound + 1} of {HUNT_ROUNDS}
            </div>
            {huntPhase === 'memorize' && (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  Memorize the position
                </p>
                <div className="mt-1 font-mono font-display text-5xl font-extrabold tabular-nums">{memTime}</div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(memTime / MEMORIZE_SECONDS) * 100}%` }} />
                </div>
              </>
            )}
            {huntPhase === 'question' && (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  Which piece stands on
                </p>
                <div className="mt-1 font-display text-5xl font-extrabold tracking-wide">{huntSquare}</div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {score} named · {mistakes} missed
                </div>
              </>
            )}
            {huntPhase === 'reveal' && (
              <p className="mt-2 text-sm font-semibold text-destructive" aria-live="polite">
                It was the {huntAnswerName} on {huntSquare}. Watch the board.
              </p>
            )}
          </div>

          {huntPhase === 'question' && (
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <div className="grid grid-cols-3 gap-2">
                {huntOptions.map((opt) => {
                  const isCorrect = opt.key === huntCorrectKey
                  const picked = huntPick === opt.key
                  return (
                    <button
                      key={opt.key}
                      onClick={() => resolvePick(opt)}
                      disabled={huntPick !== null}
                      className={cn(
                        'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-border p-2 transition active:scale-95',
                        huntPick !== null && isCorrect && 'border-primary bg-primary/10',
                        picked && !isCorrect && 'border-destructive bg-destructive/10',
                      )}
                    >
                      <img src={`/pieces/${opt.color}${opt.type.toUpperCase()}.svg`} alt="" className="h-7 w-7" draggable={false} />
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {opt.color === 'w' ? 'white' : 'black'} {PIECE_NAME[opt.type]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            A wrong answer shows the truth for a beat: study it, the next position is coming.
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
