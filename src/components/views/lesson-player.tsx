'use client'
import { readJson } from '@/lib/api-client'

// Lesson player, chess.com-style: a dark charcoal page with the board as the
// centerpiece. Left column: the coach persona in a speech bubble (live
// guidance, hints and praise all flow through it) above a step rail of
// numbered chips (green check done, glowing orange current, dim locked).
// Center: bold step title above a large board, chunky green action bar below.
// Slim green progress bar pinned to the top. A rewarding completion screen
// with real stats closes the lesson. All teaching logic (interactive moves,
// legal-move flashes, guided mistakes, TTS, sounds, progress reporting) is
// unchanged; only the presentation was rebuilt.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow, type FlashMark, type Mark } from '@/components/chess/board'
import { findLevel } from '@/content/levels'
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
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Lightbulb,
  MessageSquareText,
  RotateCcw,
  CheckCircle2,
  Play,
  Undo2,
  Sparkles,
  CircleAlert,
} from 'lucide-react'

/* ---------------- shared bits ---------------- */

type BubbleTone = 'praise' | 'guide' | 'hint' | 'neutral'

interface BubbleMsg {
  tone: BubbleTone
  text: string
  speak?: string
  chip?: string
}

const STEP_LABELS: Record<LessonStep['type'], string> = {
  text: 'Read',
  demo: 'Watch',
  quiz: 'Quiz',
  exercise: 'Solve',
  playout: 'Play out',
  gtm: 'Guess the move',
}

function chipFor(tone: BubbleTone): string | undefined {
  if (tone === 'praise') return 'Nice'
  if (tone === 'guide') return 'Look again'
  if (tone === 'hint') return 'Hint'
  return undefined
}

/** The instruction the coach opens every step with, derived from the step data. */
function defaultBubbleFor(step: LessonStep): BubbleMsg {
  switch (step.type) {
    case 'text':
      return { tone: 'neutral', text: step.keyIdea ?? step.body[0] ?? step.title }
    case 'demo':
      return { tone: 'neutral', text: step.body[0] ?? step.title }
    case 'quiz':
      return { tone: 'neutral', text: step.question }
    case 'exercise':
      return { tone: 'neutral', text: step.goal }
    case 'playout':
      return { tone: 'neutral', text: step.goal }
    case 'gtm':
      return { tone: 'neutral', text: step.body[0] ?? step.title }
  }
}

function railState(i: number, stepIdx: number, reached: number, lessonDone: boolean): 'done' | 'current' | 'locked' {
  if (lessonDone) return 'done'
  if (i === stepIdx) return 'current'
  if (i <= reached) return 'done'
  return 'locked'
}

/** Dark small action button used in toolbars under the board and in the top bar. */
function ToolButton({
  onClick,
  disabled,
  ariaLabel,
  className,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'border border-[#262421]/10 bg-[#262421]/10 text-xs font-bold text-[#262421] hover:bg-[#262421]/15 hover:text-[#262421]',
        className,
      )}
    >
      {children}
    </Button>
  )
}

/* Coach persona panel: face + white speech bubble on the dark page. Every
   step view reports its live guidance up to the parent so the coach is always
   in one place, talking while the student works the board.
   No coach chosen yet? The panel becomes the chooser: nothing speaks until
   the player picks who mentors them. */
function CoachPanel({
  tone,
  chip,
  coach,
  speakText,
  children,
}: {
  tone: BubbleTone
  chip?: string
  coach?: Coach
  speakText?: string
  children: React.ReactNode
}) {
  const { pick, busyId } = usePickCoach()
  if (!coach) {
    return (
      <div className="rounded-2xl bg-[#fdfbf5] p-4 shadow-lg">
        <p className="text-sm font-extrabold text-[#312e2b]">Pick your coach. Every hint and success message is theirs.</p>
        <div className="mt-2.5">
          <CoachCards value={busyId} onChange={(id) => void pick(id)} columns={2} compact />
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-3">
      <CharacterFace
        id={coach.id}
        label={coach.name}
        className="h-11 w-11 shrink-0 rounded-full border-2 border-[#5d8534] shadow-lg lg:h-14 lg:w-14"
      />
      <div
        className={cn(
          'relative min-w-0 flex-1 rounded-2xl bg-[#fdfbf5] px-4 py-3 text-[#312e2b] shadow-lg',
          tone === 'guide' && 'ring-2 ring-[#e6a82c]/70',
          tone === 'hint' && 'ring-2 ring-[#e6a82c]/45',
          tone === 'praise' && 'ring-2 ring-[#81b64c]/60',
        )}
      >
        <span aria-hidden className="absolute -left-1 top-5 h-3 w-3 rotate-45 rounded-[2px] bg-[#fdfbf5]" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6f8f42]">
          {coach.name} · {coach.title}
        </p>
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">{children}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {chip && (
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm',
                  tone === 'praise' ? 'bg-[#81b64c]' : 'bg-[#e6a82c]',
                )}
              >
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

/** Numbered rail chip: green check when done, glowing orange when current, dim when locked. */
function StepChip({ state, index }: { state: 'done' | 'current' | 'locked'; index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-xs font-extrabold transition-all',
        state === 'done' && 'bg-[#81b64c] text-white shadow-[0_2px_0_#5d8534]',
        state === 'current' &&
          'bg-[#e8a33d] text-white shadow-[0_0_0_3px_rgba(232,163,61,0.25),0_0_16px_rgba(232,163,61,0.55)]',
        state === 'locked' && 'bg-[#262421]/10 text-[#262421]/40',
      )}
    >
      {state === 'done' ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
    </span>
  )
}

