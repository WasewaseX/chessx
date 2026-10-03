'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow, type Mark } from '@/components/chess/board'
import { findLesson, LEVELS } from '@/content/levels'
import type { ExerciseStep, LessonStep } from '@/content/schema'
import { useApp } from '@/lib/store'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { CoachDrawer } from '@/components/views/coach-drawer'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  RotateCcw,
  MessageSquareText,
  CheckCircle2,
  XCircle,
  Trophy,
} from 'lucide-react'

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const { navigate, profile } = useApp()
  const found = findLesson(lessonId)
  const [stepIdx, setStepIdx] = useState(0)
  const [canAdvance, setCanAdvance] = useState(false)
  const [done, setDone] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const savedRef = useRef({ stepsDone: 0, postedDone: false })

  const level = found?.level
  const lesson = found?.lesson

  // reset state when lesson changes
  useEffect(() => {
    setStepIdx(0)
    setCanAdvance(false)
    setDone(false)
    savedRef.current = { stepsDone: 0, postedDone: false }
  }, [lessonId])

  const saveProgress = useCallback(
    (stepsDone: number, finished: boolean, hintNow = false) => {
      if (!lesson || !level) return
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: lesson.id,
          stepsDone,
          totalSteps: lesson.steps.length,
          done: finished,
          level: level.n,
          hintNow,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.profile) useApp.getState().setProfile(d.profile)
        })
        .catch(() => {})
    },
    [lesson, level],
  )

  useEffect(() => {
    if (!lesson) return
    if (stepIdx > savedRef.current.stepsDone) {
      savedRef.current.stepsDone = stepIdx
      saveProgress(stepIdx, false)
    }
  }, [stepIdx, lesson, saveProgress])

  // finishing the last step unlocks completion
  const isLastStep = lesson ? stepIdx === lesson.steps.length - 1 : false
  useEffect(() => {
    if (isLastStep && canAdvance && !done) {
      setDone(true)
      if (lesson) saveProgress(lesson.steps.length, true)
    }
  }, [isLastStep, canAdvance, done, saveProgress, lesson])

  if (!lesson || !level) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Lesson not found.</p>
        <Button className="btn-hero mt-4" onClick={() => navigate('lessons')}>
          Back to lessons
        </Button>
      </div>
    )
  }

  const step = lesson.steps[stepIdx]
  const last = stepIdx === lesson.steps.length - 1

  function goNext() {
    if (last && !done) {
      setDone(true)
      saveProgress(lesson.steps.length, true)
      return
    }
    if (last && done) {
      navigate('lessons')
      return
    }
    setStepIdx((i) => i + 1)
    setCanAdvance(false)
  }

  function goPrev() {
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1)
      setCanAdvance(true)
    }
  }

  // (completion effect moved above the early return to keep hook order stable)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('lessons')} className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Lessons
        </button>
        <div className="hidden h-4 w-px bg-border sm:block" />
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Level {level.n} · {level.title}
          </div>
          <h1 className="truncate font-display text-lg font-bold">{lesson.title}</h1>
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setCoachOpen(true)}>
          <MessageSquareText className="h-4 w-4" /> Ask the coach
        </Button>
      </div>

      {/* progress dots */}
      <div className="mb-4 flex items-center gap-1.5">
        {lesson.steps.map((_, i) => (
          <button
            key={i}
            aria-label={`Step ${i + 1}`}
            onClick={() => {
              if (i <= Math.max(stepIdx, savedRef.current.stepsDone)) {
                setStepIdx(i)
                setCanAdvance(i < savedRef.current.stepsDone)
              }
            }}
            className={cn(
              'h-2 rounded-full transition-all',
              i === stepIdx ? 'w-6 bg-primary' : i < stepIdx ? 'w-2 bg-primary/60' : 'w-2 bg-border',
            )}
          />
        ))}
        <span className="ml-2 text-xs font-semibold text-muted-foreground">
          {stepIdx + 1} / {lesson.steps.length}
        </span>
      </div>

      {step.type === 'playout' ? (
        <PlayoutStepView
          key={stepIdx}
          step={step}
          level={level.n}
          onPass={() => setCanAdvance(true)}
          soundEnabled={profile?.soundEnabled ?? true}
          showLegal={profile?.showLegal ?? true}
          theme={profile?.theme ?? 'green'}
        />
      ) : step.type === 'exercise' ? (
        <ExerciseView
          key={stepIdx}
          step={step}
          lessonTitle={lesson.title}
          onPass={() => setCanAdvance(true)}
          soundEnabled={profile?.soundEnabled ?? true}
          showLegal={profile?.showLegal ?? true}
          theme={profile?.theme ?? 'green'}
          onAskCoach={() => setCoachOpen(true)}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
          <div className={cn(step.type === 'demo' ? 'order-2 lg:order-1' : 'hidden')}>
            {step.type === 'demo' && (
              <DemoBoard
                key={stepIdx}
                fen={step.fen}
                moves={step.moves}
                marks={step.marks}
                arrows={step.arrows}
                caption={step.caption}
                soundEnabled={profile?.soundEnabled ?? true}
              />
            )}
          </div>
          <div className={cn('order-1 lg:order-2', step.type !== 'demo' && 'lg:col-span-2')}>
            {step.type === 'text' && <TextStepView step={step} onReady={() => setCanAdvance(true)} />}
            {step.type === 'demo' && <DemoTextView step={step} onReady={() => setCanAdvance(true)} />}
            {step.type === 'quiz' && <QuizStepView key={stepIdx} step={step} onPass={() => setCanAdvance(true)} />}
          </div>
        </div>
      )}

      {/* footer nav */}
      <div className="mt-6 flex items-center justify-between">
        <Button variant="secondary" onClick={goPrev} disabled={stepIdx === 0}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {canAdvance ? (
          <Button className="btn-hero px-8" onClick={goNext}>
            {last && done ? 'Finish' : last ? 'Complete lesson' : 'Continue'} <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            {step.type === 'exercise' || step.type === 'playout' ? 'Solve it to continue' : step.type === 'quiz' ? 'Answer to continue' : '…'}
          </Button>
        )}
      </div>

      <CoachDrawer
        open={coachOpen}
        onOpenChange={setCoachOpen}
        context={{
          lessonTitle: lesson.title,
          fen: step.type === 'demo' || step.type === 'exercise' || step.type === 'playout' ? step.fen : undefined,
          stepHint: step.type === 'exercise' ? `${step.goal}. Do not reveal the solution move directly.` : undefined,
          skillLevel: profile?.skillLevel ?? 'beginner',
        }}
      />
    </div>
  )
}

