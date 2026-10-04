'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow, type FlashMark, type Mark } from '@/components/chess/board'
import { findLevel, TIERS } from '@/content/levels'
import type { ExerciseStep, GtmStep, LessonStep } from '@/content/schema'
import { useApp } from '@/lib/store'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { CoachDrawer } from '@/components/views/coach-drawer'
import { SpeakButton } from '@/components/chess/speak-button'
import { CharacterFace } from '@/components/chess/characters'
import { coachMaybe, type Coach } from '@/lib/coaches'
import { CoachCards, usePickCoach } from '@/components/shell/coach-choice'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  RotateCcw,
  MessageSquareText,
  CheckCircle2,
  Play,
  Undo2,
  Sparkles,
  CircleAlert,
} from 'lucide-react'
/* Coach character bubble: face + speech bubble, with an option to hear it.
   No coach chosen yet? The bubble becomes the chooser: nothing speaks until
   the player picks who mentors them. */
function CoachBubble({
  tone,
  chip,
  coach,
  speakText,
  children,
}: {
  tone: 'praise' | 'guide' | 'hint' | 'neutral'
  chip?: string
  coach?: Coach
  speakText?: string
  children: React.ReactNode
}) {
  const { pick, busyId } = usePickCoach()
  if (!coach) {
    return (
      <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3">
        <p className="text-sm font-semibold">Pick your coach. Every hint and success message is theirs.</p>
        <div className="mt-2.5">
          <CoachCards value={busyId} onChange={(id) => void pick(id)} columns={2} compact />
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5">
      <CharacterFace id={coach.id} label={coach.name} className="h-11 w-11 shrink-0 rounded-full border-2 border-primary/60 shadow-sm" />
      <div
        className={cn(
          'relative flex-1 rounded-xl px-3.5 py-2.5 text-sm font-semibold shadow-sm',
          tone === 'praise' && 'border border-primary/40 bg-primary/10 text-foreground',
          tone === 'guide' && 'border border-[#e6a82c]/50 bg-[#e6a82c]/10 text-foreground',
          tone === 'hint' && 'border border-[#e6a82c]/40 bg-[#e6a82c]/5 text-foreground',
          tone === 'neutral' && 'bg-secondary text-foreground',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute left-[-6px] top-4 h-3 w-3 rotate-45 border-l border-b',
            tone === 'praise' && 'border-primary/40 bg-primary/10',
            tone === 'guide' && 'border-[#e6a82c]/50 bg-[#e6a82c]/10',
            tone === 'hint' && 'border-[#e6a82c]/40 bg-[#e6a82c]/5',
            tone === 'neutral' && 'border-secondary bg-secondary',
          )}
        />
        <div className="flex items-start justify-between gap-2">
          <span>{children}</span>
          <div className="flex shrink-0 items-center gap-1">
            {chip && (
              <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-extrabold text-primary-foreground shadow-sm">
                {chip}
              </span>
            )}
            {speakText && <SpeakButton text={speakText} voice={coach.voice} speed={coach.speed} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const { navigate, profile } = useApp()
  const coach = coachMaybe(profile?.coach)
  const found = findLevel(lessonId)
  const [stepIdx, setStepIdx] = useState(0)
  const [canAdvance, setCanAdvance] = useState(false)
  const [done, setDone] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const savedRef = useRef({ stepsDone: 0, postedDone: false })

  const tier = found?.tier
  const lesson = found?.level
  const globalLevel = found?.globalN ?? 0

  const [xpFlash, setXpFlash] = useState<number | null>(null)
  const xpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveProgress = useCallback(
    (stepsDone: number, finished: boolean, hintNow = false) => {
      if (!lesson || !tier) return
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: lesson.id,
          stepsDone,
          totalSteps: lesson.steps.length,
          done: finished,
          level: globalLevel,
          hintNow,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.profile) useApp.getState().setProfile(d.profile)
          if (typeof d.xpGain === 'number' && d.xpGain > 0) {
            setXpFlash(d.xpGain)
            if (xpTimerRef.current) clearTimeout(xpTimerRef.current)
            xpTimerRef.current = setTimeout(() => setXpFlash(null), 2500)
          }
        })
        .catch(() => {})
    },
    [lesson, tier, globalLevel],
  )

  useEffect(() => {
    if (!lesson) return
    if (stepIdx > savedRef.current.stepsDone) {
      savedRef.current.stepsDone = stepIdx
      saveProgress(stepIdx, false)
    }
  }, [stepIdx, lesson, saveProgress])

  // finishing the last step unlocks completion (state adjusts in render, save posts here)
  const postedDoneRef = useRef(false)
  useEffect(() => {
    if (done && lesson && !postedDoneRef.current) {
      postedDoneRef.current = true
      saveProgress(lesson.steps.length, true)
    }
  }, [done, lesson, saveProgress])

  const isLastStep = lesson ? stepIdx === lesson.steps.length - 1 : false
  if (lesson && isLastStep && canAdvance && !done) {
    setDone(true)
  }

  if (!lesson || !tier) {
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
            Tier {tier.n} · {tier.title}
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
        {xpFlash != null && (
          <span className="ml-auto inline-flex animate-pulse items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-extrabold text-primary-foreground shadow">
            <Sparkles className="h-3.5 w-3.5" /> +{xpFlash} XP
          </span>
        )}
      </div>

      {step.type === 'playout' ? (
        <PlayoutStepView
          key={stepIdx}
          step={step}
          level={globalLevel}
          coach={coach}
          onPass={() => setCanAdvance(true)}
          soundEnabled={profile?.soundEnabled ?? true}
          showLegal={profile?.showLegal ?? true}
          theme={profile?.theme ?? 'green'}
        />
      ) : step.type === 'gtm' ? (
        <GtmStepView
          key={stepIdx}
          step={step}
          coach={coach}
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
          coach={coach}
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
            {step.type === 'text' && <TextStepView step={step} coach={coach} onReady={() => setCanAdvance(true)} />}
            {step.type === 'demo' && <DemoTextView step={step} coach={coach} onReady={() => setCanAdvance(true)} />}
            {step.type === 'quiz' && <QuizStepView key={stepIdx} step={step} onPass={() => setCanAdvance(true)} />}
          </div>
        </div>
      )}

      {/* sticky bottom action bar */}
      <div className="sticky bottom-4 z-30 mt-6 pb-1">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 p-2 shadow-lg backdrop-blur">
          <Button variant="secondary" onClick={goPrev} disabled={stepIdx === 0} className="shrink-0">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {canAdvance ? (
            <Button className="btn-hero h-12 flex-1 text-base font-extrabold tracking-wide" onClick={goNext}>
              {last && done ? 'Finish' : last ? 'Complete lesson' : 'Continue'} <ChevronRight className="h-5 w-5" />
            </Button>
          ) : (
            <Button variant="secondary" disabled className="h-12 flex-1 text-sm font-bold">
              {step.type === 'exercise' || step.type === 'playout'
                ? 'Solve it to continue'
                : step.type === 'gtm'
                  ? 'Guess the move to continue'
                  : step.type === 'quiz'
                    ? 'Answer to continue'
                    : '…'}
            </Button>
          )}
        </div>
      </div>

      <CoachDrawer
        open={coachOpen}
        onOpenChange={setCoachOpen}
        context={{
          lessonTitle: lesson.title,
          fen: step.type === 'demo' || step.type === 'exercise' || step.type === 'playout' || step.type === 'gtm' ? step.fen : undefined,
          stepHint: step.type === 'exercise' ? `${step.goal}. Do not reveal the solution move directly.` : undefined,
          skillLevel: profile?.skillLevel ?? 'beginner',
        }}
      />
    </div>
  )
}