/** The figure plate: every board sits on a deep ink frame with a bookish
    italic caption, like a printed diagram in a chess book. This is the
    visual signature of the Study: paper page, ink plate, living board. */
function BoardPlate({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[620px]">
      <div className="rounded-2xl bg-[#262421] p-2.5 shadow-[0_16px_40px_rgba(38,36,33,0.25)] sm:p-3">
        {children}
        {label && (
          <div className="mt-2.5 flex items-center justify-between px-1">
            <span className="font-book text-[12px] italic text-[#f4f1e8]/75">{label}</span>
            <span className="text-[9px] font-extrabold uppercase tracking-[0.24em] text-[#f4f1e8]/35">
              ChessX study
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function sideToPlayLabel(fen: string): string {
  const side = fen.split(' ')[1] === 'b' ? 'Black to play' : 'White to play'
  const move = Number(fen.split(' ')[5] ?? 1)
  return `${side}, move ${move}`
}

/* ---------------- main player ---------------- */

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const { navigate, profile, setPendingReview } = useApp()
  const coach = coachMaybe(profile?.coach)
  const found = findLevel(lessonId)
  const [stepIdx, setStepIdx] = useState(0)
  const [canAdvance, setCanAdvance] = useState(false)
  const [done, setDone] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const [bubble, setBubble] = useState<BubbleMsg | null>(null)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const savedRef = useRef({ stepsDone: 0, postedDone: false })
  const mobileChipRefs = useRef<Array<HTMLButtonElement | null>>([])

  // first-try streak: every scored step solved without a miss extends it,
  // any miss resets it. Honest numbers from this session only.
  const streakRef = useRef(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const reportResult = useCallback((firstTry: boolean) => {
    streakRef.current = firstTry ? streakRef.current + 1 : 0
    setStreak(streakRef.current)
    setBestStreak((b) => Math.max(b, streakRef.current))
  }, [])

  const tier = found?.tier
  const lesson = found?.level
  const globalLevel = found?.globalN ?? 0

  const [xpFlash, setXpFlash] = useState<number | null>(null)
  const xpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveProgress = useCallback(
    (stepsDone: number, finished: boolean, hintNow = false) => {
      if (!lesson || !tier) return
      // A spaced-review replay launched from the Review view grades that item.
      const pending = useApp.getState().pendingReview
      const reviewItemId =
        pending?.kind === 'lesson' && pending.refId === lesson.id ? pending.itemId : null
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
          concepts: lesson.concepts ?? [],
          reviewItemId,
          dayKey: new Date().toLocaleDateString('sv-SE'),
        }),
      })
        .then((r) => readJson<unknown>(r))
        .then((d) => {
          if (d.profile) useApp.getState().setProfile(d.profile)
          if (reviewItemId) setPendingReview(null)
          if (typeof d.xpGain === 'number' && d.xpGain > 0) {
            setXpFlash(d.xpGain)
            if (xpTimerRef.current) clearTimeout(xpTimerRef.current)
            xpTimerRef.current = setTimeout(() => setXpFlash(null), 2500)
          }
        })
        .catch(() => {})
    },
    [lesson, tier, globalLevel, setPendingReview],
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

  // hint presses count toward honest spaced review: report each one
  const handleHintUsed = useCallback(() => {
    setHintsUsed((n) => n + 1)
    saveProgress(Math.max(maxReached, stepIdx), false, true)
  }, [saveProgress, stepIdx, maxReached])

  const handleBubble = useCallback((m: BubbleMsg | null) => setBubble(m), [])

  // keep the current chip of the mobile step strip in view
  useEffect(() => {
    mobileChipRefs.current[stepIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [stepIdx])

  const isLastStep = lesson ? stepIdx === lesson.steps.length - 1 : false
  if (lesson && isLastStep && canAdvance && !done) {
    setDone(true)
  }

  if (!lesson || !tier) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center paper px-4 text-center text-[#262421]">
        <p className="text-sm font-semibold text-[#262421]/70">Lesson not found.</p>
        <Button className="btn-hero mt-4 h-11 px-6" onClick={() => navigate('lessons')}>
          Back to lessons
        </Button>
      </div>
    )
  }

  const step = lesson.steps[stepIdx]
  const last = stepIdx === lesson.steps.length - 1
  const total = lesson.steps.length
  const reached = Math.max(stepIdx, maxReached)
  const completedSteps = done ? total : reached
  const pct = total > 0 ? Math.round((completedSteps / total) * 100) : 0
  const shownBubble = bubble ?? defaultBubbleFor(step)

  function goNext() {
    if (last && !done) {
      setDone(true)
      return
    }
    if (last && done) {
      navigate('lessons')
      return
    }
    const next = stepIdx + 1
    setStepIdx(next)
    setMaxReached((m) => Math.max(m, next))
    setCanAdvance(false)
  }

  function goPrev() {
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1)
      setCanAdvance(true)
    }
  }

  function jumpToStep(i: number) {
    if (i <= reached) {
      setStepIdx(i)
      setMaxReached((m) => Math.max(m, i))
      setCanAdvance(i < reached)
    }
  }

  // (completion effect moved above the early return to keep hook order stable)

  const introLines: string[] =
    step.type === 'gtm'
      ? step.body
      : step.type === 'exercise' || step.type === 'playout'
        ? step.body
          ? [step.body]
          : []
        : []

  const lockLabel =
    step.type === 'exercise' || step.type === 'playout'
      ? 'Solve it to continue'
      : step.type === 'gtm'
        ? 'Guess the move to continue'
        : step.type === 'quiz'
          ? 'Answer to continue'
          : 'Continue'

  return (
    <div className="min-h-screen w-full paper text-[#262421]">
      {/* top bar with slim green progress */}
      <header className="sticky top-0 z-40 border-b border-[#262421]/10 bg-[#f4f1e8]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-4 py-2.5 sm:gap-3">
          <button
            onClick={() => navigate('lessons')}
            aria-label="Back to lessons"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#262421]/70 transition hover:bg-[#262421]/10 hover:text-[#262421]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[#262421]/45">
              Chapter {tier.n} · {tier.title}
            </div>
            <h1 className="truncate font-book text-base font-semibold text-[#262421] sm:text-lg">{lesson.title}</h1>
          </div>
          {xpFlash != null && (
            <span className="inline-flex shrink-0 animate-pulse items-center gap-1 rounded-full bg-[#81b64c] px-2.5 py-1 text-xs font-extrabold text-white shadow">
              <Sparkles className="h-3.5 w-3.5" /> +{xpFlash} XP
            </span>
          )}
          {streak >= 2 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#e8a33d]/40 bg-[#e8a33d]/15 px-2.5 py-1 text-xs font-extrabold text-[#9a5b00]"
              aria-label={`${streak} correct answers in a row`}
            >
              <Flame className="h-3.5 w-3.5 text-[#e8681d]" />
              {streak >= 4 ? `On fire: ${streak}` : `${streak} in a row`}
            </span>
          )}
          <ToolButton onClick={() => setCoachOpen(true)} ariaLabel="Ask the coach" className="shrink-0">
            <MessageSquareText className="h-4 w-4" />
            <span className="hidden sm:inline">Coach</span>
          </ToolButton>
          <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <span
              className="text-xs font-extrabold tabular-nums text-[#262421]/60"
              aria-label={`${completedSteps} of ${total} steps completed`}
            >
              {completedSteps}/{total}
            </span>
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-[#262421]/10 lg:w-40"
              role="progressbar"
              aria-label="Lesson progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completedSteps}
            >
              <div
                className="h-full rounded-full bg-[#81b64c] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
        {/* mobile progress strip */}
        <div className="flex items-center gap-2 px-4 pb-2 sm:hidden">
          <span className="shrink-0 text-[10px] font-extrabold tabular-nums text-[#262421]/50">
            {completedSteps}/{total} steps
          </span>
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-[#262421]/10"
            role="progressbar"
            aria-label="Lesson progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completedSteps}
          >
            <div className="h-full rounded-full bg-[#81b64c] transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      {done ? (
        <CompletionScreen
          lesson={lesson}
          coach={coach}
          message={bubble?.text ?? null}
          hintsUsed={hintsUsed}
          xpGain={xpFlash}
          bestStreak={bestStreak}
          tierTitle={tier.title}
          onContinue={() => navigate('lessons')}
        />
      ) : (
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6">
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8">
            {/* coach column: bubble + step rail */}
            <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
              <CoachPanel
                tone={shownBubble.tone}
                chip={shownBubble.chip}
                coach={coach}
                speakText={shownBubble.speak ?? shownBubble.text}
              >
                {shownBubble.text}
              </CoachPanel>

              {/* mobile: horizontal strip of numbered chips */}
              <ol className="scroll-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden" aria-label="Lesson steps">
                {lesson.steps.map((s, i) => {
                  const st = railState(i, stepIdx, reached, done)
                  return (
                    <li key={i} className="shrink-0">
                      <button
                        ref={(el) => {
                          mobileChipRefs.current[i] = el
                        }}
                        onClick={() => jumpToStep(i)}
                        disabled={i > reached}
                        aria-label={`Step ${i + 1}: ${s.title}`}
                        aria-current={i === stepIdx ? 'step' : undefined}
                        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#262421]/40"
                      >
                        <StepChip state={st} index={i} />
                      </button>
                    </li>
                  )
                })}
              </ol>

              {/* desktop: vertical rail with labels */}
              <nav aria-label="Lesson steps" className="relative hidden lg:block">
                <span aria-hidden="true" className="absolute bottom-4 left-[15px] top-4 w-px bg-[#262421]/10" />
                <ol className="relative space-y-1">
                  {lesson.steps.map((s, i) => {
                    const st = railState(i, stepIdx, reached, done)
                    return (
                      <li key={i}>
                        <button
                          onClick={() => jumpToStep(i)}
                          disabled={i > reached}
                          aria-current={i === stepIdx ? 'step' : undefined}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition-colors',
                            st === 'current' ? 'bg-[#262421]/5' : st !== 'locked' && 'hover:bg-[#262421]/5',
                            st === 'locked' && 'opacity-60',
                          )}
                        >
                          <StepChip state={st} index={i} />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-xs font-extrabold',
                                st === 'current' ? 'text-[#262421]' : 'text-[#262421]/70',
                              )}
                            >
                              {STEP_LABELS[s.type]}
                            </span>
                            <span className="block truncate text-[11px] text-[#262421]/40">{s.title}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </nav>
            </aside>

            {/* board column */}
            <section className="min-w-0">
              <div className="mb-4">
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#4a6b28]">
                  <span>{STEP_LABELS[step.type]}</span>
                  {step.type === 'playout' && (
                    <span className="rounded-full bg-[#262421]/10 px-2 py-0.5 text-[9px] font-bold tracking-normal text-[#262421]/60">
                      Global level {globalLevel}
                    </span>
                  )}
                </div>
                <h2 className="font-book text-2xl font-semibold text-[#262421] sm:text-[1.7rem]">{step.title}</h2>
                {step.type === 'gtm' && <p className="mt-0.5 text-[11px] font-semibold text-[#262421]/40">{step.source}</p>}
                {introLines.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {introLines.map((p, i) => (
                      <p key={i} className="max-w-2xl text-sm leading-relaxed text-[#262421]/60">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {step.type === 'playout' ? (
                <PlayoutStepView
                  key={stepIdx}
                  step={step}
                  onPass={() => setCanAdvance(true)}
                  onResult={reportResult}
                  onBubble={handleBubble}
                  soundEnabled={profile?.soundEnabled ?? true}
                  showLegal={profile?.showLegal ?? true}
                  theme={profile?.theme ?? 'green'}
                />
              ) : step.type === 'gtm' ? (
                <GtmStepView
                  key={stepIdx}
                  step={step}
                  onPass={() => setCanAdvance(true)}
                  onResult={reportResult}
                  onBubble={handleBubble}
                  soundEnabled={profile?.soundEnabled ?? true}
                  showLegal={profile?.showLegal ?? true}
                  theme={profile?.theme ?? 'green'}
                />
              ) : step.type === 'exercise' ? (
                <ExerciseView
                  key={stepIdx}
                  step={step}
                  onPass={() => setCanAdvance(true)}
                  onResult={reportResult}
                  onBubble={handleBubble}
                  onHintUsed={handleHintUsed}
                  soundEnabled={profile?.soundEnabled ?? true}
                  showLegal={profile?.showLegal ?? true}
                  theme={profile?.theme ?? 'green'}
                  onAskCoach={() => setCoachOpen(true)}
                />
              ) : step.type === 'demo' ? (
                <div className="flex flex-col items-center">
                  <BoardPlate>
                    <DemoBoard
                      key={stepIdx}
                      fen={step.fen}
                      moves={step.moves}
                      marks={step.marks}
                      arrows={step.arrows}
                      caption={step.caption}
                      soundEnabled={profile?.soundEnabled ?? true}
                    />
                  </BoardPlate>
                  <DemoTextCard
                    key={`t${stepIdx}`}
                    step={step}
                    coach={coach}
                    onReady={() => setCanAdvance(true)}
                    onBubble={handleBubble}
                  />
                </div>
              ) : step.type === 'text' ? (
                <TextStepView
                  key={stepIdx}
                  step={step}
                  coach={coach}
                  onReady={() => setCanAdvance(true)}
                  onBubble={handleBubble}
                />
              ) : (
                <QuizStepView
                  key={stepIdx}
                  step={step}
                  stepIdx={stepIdx}
                  soundEnabled={profile?.soundEnabled ?? true}
                  onPass={() => setCanAdvance(true)}
                  onResult={reportResult}
                  onBubble={handleBubble}
                />
              )}

              {/* action bar */}
              <div className="sticky bottom-20 z-30 mt-6 lg:bottom-4">
                <div className="flex items-center gap-3 rounded-2xl border border-[#262421]/10 bg-[#fdfbf5]/95 p-3 shadow-[0_8px_30px_rgba(38,36,33,0.12)] backdrop-blur sm:p-4">
                  <Button
                    variant="ghost"
                    onClick={goPrev}
                    disabled={stepIdx === 0}
                    aria-label="Previous step"
                    className="h-12 shrink-0 border border-[#262421]/15 bg-transparent px-3 font-display text-sm font-bold text-[#262421] hover:bg-[#262421]/10 hover:text-[#262421] sm:px-4"
                  >
                    <ChevronLeft className="h-4 w-4" /> Back
                  </Button>
                  {canAdvance ? (
                    <Button className="btn-hero h-12 flex-1 text-base" onClick={goNext}>
                      {last ? 'Complete lesson' : 'Continue'} <ChevronRight className="h-5 w-5" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled
                      className="h-12 flex-1 cursor-not-allowed border border-[#262421]/15 bg-transparent text-sm font-bold text-[#262421]/40 hover:bg-transparent"
                    >
                      {lockLabel}
                    </Button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

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

/* ---------------- completion ---------------- */

/** One-shot confetti in the course palette. Skipped entirely when the user
    prefers reduced motion. Purely visual, aria-hidden, never interactive. */
function Confetti() {
  const reduce = useReducedMotion()
  const pieces = useMemo(() => {
    const colors = ['#81b64c', '#a3d160', '#e8a33d', '#c07f1d', '#5d8534']
    return Array.from({ length: 28 }, (_, i) => ({
      id: i,
      left: 2 + Math.random() * 96,
      delay: Math.random() * 0.6,
      duration: 2.1 + Math.random() * 1.5,
      size: 6 + Math.random() * 7,
      color: colors[i % colors.length],
      drift: -36 + Math.random() * 72,
      spin: 300 + Math.random() * 420,
      round: Math.random() < 0.3,
    }))
  }, [])
  if (reduce) return null
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0"
          style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '9999px' : '2px' }}
          initial={{ y: -24, x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: 320, x: p.drift, opacity: [1, 1, 0.9, 0], rotate: p.spin }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}

function CompletionScreen({
  lesson,
  coach,
  message,
  hintsUsed,
  xpGain,
  bestStreak,
  tierTitle,
  onContinue,
}: {
  lesson: NonNullable<ReturnType<typeof findLevel>['level']>
  coach?: Coach
  message: string | null
  hintsUsed: number
  xpGain: number | null
  bestStreak: number
  tierTitle: string
  onContinue: () => void
}) {
  const chapterEnd = lesson.n >= 20
  return (
    <div className="relative mx-auto w-full max-w-xl animate-in fade-in zoom-in-95 px-4 py-8 text-center duration-500 sm:py-12">
      <Confetti />
      <div aria-hidden="true" className="relative mx-auto h-28 w-44">
        <img
          src="/pieces/wK.svg"
          alt=""
          className="absolute left-0 top-1 h-24 w-24 -rotate-6 drop-shadow-[0_10px_14px_rgba(0,0,0,0.5)]"
        />
        <img
          src="/pieces/wQ.svg"
          alt=""
          className="absolute right-0 top-3 h-24 w-24 rotate-6 drop-shadow-[0_10px_14px_rgba(0,0,0,0.5)]"
        />
      </div>
      <h2 className="mt-2 font-book text-4xl font-semibold text-[#262421] sm:text-5xl">
        {chapterEnd ? 'Chapter complete' : 'Lesson complete'}
      </h2>
      <p className="mt-1 text-sm font-semibold text-[#262421]/55">
        {chapterEnd ? `The ${tierTitle} chapter is finished` : lesson.title}
      </p>

      <div className="relative mx-auto mt-6 flex max-w-md items-start gap-3 rounded-2xl bg-[#fdfbf5] p-4 text-left shadow-xl">
        {coach ? (
          <CharacterFace
            id={coach.id}
            label={coach.name}
            className="h-12 w-12 shrink-0 rounded-full border-2 border-[#5d8534]"
          />
        ) : (
          <img
            src="/brand.svg"
            alt="ChessX"
            className="h-12 w-12 shrink-0 rounded-full border-2 border-[#262421]/10 bg-[#f4f1e8] p-1"
          />
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6f8f42]">{coach ? coach.name : 'ChessX'}</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-[#312e2b]">
            {message ??
              (chapterEnd
                ? `Every level of ${tierTitle} is behind you. The next chapter opens at its first level whenever you are ready.`
                : `All ${lesson.steps.length} steps complete. Replay it any time to keep it sharp.`)}
          </p>
        </div>
      </div>

      {/* real stats from this session: steps completed, hints, best first-try streak, xp from the server */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#262421]/10 bg-[#262421]/5 px-3.5 py-1.5 text-xs font-extrabold text-[#262421]/75">
          <Check className="h-3.5 w-3.5 text-[#81b64c]" strokeWidth={3} />
          {lesson.steps.length} of {lesson.steps.length} steps
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#262421]/10 bg-[#262421]/5 px-3.5 py-1.5 text-xs font-extrabold text-[#262421]/75">
          <Lightbulb className="h-3.5 w-3.5 text-[#e8a33d]" />
          Hints used: {hintsUsed}
        </span>
        {bestStreak >= 2 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e8a33d]/40 bg-[#e8a33d]/15 px-3.5 py-1.5 text-xs font-extrabold text-[#9a5b00]">
            <Flame className="h-3.5 w-3.5 text-[#e8681d]" />
            Best streak: {bestStreak}
          </span>
        )}
        {xpGain != null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#81b64c]/40 bg-[#81b64c]/15 px-3.5 py-1.5 text-xs font-extrabold text-[#4a6b28]">
            <Sparkles className="h-3.5 w-3.5" />+{xpGain} XP
          </span>
        )}
      </div>

      <Button className="btn-hero mt-8 h-13 w-full max-w-xs text-base" onClick={onContinue}>
        Continue <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  )
}

/* ---------------- step views ---------------- */

function TextStepView({
  step,
  coach,
  onReady,
  onBubble,
}: {
  step: Extract<LessonStep, { type: 'text' }>
  coach?: Coach
  onReady: () => void
  onBubble: (m: BubbleMsg | null) => void
}) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  const spoken = [...step.body, step.keyIdea].filter(Boolean).join(' ')
  const bubbleText = step.keyIdea ?? step.body[0] ?? step.title
  useLayoutEffect(() => {
    onBubble({ tone: 'neutral', text: bubbleText, speak: spoken })
  }, [onBubble, bubbleText, spoken])
  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-[#262421]/10 bg-[#fdfbf5] p-6 shadow-[0_2px_12px_rgba(38,36,33,0.06)] sm:p-6">
      {/* float the speaker so the first lines wrap around it instead of hiding under it */}
      <div className="space-y-3">
        {coach && (
          <span className="float-right ml-3 mb-1 leading-none">
            <SpeakButton text={spoken} voice={coach.voice} speed={coach.speed} />
          </span>
        )}
        {step.body.map((p, i) => (
          <p key={i} className="leading-relaxed text-[#262421]/85">
            {p}
          </p>
        ))}
      </div>
      {step.keyIdea && (
        <div className="mt-4 rounded-xl border border-[#81b64c]/30 bg-[#81b64c]/10 px-4 py-3 text-sm font-semibold text-[#262421]">
          {step.keyIdea}
        </div>
      )}
    </div>
  )
}

function DemoTextCard({
  step,
  coach,
  onReady,
  onBubble,
}: {
  step: Extract<LessonStep, { type: 'demo' }>
  coach?: Coach
  onReady: () => void
  onBubble: (m: BubbleMsg | null) => void
}) {
  useEffect(() => {
    onReady()
  }, [onReady, step])
  const spoken = step.body.join(' ')
  const bubbleText = step.body[0] ?? step.title
  useLayoutEffect(() => {
    onBubble({ tone: 'neutral', text: bubbleText, speak: spoken })
  }, [onBubble, bubbleText, spoken])
  return (
    <div className="mt-4 w-full max-w-2xl rounded-2xl border border-[#262421]/10 bg-[#fdfbf5] p-6 shadow-[0_2px_12px_rgba(38,36,33,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-2.5">
          {step.body.map((p, i) => (
            <p key={i} className="leading-relaxed text-[#262421]/85">
              {p}
            </p>
          ))}
        </div>
        {coach && <SpeakButton text={spoken} voice={coach.voice} speed={coach.speed} />}
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
  // The line never plays itself: the reader predicts first, then taps
  // "Watch the line". Autoplay here only means "the scripted line is running".
  const [autoplay, setAutoplay] = useState(false)
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
            <div className="mb-3 rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold text-[#f4f1e8] shadow-lg">
              Playing the line…
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#262421]/50">{caption ?? ''}</div>
        <div className="flex flex-wrap gap-1.5">
          {moves && moves.length > 0 && (
            <ToolButton onClick={() => playLine(150)} disabled={autoplay} ariaLabel="Watch the line">
              <Play className="h-4 w-4" /> Watch the line
            </ToolButton>
          )}
          <ToolButton onClick={undo} disabled={autoplay || depth === 0} ariaLabel="Undo move">
            <Undo2 className="h-4 w-4" /> Undo
          </ToolButton>
          <ToolButton onClick={reset} disabled={autoplay || depth === 0} ariaLabel="Reset board">
            <RotateCcw className="h-4 w-4" /> Reset
          </ToolButton>
        </div>
      </div>
      {!autoplay && depth === 0 && (
        <p className="mt-1 text-xs text-[#262421]/40">
          {moves?.length
            ? 'Call your guess first, then tap Watch the line. After that, the board is yours to explore.'
            : 'This board is yours to explore. Pick up any piece and try moves.'}
        </p>
      )}
    </div>
  )
}

function QuizStepView({
  step,
  stepIdx,
  soundEnabled,
  onPass,
  onResult,
  onBubble,
}: {
  step: Extract<LessonStep, { type: 'quiz' }>
  stepIdx: number
  soundEnabled: boolean
  onPass: () => void
  onResult: (firstTry: boolean) => void
  onBubble: (m: BubbleMsg | null) => void
}) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [misses, setMisses] = useState(0)
  const [answeredCorrect, setAnsweredCorrect] = useState(false)
  const correctIdx = step.options.findIndex((o) => o.correct)

  function choose(i: number) {
    if (answeredCorrect) return
    if (step.options[i].correct) {
      setChosen(i)
      setAnsweredCorrect(true)
      onResult(misses === 0)
      onPass()
    } else {
      setChosen(i)
      setMisses((m) => m + 1)
      onResult(false)
    }
  }

  const bubbleTone: BubbleTone = answeredCorrect
    ? 'praise'
    : chosen != null && !step.options[chosen].correct
      ? 'guide'
      : 'neutral'
  const bubbleText = answeredCorrect
    ? `Correct. ${step.options[correctIdx]?.why ?? ''}`
    : chosen != null && !step.options[chosen].correct
      ? `${step.options[chosen].why} Take another look.`
      : step.question
  useLayoutEffect(() => {
    onBubble({ tone: bubbleTone, text: bubbleText, speak: bubbleText, chip: chipFor(bubbleTone) })
  }, [onBubble, bubbleTone, bubbleText])

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-[#262421]/10 bg-[#fdfbf5] p-6 shadow-[0_2px_12px_rgba(38,36,33,0.06)] sm:p-6">
      {step.body && <p className="text-sm leading-relaxed text-[#262421]/60">{step.body}</p>}
      {step.fen && (
        <div className="mt-3">
          <BoardPlate>
            <DemoBoard key={stepIdx} fen={step.fen} soundEnabled={soundEnabled} />
          </BoardPlate>
        </div>
      )}
      <p className="mt-3 font-book text-lg font-semibold text-[#262421] sm:text-xl">{step.question}</p>
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
                'flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold text-[#262421] transition',
                state === 'idle' && 'border-[#262421]/10 bg-[#262421]/5 hover:border-[#81b64c]/50 hover:bg-[#262421]/10',
                state === 'correct' && 'border-[#81b64c] bg-[#81b64c]/15',
                state === 'off' && 'border-[#e6a82c]/60 bg-[#e6a82c]/10',
                revealed && 'animate-pulse border-[#81b64c] bg-[#81b64c]/10',
                answeredCorrect && !isChosen && 'opacity-45',
              )}
            >
              {state === 'correct' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4a6b28]" />
              ) : state === 'off' ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#e6a82c]" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-[#262421]/30" />
              )}
              <span>
                {o.text}
                {isChosen && <span className="mt-1 block text-xs font-normal text-[#262421]/60">{o.why}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {answeredCorrect ? (
        <p className="mt-3 text-sm font-semibold text-[#4a6b28]">Correct. {step.options[correctIdx]?.why}</p>
      ) : chosen != null && !step.options[chosen].correct ? (
        <div className="mt-3 rounded-xl border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-semibold text-[#262421]">
          Tempting, but not the idea here. {step.options[chosen].why} Take another look.
        </div>
      ) : null}
      {misses >= 2 && !answeredCorrect && (
        <p className="mt-2 text-sm text-[#262421]/50">The right answer is glowing now. Tap it, and keep the why in mind for the board.</p>
      )}
    </div>
  )
}

function ExerciseView({
  step,
  onPass,
  onResult,
  onBubble,
  onHintUsed,
  soundEnabled,
  showLegal,
  theme,
  onAskCoach,
}: {
  step: ExerciseStep
  onPass: () => void
  onResult: (firstTry: boolean) => void
  onBubble: (m: BubbleMsg | null) => void
  onHintUsed: () => void
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
  // survives resets: a step solved only after a miss never counts as first-try
  const blunderedRef = useRef(false)
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
    setGuideMsg(null)
    onHintUsed()
    const san = step.solution[movesSoFar.length]
    if (!san) return
    try {
      const probe = new Chess(gameRef.current.fen())
      const mv = probe.move(san)
      if (mv) flash([{ square: mv.from, color: 'gold' }, { square: mv.to, color: 'green' }])
    } catch {
      /* validator guarantees the line; ignore parse races */
    }
  }, [step.solution, movesSoFar.length, flash, onHintUsed])

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

  // live coach guidance flows up to the panel: success first, then the
  // guided-mistake nudge, then the hint, then the standing goal
  const bubbleTone: BubbleTone = status === 'done' ? 'praise' : guideMsg ? 'guide' : hintShown ? 'hint' : 'neutral'
  const bubbleText =
    status === 'done' ? step.success : guideMsg ?? (hintShown ? step.hint : step.goal)
  // a finished line that ends in mate earns the bigger chip
  const bubbleChip = status === 'done' && gameRef.current.isCheckmate() ? 'Checkmate!' : chipFor(bubbleTone)
  useLayoutEffect(() => {
    onBubble({ tone: bubbleTone, text: bubbleText, speak: bubbleText, chip: bubbleChip })
  }, [onBubble, bubbleTone, bubbleText, bubbleChip])

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
      blunderedRef.current = true
      onResult(false)
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
      onResult(!blunderedRef.current)
      onPass()
    }
    // if reply exists but it was the last move of the line
    if (reply && movesSoFar.length + 2 >= step.solution.length) {
      setTimeout(() => {
        setStatus('done')
        playSound('correct', soundEnabled)
        onResult(!blunderedRef.current)
        onPass()
      }, 1100)
    }
  }

  const userSideFromFen = useMemo(() => new Chess(step.fen).turn(), [step.fen])

  return (
    <div className="flex flex-col items-center">
      <BoardPlate label={status === 'solving' ? sideToPlayLabel(step.fen) : undefined}>
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
      </BoardPlate>

      <div className="mt-4 w-full max-w-[620px] text-center text-sm text-[#262421]/55">
        {status === 'done' ? (
          <span className="font-semibold text-[#4a6b28]">Line complete.</span>
        ) : movesSoFar.length > 0 ? (
          <>
            Line so far: <span className="font-mono font-bold text-[#262421]">{movesSoFar.join(' ')}</span>
          </>
        ) : (
          'Your move.'
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <ToolButton onClick={reset} disabled={status !== 'solving'} ariaLabel="Reset exercise">
          <RotateCcw className="h-4 w-4" /> Reset
        </ToolButton>
        <ToolButton onClick={showHint} disabled={hintShown || status !== 'solving'} ariaLabel="Show a hint">
          <Lightbulb className="h-4 w-4" /> Hint
        </ToolButton>
        <ToolButton onClick={onAskCoach} ariaLabel="Ask the coach">
          <MessageSquareText className="h-4 w-4" /> Coach
        </ToolButton>
      </div>

      {status === 'done' && step.explanation && (
        <p className="mt-3 max-w-[620px] text-center text-sm leading-relaxed text-[#262421]/60">{step.explanation}</p>
      )}
    </div>
  )
}

/* Guess the move: play through a real master game (or a labeled composed
   study) one guess at a time. Full credit for the master move or an equal
   alternative, half credit for the playable second best, and a miss shows
   the idea instead of scolding. Guided, never punishing. */
function GtmStepView({
  step,
  onPass,
  onResult,
  onBubble,
  soundEnabled,
  showLegal,
  theme,
}: {
  step: GtmStep
  onPass: () => void
  onResult: (firstTry: boolean) => void
  onBubble: (m: BubbleMsg | null) => void
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
  const [locked, setLocked] = useState(false)
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
      setLocked(true)
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
            setLocked(false)
            setIdx((i) => i + 1)
            setMisses(0)
          }, 650)
        } else {
          lockedRef.current = false
          setLocked(false)
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
      onResult(misses === 0)
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
      onResult(false)
      advanceAfter(cur)
      return
    }

    // a miss: guide first, show the move after the third try
    const n = misses + 1
    setMisses(n)
    onResult(false)
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
    setLocked(false)
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
        ? 'Solid instincts. The ideas you missed are exactly the ones worth stealing for your own games.'
        : 'Now you have seen the full idea once. Play it again, and see how much more you find.'

  const bubbleTone: BubbleTone = phase === 'done' ? 'praise' : feedback?.tone ?? 'neutral'
  const bubbleText =
    phase === 'done'
      ? `${summary} You scored ${score} out of ${total}.`
      : feedback?.text ??
        `Move ${idx + 1} of ${total}. ${guessSide === 'w' ? 'White' : 'Black'} to move. What did the master play?`
  useLayoutEffect(() => {
    onBubble({ tone: bubbleTone, text: bubbleText, speak: bubbleText, chip: chipFor(bubbleTone) })
  }, [onBubble, bubbleTone, bubbleText])

  return (
    <div className="flex flex-col items-center">
      <BoardPlate label={phase === 'guess' ? sideToPlayLabel(fen) : undefined}>
        <ChessBoard
          fen={fen}
          orientation={guessSide}
          onMove={onMove}
          movableSide={phase === 'guess' && !locked ? guessSide : undefined}
          interactive={phase === 'guess' && !locked}
          lastMove={lastMove}
          checkSquare={checkSquare}
          showLegal={showLegal && phase === 'guess' && !locked}
          flashes={flashes}
          theme={theme}
          shake={shake}
        />
      </BoardPlate>

      <div className="mt-3 flex w-full max-w-[620px] flex-wrap items-center justify-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-[#262421]/10 bg-[#262421]/5 px-3 py-1.5">
          {step.moves.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                'h-2 w-2 rounded-full',
                i >= results.length
                  ? i === idx && phase === 'guess'
                    ? 'bg-[#81b64c] ring-2 ring-[#81b64c]/30'
                    : 'bg-[#262421]/15'
                  : results[i] === 'full'
                    ? 'bg-[#81b64c]'
                    : results[i] === 'half'
                      ? 'bg-[#e6a82c]'
                      : 'bg-red-400/70',
              )}
            />
          ))}
          <span className="ml-1 font-mono text-xs font-bold text-[#262421]/80">
            {score} / {total}
          </span>
        </div>
        <ToolButton onClick={reset} ariaLabel="Restart the game">
          <RotateCcw className="h-4 w-4" /> {phase === 'done' ? 'Play it again' : 'Start over'}
        </ToolButton>
      </div>

      <div className="mt-2 w-full max-w-[620px] text-center text-sm text-[#262421]/55">
        {phase === 'guess' ? (
          <p>
            Move {idx + 1} of {total}. {guessSide === 'w' ? 'White' : 'Black'} to move. What did the master play?
          </p>
        ) : (
          <p className="font-semibold text-[#4a6b28]">Game complete.</p>
        )}
        {lineSoFar.length > 0 && <p className="mt-1 font-mono text-xs text-[#262421]/40">{lineSoFar.join(' ')}</p>}
      </div>
    </div>
  )
}