/* ---------------- step views ---------------- */

function TextStepView({ step, onReady }: { step: Extract<LessonStep, { type: 'text' }>; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <h2 className="font-display text-xl font-bold">{step.title}</h2>
      <div className="mt-3 space-y-3">
        {step.body.map((p, i) => (
          <p key={i} className="leading-relaxed text-foreground/90">
            {p}
          </p>
        ))}
      </div>
      {step.keyIdea && (
        <div className="mt-4 rounded-md border-l-4 border-primary bg-primary/10 px-4 py-3 text-sm font-semibold">
          {step.keyIdea}
        </div>
      )}
    </div>
  )
}

function DemoTextView({ step, onReady }: { step: Extract<LessonStep, { type: 'demo' }>; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <h2 className="font-display text-xl font-bold">{step.title}</h2>
      <div className="mt-3 space-y-3">
        {step.body.map((p, i) => (
          <p key={i} className="leading-relaxed text-foreground/90">
            {p}
          </p>
        ))}
      </div>
    </div>
  )
}

function DemoBoard({
  fen,
  moves,
  marks,
  arrows,
  caption,
  soundEnabled,
}: {
  fen: string
  moves?: string[]
  marks?: Mark[]
  arrows?: Arrow[]
  caption?: string
  soundEnabled: boolean
}) {
  const [shownFen, setShownFen] = useState(fen)
  const [ply, setPly] = useState(0)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const gameRef = useRef(new Chess(fen))

  useEffect(() => {
    gameRef.current = new Chess(fen)
    setShownFen(fen)
    setPly(0)
    setLastMove(null)
  }, [fen])

  const stepForward = useCallback(() => {
    if (!moves || ply >= moves.length) return
    const g = gameRef.current
    const mv = g.move(moves[ply])
    if (mv) {
      setShownFen(g.fen())
      setPly((p) => p + 1)
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
    }
  }, [moves, ply, soundEnabled])

  // auto-play the line when the step appears
  useEffect(() => {
    if (!moves?.length) return
    let p = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const tick = () => {
      stepForwardRef.current()
      p++
      if (p < moves.length) timers.push(setTimeout(tick, 800))
    }
    timers.push(setTimeout(tick, 700))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen])

  const stepForwardRef = useRef(stepForward)
  stepForwardRef.current = stepForward

  const checkSquare = useMemo(() => {
    const g = new Chess(shownFen)
    if (!g.isCheck()) return null
    const turn = g.turn()
    return g.board().flat().find((s) => s && s.type === 'k' && s.color === turn)?.square ?? null
  }, [shownFen])

  return (
    <div>
      <ChessBoard fen={shownFen} lastMove={lastMove} marks={marks} arrows={arrows} checkSquare={checkSquare} interactive={false} />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{caption ?? ''}</div>
        {moves && moves.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              gameRef.current = new Chess(fen)
              setShownFen(fen)
              setPly(0)
              setLastMove(null)
              setTimeout(() => {
                let p = 0
                const tick = () => {
                  stepForwardRef.current()
                  p++
                  if (p < (moves?.length ?? 0)) setTimeout(tick, 800)
                }
                setTimeout(tick, 400)
              }, 50)
            }}
          >
            <RotateCcw className="h-4 w-4" /> Replay
          </Button>
        )}
      </div>
    </div>
  )
}