/* ---------------- step views ---------------- */

function TextStepView({ step, coach, onReady }: { step: Extract<LessonStep, { type: 'text' }>; coach?: Coach; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  const spoken = [...step.body, step.keyIdea].filter(Boolean).join(' ')
  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-xl font-bold">{step.title}</h2>
        {coach && <SpeakButton text={spoken} voice={coach.voice} speed={coach.speed} />}
      </div>
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

function DemoTextView({ step, coach, onReady }: { step: Extract<LessonStep, { type: 'demo' }>; coach?: Coach; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-xl font-bold">{step.title}</h2>
        {coach && <SpeakButton text={step.body.join(' ')} voice={coach.voice} speed={coach.speed} />}
      </div>
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
  // Free-exploration board: the position starts as authored, the scripted line
  // (if any) plays once automatically, then the reader can move pieces
  // themselves, legal moves only, with undo/reset and line replay.
  const gameRef = useRef(new Chess(fen))
  const [shownFen, setShownFen] = useState(fen)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [depth, setDepth] = useState(0) // plies played away from the authored position
  const [autoplay, setAutoplay] = useState(Boolean(moves?.length))
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    flashTimersRef.current.forEach(clearTimeout)
    flashTimersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const checkSquare = useMemo(() => {
    try {
      const g = new Chess(shownFen)
      if (!g.isCheck()) return null
      return g.board().flat().find((s) => s && s.type === 'k' && s.color === g.turn())?.square ?? null
    } catch {
      return null
    }
  }, [shownFen])

  const playLine = useCallback(
    (delayFirst = 400) => {
      if (!moves?.length) return
      clearTimers()
      gameRef.current = new Chess(fen)
      setShownFen(fen)
      setLastMove(null)
      setDepth(0)
      setAutoplay(true)
      let p = 0
      const tick = () => {
        const mv = gameRef.current.move(moves[p])
        if (mv) {
          setShownFen(gameRef.current.fen())
          setLastMove({ from: mv.from, to: mv.to })
          setDepth((d) => d + 1)
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
          // flash where the piece went, then let it fade
          setFlashes([
            { square: mv.from, color: 'gold' },
            { square: mv.to, color: 'green' },
          ])
          flashTimersRef.current.push(setTimeout(() => setFlashes([]), 700))
        }
        p++
        if (p < moves.length) timersRef.current.push(setTimeout(tick, 850))
        else setAutoplay(false)
      }
      timersRef.current.push(setTimeout(tick, delayFirst))
    },
    [moves, fen, soundEnabled, clearTimers],
  )

  // auto-play the line once when the step appears
  useEffect(() => {
    if (moves?.length) playLine(650)
  }, [fen])

  function onMove(from: Square, to: Square, promotion?: string) {
    if (autoplay) return
    // free exploration: allow moving either side, if it is not that piece's
    // turn, validate against a turn-swapped FEN (en-passant reset)
    let g = gameRef.current
    const piece = g.get(from)
    if (!piece) return
    if (g.turn() !== piece.color) {
      const parts = g.fen().split(' ')
      parts[1] = piece.color
      if (parts.length >= 4) parts[3] = '-'
      try {
        g = new Chess(parts.join(' '))
      } catch {
        return
      }
    }
    try {
      const mv = g.move({ from, to, promotion: promotion ?? undefined })
      if (!mv) return
      gameRef.current = g
      setShownFen(g.fen())
      setLastMove({ from: mv.from, to: mv.to })
      setDepth((d) => d + 1)
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
    } catch {
      /* illegal, ignore */
    }
  }

  function undo() {
    if (autoplay) return
    const mv = gameRef.current.undo()
    if (!mv) return
    setShownFen(gameRef.current.fen())
    setDepth((d) => Math.max(0, d - 1))
    const hist = gameRef.current.history({ verbose: true })
    const last = hist[hist.length - 1]
    setLastMove(last ? { from: last.from, to: last.to } : null)
  }

  function reset() {
    clearTimers()
    gameRef.current = new Chess(fen)
    setShownFen(fen)
    setLastMove(null)
    setDepth(0)
    setAutoplay(false)
  }

  return (
    <div>
      <div className="relative">
        <ChessBoard
          fen={shownFen}
          lastMove={lastMove}
          marks={marks}
          arrows={arrows}
          flashes={flashes}
          checkSquare={checkSquare}
          onMove={onMove}
          interactive={!autoplay}
          movableSide="any"
        />
        {autoplay && (
          <div className="absolute inset-0 z-40 flex items-end justify-center bg-transparent">
            <div className="mb-3 rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
              Playing the line…
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{caption ?? ''}</div>
        <div className="flex flex-wrap gap-1.5">
          {moves && moves.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => playLine(150)} disabled={autoplay}>
              <Play className="h-4 w-4" /> Watch the line
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={undo} disabled={autoplay || depth === 0}>
            <Undo2 className="h-4 w-4" /> Undo
          </Button>
          <Button variant="secondary" size="sm" onClick={reset} disabled={autoplay || depth === 0}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </div>
      {!autoplay && depth === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          This board is yours to explore. Pick up any piece and try moves.
        </p>
      )}
    </div>
  )
}

function QuizStepView({ step, onPass }: { step: Extract<LessonStep, { type: 'quiz' }>; onPass: () => void }) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [misses, setMisses] = useState(0)
  const [answeredCorrect, setAnsweredCorrect] = useState(false)
  const correctIdx = step.options.findIndex((o) => o.correct)

  function choose(i: number) {
    if (answeredCorrect) return
    if (step.options[i].correct) {
      setChosen(i)
      setAnsweredCorrect(true)
      onPass()
    } else {
      setChosen(i)
      setMisses((m) => m + 1)
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
          const state = !isChosen ? 'idle' : o.correct ? 'correct' : 'off'
          const revealed = misses >= 2 && o.correct && !answeredCorrect
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={answeredCorrect}
              className={cn(
                'flex items-start gap-3 rounded-md border px-4 py-3 text-left text-sm font-medium transition',
                state === 'idle' && 'border-border hover:border-primary/50 hover:bg-accent/50',
                state === 'correct' && 'border-primary bg-primary/10',
                state === 'off' && 'border-[#e6a82c]/60 bg-[#e6a82c]/10',
                revealed && 'animate-pulse border-primary bg-primary/5',
                answeredCorrect && !isChosen && 'opacity-50',
              )}
            >
              {state === 'correct' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : state === 'off' ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b07f16]" />
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
      {answeredCorrect ? (
        <p className="mt-3 text-sm font-semibold text-primary">Correct. {step.options[correctIdx]?.why}</p>
      ) : chosen != null && !step.options[chosen].correct ? (
        <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-semibold text-foreground">
          Tempting, but not the idea here. {step.options[chosen].why} Take another look.
        </div>
      ) : null}
      {misses >= 2 && !answeredCorrect && (
        <p className="mt-2 text-sm text-muted-foreground">The right answer is glowing now. Tap it, and keep the why in mind for the board.</p>
      )}
    </div>
  )
}

function ExerciseView({
  step,
  lessonTitle,
  coach,
  onPass,
  soundEnabled,
  showLegal,
  theme,
  onAskCoach,
}: {
  step: ExerciseStep
  lessonTitle: string
  coach?: Coach
  onPass: () => void
  soundEnabled: boolean
  showLegal: boolean
  theme: string
  onAskCoach: () => void
}) {
  const gameRef = useRef(new Chess(step.fen))
  const [fen, setFen] = useState(step.fen)
  const [movesSoFar, setMovesSoFar] = useState<string[]>([])
  const [status, setStatus] = useState<'solving' | 'watch' | 'done'>('solving')
  const [attempts, setAttempts] = useState(0)
  const [guideMsg, setGuideMsg] = useState<string | null>(null)
  const [hintShown, setHintShown] = useState(false)
  const [shake, setShake] = useState(false)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const watchingRef = useRef(false)

  // flash squares on the board (hints guide toward the idea, never punish)
  const flash = useCallback((marks: FlashMark[]) => {
    setFlashes(marks)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashes([]), 2900)
  }, [])
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      watchTimers.current.forEach(clearTimeout)
      watchTimers.current = []
    },
    [],
  )

  // squares of the next expected move, used by the hint flash
  const showHint = useCallback(() => {
    setHintShown(true)
    const san = step.solution[movesSoFar.length]
    if (!san) return
    try {
      const probe = new Chess(gameRef.current.fen())
      const mv = probe.move(san)
      if (mv) flash([{ square: mv.from, color: 'gold' }, { square: mv.to, color: 'green' }])
    } catch {
      /* validator guarantees the line; ignore parse races */
    }
  }, [step.solution, movesSoFar.length, flash])

  // After a few misses, show the idea on the board once, then hand the
  // position back so the student still plays it themselves. Guidance, not
  // punishment: nobody is marked wrong, they get shown and then they do it.
  const watchSolution = useCallback(() => {
    if (watchingRef.current) return
    watchingRef.current = true
    setStatus('watch')
    gameRef.current = new Chess(step.fen)
    setFen(step.fen)
    setMovesSoFar([])
    setLastMove(null)
    setFlashes([])
    let i = 0
    const tick = () => {
      if (i >= step.solution.length) {
        gameRef.current = new Chess(step.fen)
        setFen(step.fen)
        setMovesSoFar([])
        setLastMove(null)
        setStatus('solving')
        setHintShown(true)
        setGuideMsg('Now you. Same position, same idea: play it move by move.')
        try {
          const probe = new Chess(step.fen)
          const mv = probe.move(step.solution[0])
          if (mv) flash([{ square: mv.from, color: 'gold' }, { square: mv.to, color: 'green' }])
        } catch {
          /* validated content */
        }
        watchingRef.current = false
        return
      }
      try {
        const mv = gameRef.current.move(step.solution[i])
        if (mv) {
          setFen(gameRef.current.fen())
          setMovesSoFar((m) => [...m, mv.san])
          setLastMove({ from: mv.from, to: mv.to })
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
          setFlashes([{ square: mv.from, color: 'gold' }, { square: mv.to, color: 'green' }])
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlashes([]), 700)
        }
      } catch {
        /* validated content */
      }
      i++
      watchTimers.current.push(setTimeout(tick, 850))
    }
    watchTimers.current.push(setTimeout(tick, 350))
  }, [step, soundEnabled, flash])

  const expectedUserIdx = movesSoFar.length // next user move is solution[movesSoFar.length] (even index)
  const game = useMemo(() => new Chess(fen), [fen])
  const sideToMove = game.turn()
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  function reset() {
    watchTimers.current.forEach(clearTimeout)
    watchTimers.current = []
    watchingRef.current = false
    gameRef.current = new Chess(step.fen)
    setFen(step.fen)
    setMovesSoFar([])
    setStatus('solving')
    setLastMove(null)
    setAttempts(0)
    setGuideMsg(null)
  }

  function onMove(from: Square, to: Square, promotion?: string) {
    if (status !== 'solving') return
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
      const n = attempts + 1
      setAttempts(n)
      setShake(true)
      setTimeout(() => setShake(false), 420)
      playSound('wrong', soundEnabled)
      if (n === 1) {
        setGuideMsg('Not that idea. Take it back and look again: check every check, capture and threat first.')
      } else if (n === 2) {
        setGuideMsg('The piece that moves is glowing. Where does it do the most damage?')
        try {
          const probe = new Chess(gameRef.current.fen())
          const mv = probe.move(step.solution[movesSoFar.length])
          if (mv) flash([{ square: mv.from, color: 'gold' }])
        } catch {
          /* validated content */
        }
      } else if (!watchingRef.current) {
        setGuideMsg('Watch the idea once, then play it yourself.')
        watchSolution()
      }
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
          movableSide={status === 'solving' ? userSideFromFen : undefined}
          interactive={status === 'solving'}
          lastMove={lastMove}
          checkSquare={checkSquare}
          showLegal={showLegal && status === 'solving'}
          animateTargets={status === 'solving'}
          flashes={flashes}
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
          {guideMsg && status !== 'done' && (
            <div className="mt-3">
              <CoachBubble tone="guide" coach={coach} speakText={guideMsg}>
                {guideMsg}
              </CoachBubble>
            </div>
          )}
          {status === 'done' && (
            <div className="mt-3">
              <CoachBubble tone="praise" coach={coach} speakText={step.success}>{step.success}</CoachBubble>
            </div>
          )}
          {step.explanation && status === 'done' && (
            <p className="mt-2 text-sm text-muted-foreground">{step.explanation}</p>
          )}

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={reset} disabled={status !== 'solving'}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={showHint}
              disabled={hintShown || status !== 'solving'}
            >
              <Lightbulb className="h-4 w-4" /> Hint
            </Button>
            <Button variant="secondary" size="sm" onClick={onAskCoach}>
              <MessageSquareText className="h-4 w-4" /> Coach
            </Button>
          </div>
          {hintShown && status !== 'done' && (
            <div className="mt-3">
              <CoachBubble tone="hint" coach={coach} speakText={step.hint}>{step.hint}</CoachBubble>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* Guess the move: play through a real master game (or a labeled composed
   study) one guess at a time. Full credit for the master move or an equal
   alternative, half credit for the playable second best, and a miss shows
   the idea instead of scolding. Guided, never punishing. */
function GtmStepView({
  step,
  coach,
  onPass,
  soundEnabled,
  showLegal,
  theme,
}: {
  step: GtmStep
  coach?: Coach
  onPass: () => void
  soundEnabled: boolean
  showLegal: boolean
  theme: string
}) {
  const startFen = useMemo(() => {
    const g = new Chess(step.fen)
    for (const san of step.prelude ?? []) {
      try {
        g.move(san)
      } catch {
        /* validated content */
      }
    }
    return g.fen()
  }, [step])
  const guessSide = useMemo(() => new Chess(startFen).turn(), [startFen])

  const gameRef = useRef(new Chess(startFen))
  const [fen, setFen] = useState(startFen)
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [misses, setMisses] = useState(0)
  const [results, setResults] = useState<Array<'full' | 'half' | 'none'>>([])
  const [feedback, setFeedback] = useState<{ tone: 'praise' | 'guide' | 'hint'; text: string } | null>(null)
  const [phase, setPhase] = useState<'guess' | 'done'>('guess')
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [shake, setShake] = useState(false)
  const lockedRef = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    },
    [],
  )

  const flash = useCallback((marks: FlashMark[], ms = 2400) => {
    setFlashes(marks)
    timers.current.push(setTimeout(() => setFlashes([]), ms))
  }, [])

  const game = useMemo(() => new Chess(fen), [fen])
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  const advanceAfter = useCallback(
    (cur: GtmStep['moves'][number]) => {
      lockedRef.current = true
      later(() => {
        const g = gameRef.current
        if (cur.reply) {
          try {
            const rmv = g.move(cur.reply)
            if (rmv) {
              setFen(g.fen())
              setLastMove({ from: rmv.from, to: rmv.to })
              playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
            }
          } catch {
            /* validated content */
          }
          later(() => {
            lockedRef.current = false
            setIdx((i) => i + 1)
            setMisses(0)
          }, 650)
        } else {
          lockedRef.current = false
          setPhase('done')
          onPass()
        }
      }, 1150)
    },
    [later, onPass, soundEnabled],
  )

  const applyMasterMove = useCallback(
    (g: Chess, cur: GtmStep['moves'][number]) => {
      const master = g.move(cur.san)
      if (master) {
        setFen(g.fen())
        setLastMove({ from: master.from, to: master.to })
        playSound(master.captured ? 'capture' : 'move', soundEnabled)
        setFlashes([
          { square: master.from, color: 'gold' },
          { square: master.to, color: 'green' },
        ])
        timers.current.push(setTimeout(() => setFlashes([]), 900))
      }
    },
    [soundEnabled],
  )

  function onMove(from: Square, to: Square, promotion?: string) {
    if (lockedRef.current || phase !== 'guess') return
    const g = gameRef.current
    const cur = step.moves[idx]
    if (!cur) return
    let mv
    try {
      mv = g.move({ from, to, promotion: promotion ?? undefined })
    } catch {
      return
    }
    if (!mv) return

    const norm = (s: string) => s.replace(/[+#]/g, '')
    const equalsAny = (list?: string[]) => (list ?? []).some((a) => norm(a) === norm(mv!.san))

    if (norm(mv.san) === norm(cur.san) || equalsAny(cur.alsoGood)) {
      // full credit: their move stands
      setFen(g.fen())
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
      setScore((s) => s + 1)
      setResults((r) => [...r, 'full'])
      setFeedback({ tone: 'praise', text: cur.why })
      advanceAfter(cur)
      return
    }

    g.undo() // take the guess back; the board returns to the guess position

    if (equalsAny(cur.okay)) {
      // half credit: playable, but show the stronger idea
      applyMasterMove(g, cur)
      setScore((s) => s + 0.5)
      setResults((r) => [...r, 'half'])
      setFeedback({ tone: 'hint', text: `Playable, but the master found the stronger idea: ${cur.san}. ${cur.why}` })
      advanceAfter(cur)
      return
    }

    // a miss: guide first, show the move after the third try
    const n = misses + 1
    setMisses(n)
    setShake(true)
    timers.current.push(setTimeout(() => setShake(false), 420))
    playSound('wrong', soundEnabled)
    if (n >= 3) {
      applyMasterMove(g, cur)
      setResults((r) => [...r, 'none'])
      setFeedback({ tone: 'guide', text: `The master played ${cur.san}. ${cur.why}` })
      advanceAfter(cur)
    } else if (n === 2) {
      setFeedback({ tone: 'hint', text: 'Look again. The piece the master moves is glowing on the board.' })
      try {
        const probe = new Chess(g.fen())
        const hintMv = probe.move(cur.san)
        if (hintMv) flash([{ square: hintMv.from, color: 'gold' }])
      } catch {
        /* validated content */
      }
    } else {
      setFeedback({ tone: 'guide', text: 'Not the idea the master had. Check every check, capture and threat, then play your guess.' })
    }
  }

  function reset() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    lockedRef.current = false
    gameRef.current = new Chess(startFen)
    setFen(startFen)
    setIdx(0)
    setScore(0)
    setMisses(0)
    setResults([])
    setFeedback(null)
    setPhase('guess')
    setLastMove(null)
    setFlashes([])
  }

  const total = step.moves.length
  const lineSoFar = [...(step.prelude ?? [])]
  for (let i = 0; i < Math.min(idx + (phase === 'done' ? 1 : 0), total); i++) {
    lineSoFar.push(step.moves[i].san)
    if (step.moves[i].reply && (i < idx || phase === 'done')) lineSoFar.push(step.moves[i].reply!)
  }

  const summary =
    score >= total * 0.85
      ? 'You were reading the position the same way the master did.'
      : score >= total * 0.5
        ? 'Solid instincts. The ideas you missed are now part of your toolkit.'
        : 'Now you have seen the full idea once. Play it again, and see how much more you find.'

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div>
        <ChessBoard
          fen={fen}
          orientation={guessSide}
          onMove={onMove}
          movableSide={phase === 'guess' && !lockedRef.current ? guessSide : undefined}
          interactive={phase === 'guess' && !lockedRef.current}
          lastMove={lastMove}
          checkSquare={checkSquare}
          showLegal={showLegal && phase === 'guess' && !lockedRef.current}
          flashes={flashes}
          theme={theme}
          shake={shake}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guess the move</div>
            <div className="flex items-center gap-1.5">
              {step.moves.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    i >= results.length
                      ? i === idx && phase === 'guess'
                        ? 'bg-primary ring-2 ring-primary/30'
                        : 'bg-border'
                      : results[i] === 'full'
                        ? 'bg-primary'
                        : results[i] === 'half'
                          ? 'bg-[#e6a82c]'
                          : 'bg-red-400/70',
                  )}
                />
              ))}
              <span className="ml-1 font-mono text-xs font-bold">
                {score} / {total}
              </span>
            </div>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold">{step.title}</h2>
          {step.body.map((p, i) => (
            <p key={i} className="mt-2 text-sm text-foreground/90">
              {p}
            </p>
          ))}
          <div className="mt-2 rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">{step.source}</div>

          <div className="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2">
            {phase === 'guess' ? (
              <p className="text-sm font-semibold">
                Move {idx + 1} of {total}. {guessSide === 'w' ? 'White' : 'Black'} to move. What did the master play?
              </p>
            ) : (
              <p className="text-sm font-semibold">Game complete.</p>
            )}
            {lineSoFar.length > 0 && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">{lineSoFar.join(' ')}</p>
            )}
          </div>

          {feedback && (
            <div className="mt-3">
              <CoachBubble tone={feedback.tone} coach={coach} speakText={feedback.text}>
                {feedback.text}
              </CoachBubble>
            </div>
          )}
          {phase === 'done' && (
            <div className="mt-3">
              <CoachBubble tone="praise" coach={coach} speakText={`${summary} You scored ${score} out of ${total}.`}>
                {summary} <span className="font-mono font-bold">({score} / {total})</span>
              </CoachBubble>
            </div>
          )}

          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> {phase === 'done' ? 'Play it again' : 'Start over'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayoutStepView({
  step,
  level,
  coach,
  onPass,
  soundEnabled,
  showLegal,
  theme,
}: {
  step: Extract<LessonStep, { type: 'playout' }>
  level: number
  coach?: Coach
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
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Play it out · Global level {level}</div>
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
          <div className="mt-3">
            <CoachBubble tone="praise" coach={coach} speakText={step.successText}>{step.successText}</CoachBubble>
          </div>
        )}
        {(status === 'lost' || status === 'draw') && (
          <div className="mt-3">
            <CoachBubble
              tone="guide"
              coach={coach}
              speakText={step.failText ?? (status === 'draw' ? 'A draw is not the goal here.' : 'That did not work. Reset and try a different plan.')}
            >
              {step.failText ?? (status === 'draw' ? 'A draw is not the goal here.' : 'That did not work. Reset and try a different plan.')}
            </CoachBubble>
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

void TIERS