function PlayoutStepView({
  step,
  onPass,
  onResult,
  onBubble,
  soundEnabled,
  showLegal,
  theme,
}: {
  step: Extract<LessonStep, { type: 'playout' }>
  onPass: () => void
  onResult: (firstTry: boolean) => void
  onBubble: (m: BubbleMsg | null) => void
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
  const lostRef = useRef(false)

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
  const bal = materialBalance(game)

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
      // early material check: past this deficit the game is unrecoverable,
      // below it one blunder should still be survivable. Gentle bots hand
      // material back, so the cap scales with their strength.
      if (step.success !== 'draw') {
        const bal = materialBalance(g)
        const deficitCap = step.engineLevel >= 2 ? -5 : step.engineLevel === 1 ? -7 : -9
        if (bal <= deficitCap) return 'lost'
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
        onResult(!lostRef.current)
        onPass()
      } else {
        lostRef.current = true
        onResult(false)
        playSound('wrong', soundEnabled)
      }
    }
  }, [fen, status, judge, onPass, onResult, soundEnabled])

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

  const failText = step.failText ?? (status === 'draw' ? 'A draw is not the goal here.' : 'That did not work. Reset and try a different plan.')
  const bubbleTone: BubbleTone = status === 'won' ? 'praise' : status === 'playing' ? 'neutral' : 'guide'
  const bubbleText = status === 'won' ? step.successText : status === 'playing' ? step.goal : failText
  useLayoutEffect(() => {
    onBubble({ tone: bubbleTone, text: bubbleText, speak: bubbleText, chip: chipFor(bubbleTone) })
  }, [onBubble, bubbleTone, bubbleText])

  return (
    <div className="relative flex flex-col items-center">
      {status === 'won' && <Confetti />}
      <BoardPlate label={status === 'playing' ? sideToPlayLabel(fen) : undefined}>
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
      </BoardPlate>

      <div className="mt-3 text-center text-sm text-[#262421]/55">
        <p>{thinking ? 'Opponent thinking…' : `Move ${Math.floor(moves.length / 2) + 1} of ${step.maxMoves ?? 12}`}</p>
        {step.success === 'material' && (
          <p className="mt-1 font-semibold text-[#262421]/70">
            Material: {bal > 0 ? `you +${bal}` : bal < 0 ? `them +${-bal}` : 'even'}
          </p>
        )}
      </div>

      <div className="mt-3">
        <ToolButton onClick={reset} disabled={status === 'playing' && moves.length === 0} ariaLabel="Reset position">
          <RotateCcw className="h-4 w-4" /> Reset
        </ToolButton>
      </div>
    </div>
  )
}