function QuizStepView({ step, onPass }: { step: Extract<LessonStep, { type: 'quiz' }>; onPass: () => void }) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [answeredCorrect, setAnsweredCorrect] = useState(false)
  const correctIdx = step.options.findIndex((o) => o.correct)

  function choose(i: number) {
    if (answeredCorrect) return
    setChosen(i)
    if (step.options[i].correct) {
      setAnsweredCorrect(true)
      onPass()
    }
  }

  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <h2 className="font-display text-xl font-bold">{step.title}</h2>
      {step.body && <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>}
      <p className="mt-3 font-semibold">{step.question}</p>
      <div className="mt-4 grid gap-2">
        {step.options.map((o, i) => {
          const isChosen = chosen === i
          const state = !isChosen ? 'idle' : o.correct ? 'correct' : 'wrong'
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={answeredCorrect}
              className={cn(
                'flex items-start gap-3 rounded-md border px-4 py-3 text-left text-sm font-medium transition',
                state === 'idle' && 'border-border hover:border-primary/50 hover:bg-accent/50',
                state === 'correct' && 'border-primary bg-primary/10',
                state === 'wrong' && 'border-destructive bg-destructive/10',
                answeredCorrect && !isChosen && 'opacity-50',
              )}
            >
              {state === 'correct' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : state === 'wrong' ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />
              )}
              <span>
                {o.text}
                {isChosen && <span className="mt-1 block text-xs font-normal text-muted-foreground">{o.why}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {answeredCorrect && (
        <p className="mt-3 text-sm font-semibold text-primary">Correct. {step.options[correctIdx]?.why}</p>
      )}
    </div>
  )
}

function ExerciseView({
  step,
  lessonTitle,
  onPass,
  soundEnabled,
  showLegal,
  theme,
  onAskCoach,
}: {
  step: ExerciseStep
  lessonTitle: string
  onPass: () => void
  soundEnabled: boolean
  showLegal: boolean
  theme: string
  onAskCoach: () => void
}) {
  const gameRef = useRef(new Chess(step.fen))
  const [fen, setFen] = useState(step.fen)
  const [movesSoFar, setMovesSoFar] = useState<string[]>([])
  const [status, setStatus] = useState<'solving' | 'wrong' | 'done'>('solving')
  const [hintShown, setHintShown] = useState(false)
  const [shake, setShake] = useState(false)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)

  const expectedUserIdx = movesSoFar.length // next user move is solution[movesSoFar.length] (even index)
  const game = useMemo(() => new Chess(fen), [fen])
  const sideToMove = game.turn()
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  function reset() {
    gameRef.current = new Chess(step.fen)
    setFen(step.fen)
    setMovesSoFar([])
    setStatus('solving')
    setLastMove(null)
  }

  function onMove(from: Square, to: Square, promotion?: string) {
    if (status === 'done') return
    const g = gameRef.current
    const expected = step.solution[movesSoFar.length]
    let mv
    try {
      mv = g.move({ from, to, promotion: promotion ?? undefined })
    } catch {
      return
    }
    if (!mv) return

    // is it the expected move?
    let correct = false
    if (expected) {
      const expectedNorm = expected.replace(/[+#]/g, '')
      const mvNorm = mv.san.replace(/[+#]/g, '')
      correct = mvNorm === expectedNorm
    }

    if (!correct) {
      g.undo()
      setStatus('wrong')
      setShake(true)
      playSound('wrong', soundEnabled)
      setTimeout(() => setShake(false), 450)
      return
    }

    setMovesSoFar((m) => [...m, mv.san])
    setLastMove({ from: mv.from, to: mv.to })
    setFen(g.fen())
    playSound(mv.captured ? 'capture' : 'move', soundEnabled)

    // opponent scripted reply
    const reply = step.solution[movesSoFar.length + 1]
    if (reply) {
      setTimeout(() => {
        try {
          const rmv = g.move(reply)
          if (rmv) {
            setMovesSoFar((m) => [...m, rmv.san])
            setLastMove({ from: rmv.from, to: rmv.to })
            setFen(g.fen())
            playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
          }
        } catch {
          /* scripted reply must be legal; validator guarantees */
        }
      }, 550)
    } else {
      // line finished
      setStatus('done')
      playSound('correct', soundEnabled)
      onPass()
    }
    // if reply exists but it was the last move of the line
    if (reply && movesSoFar.length + 2 >= step.solution.length) {
      setTimeout(() => {
        setStatus('done')
        playSound('correct', soundEnabled)
        onPass()
      }, 1100)
    }
  }

  const userSideFromFen = useMemo(() => new Chess(step.fen).turn(), [step.fen])

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div>
        <ChessBoard
          fen={fen}
          orientation={userSideFromFen}
          onMove={onMove}
          movableSide={status === 'done' ? undefined : userSideFromFen}
          interactive={status !== 'done'}
          lastMove={lastMove}
          checkSquare={checkSquare}
          showLegal={showLegal && status !== 'done'}
          theme={theme}
          shake={shake}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-card p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exercise</div>
          <h2 className="mt-1 font-display text-xl font-bold">{step.title}</h2>
          {step.body?.map((p, i) => (
            <p key={i} className="mt-2 text-sm text-foreground/90">
              {p}
            </p>
          ))}
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-semibold">{step.goal}</div>

          {status === 'solving' && (
            <div className="mt-3 text-sm text-muted-foreground">
              {movesSoFar.length > 0 ? (
                <>Line so far: <span className="font-mono font-semibold text-foreground">{movesSoFar.join(' ')}</span></>
              ) : (
                'Your move.'
              )}
            </div>
          )}
          {status === 'wrong' && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              Not that. Look again — what does the position really want?
            </div>
          )}
          {status === 'done' && (
            <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-foreground">
              <Trophy className="mr-1 inline h-4 w-4 text-primary" />
              {step.success}
            </div>
          )}
          {step.explanation && status === 'done' && (
            <p className="mt-2 text-sm text-muted-foreground">{step.explanation}</p>
          )}

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={reset} disabled={status === 'done'}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setHintShown(true)}
              disabled={hintShown || status === 'done'}
            >
              <Lightbulb className="h-4 w-4" /> Hint
            </Button>
            <Button variant="secondary" size="sm" onClick={onAskCoach}>
              <MessageSquareText className="h-4 w-4" /> Coach
            </Button>
          </div>
          {hintShown && status !== 'done' && (
            <div className="mt-3 rounded-md border-l-4 border-[#e6a82c] bg-[#e6a82c]/10 px-3 py-2 text-sm">
              {step.hint}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlayoutStepView({
  step,
  level,
  onPass,
  soundEnabled,
  showLegal,
  theme,
}: {
  step: Extract<LessonStep, { type: 'playout' }>
  level: number
  onPass: () => void
  soundEnabled: boolean
  showLegal: boolean
  theme: string
}) {
  const gameRef = useRef(new Chess(step.fen))
  const [fen, setFen] = useState(step.fen)
  const [moves, setMoves] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [status, setStatus] = useState<'playing' | 'won' | 'lost' | 'draw'>('playing')
  const [thinking, setThinking] = useState(false)
  const judgedRef = useRef(false)

  const game = useMemo(() => new Chess(fen), [fen])
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  const materialBalance = (g: Chess) => {
    const vals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
    let bal = 0
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue
        bal += sq.color === step.side ? vals[sq.type] : -vals[sq.type]
      }
    }
    return bal
  }

  const castled = (g: Chess) => {
    // castle rights gone + king on g1/c1 (or g8/c8) counts as castled
    const kingSquare = g.board().flat().find((s) => s && s.type === 'k' && s.color === step.side)?.square
    if (!kingSquare) return false
    const homeRow = step.side === 'w' ? '1' : '8'
    const lostRights = step.side === 'w' ? !g.get('e1' as Square) || true : true
    void lostRights
    return (kingSquare === `g${homeRow}` || kingSquare === `c${homeRow}`) && moves.some((m) => m.startsWith('O-O'))
  }

  const judge = useCallback(
    (g: Chess): 'won' | 'lost' | 'draw' | null => {
      if (g.isCheckmate()) {
        const matedSide = g.turn()
        return matedSide === step.side ? 'lost' : 'won'
      }
      if (g.isStalemate() || g.isInsufficientMaterial() || g.isThreefoldRepetition() || g.isDraw()) {
        return step.success === 'draw' ? 'won' : 'draw'
      }
      const plyLimit = (step.maxMoves ?? 12) * 2
      if (moves.length >= plyLimit) {
        if (step.success === 'castle') return castled(g) ? 'won' : 'lost'
        if (step.success === 'material') return materialBalance(g) >= 3 ? 'won' : 'lost'
        return 'draw'
      }
      // early material check
      if (step.success !== 'draw') {
        const bal = materialBalance(g)
        if (bal <= -3) return 'lost'
      }
      if (step.success === 'castle' && castled(g)) return 'won'
      if (step.success === 'material' && materialBalance(g) >= 3 && moves.length >= 2) return 'won'
      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fen, moves],
  )

  useEffect(() => {
    if (status !== 'playing' || judgedRef.current) return
    const result = judge(gameRef.current)
    if (result) {
      judgedRef.current = true
      setStatus(result)
      if (result === 'won') {
        playSound('correct', soundEnabled)
        onPass()
      } else {
        playSound('wrong', soundEnabled)
      }
    }
  }, [fen, status, judge, onPass, soundEnabled])

  const engineMove = useCallback(async () => {
    const g = gameRef.current
    if (g.isGameOver()) return
    setThinking(true)
    try {
      const { uci } = await engine.bestMove({ fen: g.fen(), skill: Math.max(0, step.engineLevel * 4 - 2), depth: Math.max(2, step.engineLevel + 1), minTime: 350 })
      if (uci && uci.length >= 4) {
        const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
        if (mv) {
          setFen(g.fen())
          setMoves((m) => [...m, mv.san])
          setLastMove({ from: mv.from, to: mv.to })
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
        }
      }
    } finally {
      setThinking(false)
    }
  }, [step.engineLevel, soundEnabled])

  function onMove(from: Square, to: Square, promotion?: string) {
    if (status !== 'playing') return
    const g = gameRef.current
    try {
      const mv = g.move({ from, to, promotion: promotion ?? undefined })
      if (!mv) return
      setFen(g.fen())
      setMoves((m) => [...m, mv.san])
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
      if (!g.isGameOver()) void engineMove()
    } catch {
      /* illegal */
    }
  }

  function reset() {
    gameRef.current = new Chess(step.fen)
    setFen(step.fen)
    setMoves([])
    setLastMove(null)
    setStatus('playing')
    judgedRef.current = false
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div>
        <ChessBoard
          fen={fen}
          orientation={step.side}
          onMove={onMove}
          movableSide={status === 'playing' ? step.side : undefined}
          interactive={status === 'playing'}
          lastMove={lastMove}
          checkSquare={checkSquare}
          showLegal={showLegal && status === 'playing'}
          theme={theme}
        />
      </div>
      <div className="rounded-lg bg-card p-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Play it out · Level {level}</div>
        <h2 className="mt-1 font-display text-xl font-bold">{step.title}</h2>
        {step.body?.map((p, i) => (
          <p key={i} className="mt-2 text-sm text-foreground/90">
            {p}
          </p>
        ))}
        <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-semibold">{step.goal}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          {thinking ? 'Opponent thinking…' : moves.length > 0 ? `Moves played: ${moves.length}` : 'Your move.'}
        </div>

        {status === 'won' && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold">
            <Trophy className="mr-1 inline h-4 w-4 text-primary" />
            {step.successText}
          </div>
        )}
        {(status === 'lost' || status === 'draw') && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            {step.failText ?? (status === 'draw' ? 'Draw — not the goal here.' : 'That did not work. Reset and try a different plan.')}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={reset} disabled={status === 'playing' && moves.length === 0}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </div>
    </div>
  )
}

// levels re-exported for reference by the coach drawer context
void LEVELS
