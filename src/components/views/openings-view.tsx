'use client'

/**
 * Opening Training - the repertoire drill engine, modeled on the
 * chessreps.com mechanics documented in docs/chessreps-re-report.md.
 *
 * Training loop: the board auto-plays the shared trunk and the opponent's
 * branch move, then the student plays THEIR side of the line. A wrong move
 * snaps back with a shake; after enough slips the coach flashes the square
 * and finally plays the move for you, so nobody ever gets stuck. Completing
 * a line grades it (good / hard / again from mistakes + hints), nudges a
 * 0..10 confidence meter and schedules the next review - and the line picker
 * always brings the shakiest, most overdue line back first.
 *
 * Modes: Learn (hints, pick any line), Practice (overdue first, no hints),
 * Drill (one mistake resets the streak and rewinds the line), Time (60s
 * clock, +bonus per finished line).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ArrowRight, BookMarked, Brain, Check, ChevronLeft, Dumbbell, GraduationCap, Hourglass,
  Lightbulb, Loader2, Lock, Play, RotateCcw, SkipForward, Star, Swords, Target, Timer, Trophy, Zap,
} from 'lucide-react'
import {
  REPERTOIRE_COURSES, applyResult, confidenceDot, gradeFor, masteryLabel,
  masteryPercent, newMastery, pickNextLine, tierProgressList, tierRanges, unlockedLineCount,
  type LineMastery, type MasteryMap, type RepertoireCourse, type RepertoireLine,
} from '@/lib/chess/opening-reps'
import {
  allTimeBest, loadRecords, milestoneFor, nextMilestone, recordKindLabel,
  recordScore,
  type CourseRecords, type PeriodKind, type RecordKind,
} from '@/lib/chess/opening-records'
import { forgetLineProgress, pullProgress, pushProgress } from '@/lib/chess/opening-sync'
import { OpeningArena } from '@/components/views/opening-arena'
import { OpeningPuzzles } from '@/components/views/opening-puzzles'

type Mode = 'learn' | 'practice' | 'drill' | 'time' | 'arena' | 'puzzles' | 'dojo'
type Phase = 'idle' | 'autopilot' | 'awaiting' | 'complete' | 'sessionOver'

interface SessionStats {
  lines: number
  studentMoves: number
  mistakes: number
  hints: number
  streak: number
  bestStreak: number
  seconds: number
}

const EMPTY_STATS: SessionStats = { lines: 0, studentMoves: 0, mistakes: 0, hints: 0, streak: 0, bestStreak: 0, seconds: 0 }

/** 20-string praise pool (chessreps feedback stack). */
const PRAISE = [
  'Exactly right.', 'Perfect.', 'That is the move.', 'Nailed it.', 'Book move.',
  'Just like that.', 'Textbook.', 'Sharp.', 'You know this one.', 'Flawless.',
  'Automatic.', 'Clean.', 'Correct.', 'Well drilled.', 'Repertoire ready.',
  'Solid.', 'Nice.', 'Confident.', 'Yes.', 'The move.',
]

const MODES: { id: Mode; label: string; icon: typeof BookMarked; blurb: string }[] = [
  { id: 'learn', label: 'Learn', icon: BookMarked, blurb: 'Guided first pass. The coach flashes the square after a slip, and shows the full idea.' },
  { id: 'practice', label: 'Practice', icon: Brain, blurb: 'Your shakiest, most overdue lines come back first. No hints.' },
  { id: 'drill', label: 'Drill', icon: Zap, blurb: 'Streak mode: one mistake resets the streak and rewinds the line.' },
  { id: 'time', label: 'Time', icon: Timer, blurb: '60 seconds on the clock. Every finished line buys you bonus time.' },
  { id: 'arena', label: 'Arena', icon: Swords, blurb: 'Ranked games vs a rated opponent playing real club replies. Elo moves on wins and losses.' },
  { id: 'puzzles', label: 'Puzzles', icon: Target, blurb: 'Real-game tactics from this exact opening, pulled at your puzzle rating.' },
  { id: 'dojo', label: 'Dojo', icon: Dumbbell, blurb: 'The whole repertoire mixed. You are dropped into a random position from any course and must find your way out.' },
]

const MASTERY_KEY = 'chessx.openings.mastery.v1'
const MODE_KEY = 'chessx.openings.mode.v1'
const DOJO_BEST_KEY = 'chessx.openings.dojoBest.v1'

function loadDojoBest(): number {
  if (typeof window === 'undefined') return 0
  try {
    return Math.max(0, Math.round(Number(window.localStorage.getItem(DOJO_BEST_KEY) ?? '0')) || 0)
  } catch {
    return 0
  }
}

function saveDojoBest(streak: number) {
  try {
    const best = Math.max(loadDojoBest(), streak)
    window.localStorage.setItem(DOJO_BEST_KEY, String(best))
  } catch {
    /* private mode */
  }
}

/**
 * One Dojo rep: a course, one of its lines, and the even index into the
 * line where the student takes over (even = a student decision point,
 * because lines alternate strictly student-first after the trunk).
 */
interface DojoRep {
  course: RepertoireCourse
  line: RepertoireLine
  entryIdx: number
}

/**
 * Pick the next Dojo rep the way chessreps does: overdue and shaky lines
 * from the WHOLE repertoire dominate; untrained lines fill in; the take-over
 * point is a random student decision in the line, not always the first.
 */
function pickDojoRep(mastery: MasteryMap, exclude?: DojoRep | null): DojoRep {
  const now = Date.now()
  const all: { course: RepertoireCourse; line: RepertoireLine; overdue: number; started: boolean }[] = []
  for (const course of REPERTOIRE_COURSES) {
    for (const line of course.lines) {
      if (exclude && exclude.course.id === course.id && exclude.line.id === line.id) continue
      const m = mastery[course.id]?.[line.id]
      all.push({
        course,
        line,
        started: !!m && m.reps > 0,
        overdue: m && m.reps > 0 ? now - m.due : Number.MAX_SAFE_INTEGER,
      })
    }
  }
  const shaky = all.filter((x) => x.started && (mastery[x.course.id]?.[x.line.id]?.confidence ?? 10) < 10)
  const overdue = shaky.filter((x) => x.overdue > 0)
  const pool = overdue.length > 0 ? overdue : shaky.length > 0 ? shaky : all
  const pick = pool[Math.floor(Math.random() * pool.length)]
  // Student decision points: the mover of line.moves[i] is WHITE when
  // (trunk.length + i) is even (white always played the 1st trunk ply). The
  // student takes over exactly on indices where the mover matches their side.
  // The old even-index-only assumption landed the student on the OPPONENT's
  // turn whenever trunk.length was odd (London 3, Italian 5, Sicilian 9) —
  // the board then sat at "Your move" with every white piece unmovable.
  const decisions: number[] = []
  for (let i = 0; i < pick.line.moves.length; i++) {
    const moverIsWhite = (pick.course.trunk.length + i) % 2 === 0
    const moverIsStudent = pick.course.side === 'w' ? moverIsWhite : !moverIsWhite
    if (moverIsStudent) decisions.push(i)
  }
  const entryIdx = decisions[Math.floor(Math.random() * decisions.length)] ?? 0
  return { course: pick.course, line: pick.line, entryIdx }
}

function loadMastery(): MasteryMap {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(MASTERY_KEY) ?? '{}') as MasteryMap
  } catch {
    return {}
  }
}

function saveMastery(m: MasteryMap) {
  try {
    window.localStorage.setItem(MASTERY_KEY, JSON.stringify(m))
  } catch {
    /* storage full or blocked: training still works in-session */
  }
}

function norm(san: string): string {
  return san.replace(/[+#!?]/g, '').trim()
}

function randomPraise(): string {
  return PRAISE[Math.floor(Math.random() * PRAISE.length)]
}

/** Opponent auto-play speed mirrors chessreps: fast in Drill/Time/Dojo, calm otherwise. */
function autopilotDelay(mode: Mode): number {
  return mode === 'drill' || mode === 'time' || mode === 'dojo' ? 150 : 500
}

export function OpeningsView() {
  const { profile } = useApp()
  const soundOn = profile?.soundEnabled ?? true
  const boardTheme = profile?.theme ?? 'green'
  const showCoords = profile?.showCoords ?? true

  const [mastery, setMastery] = useState<MasteryMap>({})
  const [mode, setMode] = useState<Mode>('learn')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')

  const [fen, setFen] = useState(new Chess().fen())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [shake, setShake] = useState(false)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [status, setStatus] = useState('')
  const [praise, setPraise] = useState<string | null>(null)
  const [showIdea, setShowIdea] = useState(false)
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS)
  const [lineProgress, setLineProgress] = useState({ done: 0, total: 0 })
  const [dojoBest, setDojoBest] = useState(0)
  const dojoRepRef = useRef<DojoRep | null>(null)
  const [dojoSource, setDojoSource] = useState<string>('')

  const gameRef = useRef(new Chess())
  const courseRef = useRef<RepertoireCourse | null>(null)
  const lineRef = useRef<RepertoireLine | null>(null)
  const idxRef = useRef(0) // index into line.moves
  const mistakesRef = useRef(0)
  const hintsRef = useRef(0)
  const lineCleanRef = useRef(true) // no mistakes AND no hints this line
  const streakRef = useRef(0) // mirrors the live streak for post-update reads
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clockRef = useRef(60)
  const [clock, setClock] = useState(60)
  const clockTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [timeScore, setTimeScore] = useState(0)
  // Records economy (chessreps §7 item 8): per-course daily/weekly/monthly/
  // all-time maxes. `records` mirrors the current course's card; `newRecords`
  // accumulates the buckets this session beat, for the honest celebration.
  const [records, setRecords] = useState<CourseRecords | null>(null)
  const [newRecords, setNewRecords] = useState<PeriodKind[]>([])

  useEffect(() => {
    setMastery(loadMastery())
    // Seed the records store from the legacy single-number dojo key exactly
    // once: old installs keep their streak, new installs start fresh.
    const legacy = loadDojoBest()
    if (legacy > 0 && allTimeBest('dojo', 'dojo') === 0) {
      recordScore('dojo', 'dojo', legacy)
    }
    setDojoBest(Math.max(legacy, allTimeBest('dojo', 'dojo')))
    try {
      const savedMode = window.localStorage.getItem(MODE_KEY) as Mode | null
      if (savedMode && MODES.some((m) => m.id === savedMode)) setMode(savedMode)
    } catch { /* private mode */ }
  }, [])

  const course = useMemo(() => REPERTOIRE_COURSES.find((c) => c.id === courseId) ?? null, [courseId])

  // Keep the record maxes fresh on every relevant change. recordScore is a
  // max-merge, so redundant writes are harmless; `beaten` accumulates what
  // this session improved, per period, for the session-over celebration.
  useEffect(() => {
    const cid = mode === 'dojo' ? 'dojo' : course?.id
    if (!cid) return
    if (mode === 'time') {
      if (timeScore > 0) {
        const { beaten, records: card } = recordScore('time', cid, timeScore)
        setRecords(card)
        if (beaten.length > 0) setNewRecords((p) => Array.from(new Set([...p, ...beaten])))
      }
    } else if (stats.bestStreak > 0) {
      const kind: RecordKind = mode === 'dojo' ? 'dojo' : 'drill'
      const { beaten, records: card } = recordScore(kind, cid, stats.bestStreak)
      setRecords(card)
      if (beaten.length > 0) setNewRecords((p) => Array.from(new Set([...p, ...beaten])))
      if (mode === 'dojo') setDojoBest(card.dojo.allTime?.value ?? stats.bestStreak)
    }
  }, [mode, course?.id, stats.bestStreak, timeScore])

  // ---- Progress sync (chessreps item 11): pull the server mirror on mount,
  // debounced push on every local change. Local-first: the view never blocks
  // or waits on the network; signed-out users keep pure-local behavior.
  const syncQueueRef = useRef<Map<string, { courseId: string; lineId: string }>>(new Map())
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const merged = await pullProgress(loadMastery())
      if (cancelled) return
      saveMastery(merged)
      setMastery(merged)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const flushSyncQueue = useCallback(() => {
    syncTimerRef.current = null
    const keys = [...syncQueueRef.current.values()]
    syncQueueRef.current.clear()
    if (keys.length === 0) return
    void (async () => {
      const merged = await pushProgress(loadMastery(), keys)
      saveMastery(merged)
      setMastery(merged)
    })()
  }, [])

  const queueSync = useCallback((courseId2: string, lineId: string) => {
    syncQueueRef.current.set(`${courseId2}\u0000${lineId}`, { courseId: courseId2, lineId })
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(flushSyncQueue, 1_500)
  }, [flushSyncQueue])

  const applyMastery = useCallback((courseId2: string, lineId: string, mistakes: number, hints: number, streak: number) => {
    setMastery((prev) => {
      const courseMap = { ...(prev[courseId2] ?? {}) }
      const grade = gradeFor(mistakes, hints)
      courseMap[lineId] = applyResult(courseMap[lineId] ?? newMastery(), grade, streak)
      const next = { ...prev, [courseId2]: courseMap }
      saveMastery(next)
      queueSync(courseId2, lineId)
      // Tier celebrations (chessreps §7 item 7) live HERE — this updater is
      // the only place with the true pre-update state (reading localStorage
      // from finishLine races React's commit and never sees the change).
      // The deferred setPraise runs after finishLine's own praise, so a tier
      // moment outranks the random pool.
      try {
        const course = REPERTOIRE_COURSES.find((c) => c.id === courseId2)
        const ranges = course ? tierRanges(course) : []
        if (course && ranges.length > 1) {
          const ub = unlockedLineCount(course, prev[courseId2])
          const ua = unlockedLineCount(course, courseMap)
          if (ua > ub) {
            const finishedTier = ranges.find((r) => r.end === ub)?.name ?? 'Essentials'
            const nextTier = ranges.find((r) => r.start === ub)?.name ?? 'the next tier'
            setTimeout(() => setPraise(`${finishedTier} learned — ${nextTier} unlocked!`), 0)
          } else {
            const beforeP = tierProgressList(course, prev[courseId2])
            const afterP = tierProgressList(course, courseMap)
            const newly = afterP.find((t, i) => t.mastered && !beforeP[i]?.mastered)
            if (newly) setTimeout(() => setPraise(`${newly.name} perfected — every line at 10/10!`), 0)
          }
        }
      } catch { /* celebrations must never break the drill loop */ }
      return next
    })
  }, [queueSync])

  /** Forget-line (chessreps "unlearn this line"): clears locally and on the
   *  server mirror. Confirmation happens inline via a second click. */
  const forgetLine = useCallback((courseId2: string, lineId: string) => {
    setMastery((prev) => {
      const courseMap = { ...(prev[courseId2] ?? {}) }
      delete courseMap[lineId]
      const next = { ...prev, [courseId2]: courseMap }
      saveMastery(next)
      return next
    })
    void forgetLineProgress(courseId2, lineId)
  }, [])

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (clockTickRef.current) clearInterval(clockTickRef.current)
    timerRef.current = null
    clockTickRef.current = null
  }, [])

  const stopClock = useCallback(() => {
    if (clockTickRef.current) clearInterval(clockTickRef.current)
    clockTickRef.current = null
  }, [])

  const endSession = useCallback((reason: string) => {
    clearTimers()
    stopClock()
    if (mode === 'dojo') {
      setStats((s) => {
        // Legacy single-number key stays in sync for downgrade safety; the
        // per-period records store is written by the records effect.
        if (s.bestStreak > 0) saveDojoBest(s.bestStreak)
        setDojoBest(loadDojoBest())
        return { ...s, seconds: Math.round((Date.now() - (startRef.current || Date.now())) / 1000) }
      })
    } else {
      setStats((s) => ({ ...s, seconds: mode === 'time' ? 60 : Math.round((Date.now() - (startRef.current || Date.now())) / 1000) }))
    }
    setStatus(reason)
    setPhase('sessionOver')
    playSound(stats.lines > 0 ? 'win' : 'click', soundOn)
  }, [clearTimers, mode, soundOn, stats.lines, stopClock])

  const startRef = useRef<number>(0)

  /** Play the next SAN of the line (opponent replies and coach rescues). */
  const playSeqMove = useCallback((course2: RepertoireCourse, line: RepertoireLine, idx: number) => {
    const g = gameRef.current
    const san = line.moves[idx]
    try {
      const mv = g.move(san)
      if (!mv) throw new Error('bad san')
      setFen(g.fen())
      setLastMove({ from: mv.from, to: mv.to })
    } catch {
      // A corrupted line must never freeze the drill: finish the line gracefully.
      finishLine(course2, line, true)
      return
    }
    idxRef.current = idx + 1
    if (idxRef.current >= line.moves.length) {
      finishLine(course2, line, false)
      return
    }
    // Decide who moves next.
    const probe = new Chess(g.fen())
    if (probe.turn() === course2.side) {
      setPhase('awaiting')
      setStatus(`Your move. (${idxRef.current + 1} of ${line.moves.length})`)
    } else {
      setPhase('autopilot')
      setStatus('')
      timerRef.current = setTimeout(() => playSeqMove(course2, line, idxRef.current), autopilotDelay(mode))
    }
  }, [mode])

  /** Grade + celebrate + schedule the next line. */
  const finishLine = useCallback((course2: RepertoireCourse, line: RepertoireLine, corrupted: boolean) => {
    const mistakes = mistakesRef.current
    const hints = hintsRef.current
    setStats((s) => {
      const streak = lineCleanRef.current ? s.streak + 1 : 0
      const best = Math.max(s.bestStreak, streak)
      if (mode === 'dojo' && best > 0) saveDojoBest(best)
      const next = {
        ...s,
        lines: s.lines + 1,
        studentMoves: s.studentMoves + line.moves.length,
        streak,
        bestStreak: best,
      }
      applyMastery(course2.id, line.id, mistakes, hints, streak)
      if (mode === 'time') {
        clockRef.current += Math.floor(line.moves.length / 2)
        setClock(clockRef.current)
        setTimeScore((t) => t + Math.ceil(line.moves.length / 2) * (1 + Math.floor(streak / 3)))
      }
      streakRef.current = streak
      return next
    })
    setShowIdea(true)
    setStatus(corrupted ? 'Line finished.' : 'Line complete.')
    // Streak milestones (chessreps §7 item 8): a named tier exactly when it is
    // crossed replaces the random praise; otherwise keep the rotating praise.
    // Depth-tier celebrations fire from applyMastery (they need the true
    // pre-update mastery state) and override this when they happen.
    const ms = milestoneFor(streakRef.current)
    setPraise(
      streakRef.current > 0 && ms && ms.at === streakRef.current
        ? `${ms.label} — ${streakRef.current} in a row!`
        : randomPraise(),
    )
    playSound('win', soundOn)
    setPhase('complete')
  }, [applyMastery, mode, soundOn])

  /** Begin drilling one line: reset the board, auto-play trunk + branch. */
  const drillLine = useCallback((course2: RepertoireCourse, line: RepertoireLine, entryIdx = 0) => {
    clearTimers()
    courseRef.current = course2
    lineRef.current = line
    idxRef.current = 0
    mistakesRef.current = 0
    hintsRef.current = 0
    lineCleanRef.current = true
    gameRef.current = new Chess()
    setFen(gameRef.current.fen())
    setLastMove(null)
    setFlashes([])
    setShake(false)
    setShowIdea(false)
    // Praise is deliberately NOT cleared here: the completion praise (random,
    // streak milestone, or depth-tier celebration) renders in the awaiting
    // phase — i.e. while the student plays the NEXT line. A wrong move or
    // leaving the course dismisses it (those sites clear it themselves).
    setSelectedLineId(line.id)
    // Count the student's moves in this line for the progress readout:
    // replay the full sequence and count student-side moves after the trunk.
    const probe2 = new Chess()
    let studentTotal = 0
    const seq = [...course2.trunk, ...line.moves]
    seq.forEach((san, i) => {
      try {
        const mv = probe2.move(san)
        if (mv && mv.color === course2.side && i >= course2.trunk.length) studentTotal++
      } catch { /* counted what plays */ }
    })
    setLineProgress({ done: 0, total: Math.max(1, studentTotal) })

    // Auto-play trunk instantly (they are shared, never drilled)...
    const g = gameRef.current
    for (const san of course2.trunk) {
      try { g.move(san) } catch { break }
    }
    if (entryIdx > 0) {
      // Dojo arrival: fast-forward the opening of the line so the student
      // takes over from an arbitrary position of their repertoire.
      for (let i = 0; i < entryIdx; i++) {
        try { g.move(line.moves[i]) } catch { break }
      }
      idxRef.current = entryIdx
      // Safety net for hand-edited or imported repertoire data: if the landed
      // position is somehow the OPPONENT's move (bad entry index), play that
      // one move and hand over — a "Your move" board the student cannot move
      // on is the one failure mode this view must never show.
      if (g.turn() !== course2.side && idxRef.current < line.moves.length) {
        try {
          const mv = g.move(line.moves[idxRef.current])
          if (mv) idxRef.current++
        } catch { /* leave as-is; the picker guarantees parity normally */ }
      }
      let remaining = 0
      for (let i = idxRef.current; i < line.moves.length; i += 2) remaining++
      setLineProgress({ done: 0, total: Math.max(1, remaining) })
      setFen(g.fen())
      setPhase('awaiting')
      setStatus(`Your move, from a random ${course2.name} position.`)
      return
    }
    setFen(g.fen())
    setPhase('autopilot')
    setStatus('')
    // ...then walk the line with the calm/fast autopilot rhythm.
    timerRef.current = setTimeout(() => playSeqMove(course2, line, 0), autopilotDelay(mode))
  }, [clearTimers, mode, playSeqMove])

  /** Pick the next line (picker depends on mode) and drill it. */
  const nextLine = useCallback((course2: RepertoireCourse, excludeId?: string) => {
    const map = mastery[course2.id]
    const line = pickNextLine(course2, map, excludeId)
    drillLine(course2, line)
  }, [drillLine, mastery])

  /** Enter the Dojo: one mixed session over the ENTIRE repertoire. */
  const startDojo = useCallback(() => {
    clearTimers()
    stopClock()
    setStats(EMPTY_STATS)
    setTimeScore(0)
    setNewRecords([])
    setRecords(loadRecords('dojo'))
    startRef.current = Date.now()
    const rep = pickDojoRep(mastery)
    dojoRepRef.current = rep
    setDojoSource(rep.course.name)
    setCourseId(rep.course.id)
    drillLine(rep.course, rep.line, rep.entryIdx)
  }, [clearTimers, drillLine, mastery, stopClock])

  /** Next Dojo rep after a completed line (auto-advance keeps the rhythm). */
  const nextDojoRep = useCallback(() => {
    const rep = pickDojoRep(mastery, dojoRepRef.current)
    dojoRepRef.current = rep
    setDojoSource(rep.course.name)
    setCourseId(rep.course.id)
    drillLine(rep.course, rep.line, rep.entryIdx)
  }, [drillLine, mastery])

  const startCourse = useCallback((c: RepertoireCourse) => {
    setStats(EMPTY_STATS)
    setTimeScore(0)
    setNewRecords([])
    setRecords(mode === 'dojo' ? loadRecords('dojo') : loadRecords(c.id))
    startRef.current = Date.now()
    if (mode === 'dojo') {
      // Dojo ignores the clicked course: it always trains the whole repertoire.
      startDojo()
      return
    }
    setCourseId(c.id)
    // Arena and Puzzles run their own engines; the shell only selects the course.
    if (mode === 'arena' || mode === 'puzzles') {
      clearTimers()
      stopClock()
      setPhase('idle')
      return
    }
    if (mode === 'time') {
      clockRef.current = 60
      setClock(60)
      drillLine(c, pickNextLine(c, mastery[c.id]))
      // The clock only runs while the student is actually solving.
      stopClock()
      clockTickRef.current = setInterval(() => {
        clockRef.current -= 0.2
        setClock(clockRef.current)
        if (clockRef.current <= 0) {
          stopClock()
          endSession('Time is up.')
        }
      }, 200)
    } else if (mode === 'practice') {
      drillLine(c, pickNextLine(c, mastery[c.id]))
    } else {
      // Learn: start from the least-confident line for a guided pass.
      const untrained = c.lines.find((l) => (mastery[c.id]?.[l.id]?.reps ?? 0) === 0)
      drillLine(c, untrained ?? pickNextLine(c, mastery[c.id]))
    }
  }, [clearTimers, drillLine, endSession, mastery, mode, startDojo, stopClock])

  // Pause the clock while the completion card shows; resume for the next line.
  useEffect(() => {
    if (mode !== 'time' || !clockTickRef.current) return
    if (phase === 'complete') {
      stopClock()
      timerRef.current = setTimeout(() => {
        if (courseRef.current) nextLine(courseRef.current, lineRef.current?.id)
        // Resume the clock for the next line unless time already ran out
        // (endSession stopped it and the session is over).
        if (!clockTickRef.current && clockRef.current > 0) {
          clockTickRef.current = setInterval(() => {
            clockRef.current -= 0.2
            setClock(clockRef.current)
            if (clockRef.current <= 0) {
              stopClock()
              endSession('Time is up.')
            }
          }, 200)
        }
      }, 2200)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [phase, mode, nextLine, stopClock, endSession])

  // Dojo rhythm: the next random rep arrives on its own, like chessreps'
  // 750-1000ms auto-advance; the student can still click "Next rep" sooner.
  useEffect(() => {
    if (mode !== 'dojo' || phase !== 'complete') return
    const t = setTimeout(() => nextDojoRep(), 1800)
    return () => clearTimeout(t)
  }, [phase, mode, nextDojoRep])

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)

  /** Validate BEFORE committing: a wrong move never lands on the board. */
  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const course2 = courseRef.current
      const line = lineRef.current
      if (!course2 || !line || phase !== 'awaiting') return
      const expected = norm(line.moves[idxRef.current] ?? '')
      const probe = new Chess(gameRef.current.fen())
      let played
      try {
        played = probe.move({ from, to, promotion: promotion || 'q' })
      } catch {
        return // illegal drag: the board ignores it
      }
      if (!played) return
      const playedSan = norm(played.san)
      if (playedSan !== expected) {
        mistakesRef.current++
        lineCleanRef.current = false
        setPraise(null)
        setStats((s) => ({ ...s, mistakes: s.mistakes + 1 }))
        if (mode === 'drill') setStats((s) => ({ ...s, streak: 0 }))
        setShake(true)
        window.setTimeout(() => setShake(false), 500)
        playSound('wrong', soundOn)
        const attempt = mistakesRef.current
        if (mode === 'drill') {
          // Streak mode: rewind the whole line after a beat.
          setStatus('Streak reset. Watch the line, then play it again.')
          setPhase('autopilot')
          timerRef.current = setTimeout(() => drillLine(course2, line), 900)
        } else if (mode === 'dojo') {
          // Dojo: no rewind theater; the miss costs the streak, snap-back is
          // the teacher. Rescue still arrives at the third slip.
          setStatus(attempt >= 3 ? `It is ${expected}.` : 'Not the rep. The streak is gone. Try again.')
        } else if (attempt >= 3) {
          // Rescue: play the move for the student so nobody gets stuck.
          setStatus(`It is ${expected}. Watch it once, then continue.`)
          setPhase('autopilot')
          timerRef.current = setTimeout(() => playSeqMove(course2, line, idxRef.current), 700)
        } else {
          // After a second slip, flash the departing square of the right move.
          let fromHint = ''
          try {
            const g2 = new Chess(gameRef.current.fen())
            const mv = g2.move(expected)
            if (mv) {
              fromHint = mv.from
              setFlashes([{ square: mv.from, color: 'gold' }])
              window.setTimeout(() => setFlashes([]), 1500)
            }
          } catch { /* display only */ }
          setStatus(fromHint ? `Not the move. The piece starts on ${fromHint}. Try again.` : 'Not the move. Try again.')
        }
        return
      }
      // Correct.
      gameRef.current.move({ from, to, promotion: promotion || 'q' })
      setFen(gameRef.current.fen())
      setLastMove({ from: played.from, to: played.to })
      setFlashes([])
      setLineProgress((p) => ({ ...p, done: p.done + 1 }))
      playSound('correct', soundOn)
      setPraise(randomPraise())
      idxRef.current++
      if (idxRef.current >= line.moves.length) {
        finishLine(course2, line, false)
        return
      }
      // Opponent replies on autopilot.
      const probe2 = new Chess(gameRef.current.fen())
      if (probe2.turn() !== course2.side) {
        setPhase('autopilot')
        setStatus('')
        timerRef.current = setTimeout(() => playSeqMove(course2, line, idxRef.current), autopilotDelay(mode))
      } else {
        setStatus(`Your move. (${idxRef.current + 1} of ${line.moves.length})`)
      }
    },
    [phase, mode, soundOn, drillLine, playSeqMove, finishLine],
  )

  const showHint = useCallback(() => {
    const line = lineRef.current
    if (!line || phase !== 'awaiting') return
    hintsRef.current++
    lineCleanRef.current = false
    setStats((s) => ({ ...s, hints: s.hints + 1 }))
    void engine.init()
    const expected = line.moves[idxRef.current]
    try {
      const g2 = new Chess(gameRef.current.fen())
      const mv = g2.move(expected)
      if (mv) {
        setFlashes([{ square: mv.from, color: 'green' }])
        setStatus(`Start with the piece on ${mv.from}.`)
        window.setTimeout(() => setFlashes([]), 2000)
      }
    } catch { /* display only */ }
  }, [phase])

  const backToCourses = useCallback(() => {
    clearTimers()
    stopClock()
    setPhase('idle')
    setCourseId(null)
    setStatus('')
    setShowIdea(false)
    setPraise(null)
  }, [clearTimers, stopClock])

  useEffect(() => () => clearTimers(), [clearTimers])

  // Keyboard: Escape returns to the course/line overview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'idle') backToCourses()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, backToCourses])

  const overallProgress = useMemo(() => {
    const trained = Object.values(mastery).reduce((acc, m) => acc + Object.keys(m).length, 0)
    const total = REPERTOIRE_COURSES.reduce((acc, c) => acc + c.lines.length, 0)
    return { trained, total }
  }, [mastery])

  /* ------------------------------ arena / puzzles delegation ------------------------------ */
  if (course && mode === 'arena') {
    return <OpeningArena course={course} onExit={backToCourses} />
  }
  if (course && mode === 'puzzles') {
    return <OpeningPuzzles course={course} onExit={backToCourses} />
  }

  /* ------------------------------ dojo picker hero ------------------------------ */
  if (mode === 'dojo' && (phase === 'idle' || !course)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-4 lg:pb-8">
        <header className="mb-4">
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
            <Target className="h-6 w-6 text-primary-light" aria-hidden /> Opening Training
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drill your repertoire until the moves play themselves. Wrong moves snap back, the shakiest line always returns first.
          </p>
        </header>
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="tablist" aria-label="Training mode">
          {MODES.map((m) => {
            const Icon = m.icon
            const active = mode === m.id
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setMode(m.id)
                  try { window.localStorage.setItem(MODE_KEY, m.id) } catch { /* private mode */ }
                }}
                className={cn(
                  'rounded-xl border p-3 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-accent/40',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  {m.label}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.blurb}</p>
              </button>
            )
          })}
        </div>

        <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card p-6 text-center shadow-sm">
          <Dumbbell className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-extrabold">The Dojo is the whole repertoire at once</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-snug text-muted-foreground">
            Every rep drops you into a random position from any course you train. No course pick, no warm-up: find your move, finish the line, next rep. Streak survives only clean lines.
          </p>
          {dojoBest > 0 && (
            <p className="mt-3 text-xs font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Dojo best streak: {dojoBest}
            </p>
          )}
          <Button size="lg" className="mt-4" onClick={startDojo}>
            <Dumbbell className="mr-2 h-4 w-4" /> Enter the Dojo
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------ course picker ------------------------------ */
  if (phase === 'idle' || !course) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-4 lg:pb-8">
        <header className="mb-4">
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
            <Target className="h-6 w-6 text-primary-light" aria-hidden /> Opening Training
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drill your repertoire until the moves play themselves. Wrong moves snap back, the shakiest line always returns first.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/80">
            {overallProgress.trained} of {overallProgress.total} lines started across {REPERTOIRE_COURSES.length} repertoires
          </p>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="Training mode">
          {MODES.map((m) => {
            const Icon = m.icon
            const active = mode === m.id
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setMode(m.id)
                  try { window.localStorage.setItem(MODE_KEY, m.id) } catch { /* private mode */ }
                }}
                className={cn(
                  'rounded-xl border p-3 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 shadow-sm'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-accent/40',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  {m.label}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.blurb}</p>
              </button>
            )
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {REPERTOIRE_COURSES.map((c) => {
            const map = mastery[c.id]
            const pct = masteryPercent(c.lines, map)
            const started = c.lines.filter((l) => (map?.[l.id]?.reps ?? 0) > 0).length
            const dueNow = c.lines.filter((l) => {
              const m = map?.[l.id]
              return m && m.reps > 0 && m.due <= Date.now() && m.confidence < 10
            }).length
            return (
              <button
                key={c.id}
                onClick={() => startCourse(c)}
                className="group rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-bold">
                      {c.name}
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase', c.side === 'w' ? 'bg-stone-200 text-stone-800' : 'bg-stone-800 text-stone-100')}>
                        {c.side === 'w' ? 'White' : 'Black'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{c.blurb}</p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-accent px-2 py-1 text-xs font-extrabold">{pct}%</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{masteryLabel(pct)} · {started}/{c.lines.length} lines</span>
                  {dueNow > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-600 dark:text-amber-400">
                      {dueNow} due
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  /* ------------------------------ session over ------------------------------ */
  if (phase === 'sessionOver') {
    const acc = stats.studentMoves + stats.mistakes > 0
      ? Math.round((stats.studentMoves / (stats.studentMoves + stats.mistakes)) * 100)
      : 0
    const kind: RecordKind = mode === 'time' ? 'time' : mode === 'dojo' ? 'dojo' : 'drill'
    const card = records ?? loadRecords(mode === 'dojo' ? 'dojo' : course.id)
    const periodNames: Record<PeriodKind, string> = {
      daily: 'daily', weekly: 'weekly', monthly: 'monthly', allTime: 'all-time',
    }
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-3 py-10 text-center">
        <Trophy className="h-12 w-12 text-primary-light" aria-hidden />
        <h2 className="mt-3 font-display text-2xl font-extrabold">Session complete</h2>
        <p className="mt-1 text-sm text-muted-foreground">{mode === 'dojo' ? 'Dojo · whole repertoire' : `${course.name} · ${mode === 'time' ? 'Time attack' : MODES.find((m) => m.id === mode)?.label}`}</p>
        <div className="mt-6 grid w-full grid-cols-2 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="font-display text-3xl font-extrabold">{mode === 'time' ? timeScore : stats.lines}</div>
            <div className="text-xs text-muted-foreground">{mode === 'time' ? 'score' : 'lines drilled'}</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="font-display text-3xl font-extrabold">{acc}%</div>
            <div className="text-xs text-muted-foreground">accuracy</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="font-display text-3xl font-extrabold">{stats.bestStreak}</div>
            <div className="text-xs text-muted-foreground">best streak</div>
            {(() => {
              const ms = milestoneFor(stats.bestStreak)
              return ms ? (
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">{ms.label}</div>
              ) : null
            })()}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="font-display text-3xl font-extrabold">{stats.mistakes}</div>
            <div className="text-xs text-muted-foreground">mistakes</div>
          </div>
        </div>
        {/* Records table (chessreps §7 item 8) with this session's honest
            new-record chips — a chip only appears for a bucket actually beaten. */}
        <div className="mt-4 w-full rounded-xl border bg-card p-4 text-left">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Records — {recordKindLabel(kind)}</div>
            <Trophy className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          </div>
          <dl className="mt-2 space-y-1.5 text-sm">
            {([
              ['Today', 'daily'],
              ['This week', 'weekly'],
              ['This month', 'monthly'],
              ['All time', 'allTime'],
            ] as [string, PeriodKind][]).map(([label, period]) => {
              const entry = card[kind][period]
              const isNew = newRecords.includes(period)
              return (
                <div key={period} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="flex items-center gap-1.5">
                    {isNew && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">new</span>
                    )}
                    <span className="font-extrabold tabular-nums">{entry ? entry.value : '—'}</span>
                  </dd>
                </div>
              )
            })}
          </dl>
          {newRecords.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
              {newRecords.map((p) => periodNames[p]).join(' · ')} record{newRecords.length > 1 ? 's' : ''} this session — beat {newRecords.length > 1 ? 'them' : 'it'} tomorrow.
            </div>
          )}
        </div>
        <div className="mt-6 flex w-full flex-col gap-2">
          <Button onClick={() => (mode === 'dojo' ? startDojo() : startCourse(course))}>
            <Play className="mr-2 h-4 w-4" /> Train again
          </Button>
          <Button variant="secondary" onClick={backToCourses}>
            <ChevronLeft className="mr-1 h-4 w-4" /> All repertoires
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------ drill surface ------------------------------ */
  const line = lineRef.current
  const modeMeta = MODES.find((m) => m.id === mode)
  const ModeIcon = modeMeta?.icon ?? Target

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-2 py-4 pb-24 sm:px-4 lg:grid-cols-[280px_minmax(0,1fr)_260px] lg:pb-8">
      {/* line list */}
      <aside className="order-2 min-w-0 lg:order-1">
        <button
          onClick={backToCourses}
          className="mb-2 flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> {course.name}
        </button>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Lines</span>
            <span className="text-xs font-extrabold">{masteryPercent(course.lines, mastery[course.id])}%</span>
          </div>
          <div className="mt-2 max-h-[50vh] space-y-1 overflow-y-auto scroll-slim lg:max-h-[60vh]">
            {course.lines.map((l, li) => {
              const m = mastery[course.id]?.[l.id]
              const active = selectedLineId === l.id && (line?.id === l.id)
              const dueSoon = m && m.reps > 0 && m.due <= Date.now()
              const tiers = tierProgressList(course, mastery[course.id])
              const myTier = tiers.find((t) => li >= t.start && li < t.end)
              const tierHeader = myTier && li === myTier.start
              const locked = myTier ? !myTier.unlocked : false
              return (
                <div key={l.id}>
                  {tierHeader && (
                    <div
                      className={cn(
                        'mb-1 flex items-center gap-1.5 px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wide',
                        locked ? 'text-muted-foreground/50' : 'text-muted-foreground',
                      )}
                    >
                      {locked ? (
                        <Lock className="h-3 w-3" aria-hidden />
                      ) : myTier.mastered ? (
                        <Star className="h-3 w-3 text-amber-500" aria-hidden />
                      ) : null}
                      <span>{myTier.name}</span>
                      <span className="tabular-nums">{myTier.learned}/{myTier.total}</span>
                      {locked && <span className="normal-case font-medium">· unlocks as these are drilled</span>}
                      {myTier.mastered && <span className="normal-case font-medium text-amber-600 dark:text-amber-400">· perfected</span>}
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex w-full items-center gap-0.5 rounded-lg transition-colors',
                      active ? 'bg-primary/15' : 'hover:bg-accent/60',
                      locked && 'opacity-60',
                    )}
                  >
                    <button
                      onClick={() => drillLine(course, l)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs"
                    >
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', confidenceDot(m))} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{l.moves.slice(0, 4).join(' ')}{l.moves.length > 4 ? ' …' : ''}</span>
                      {dueSoon && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Due for review" aria-hidden />}
                      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{m?.confidence ?? 5}/10</span>
                    </button>
                    {m && m.reps > 0 && (
                      <button
                        onClick={() => forgetLine(course.id, l.id)}
                        title="Unlearn this line — forgets its progress here and in your account"
                        aria-label={`Unlearn ${l.moves.slice(0, 3).join(' ')}`}
                        className="mr-1 shrink-0 rounded p-1 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* board */}
      <main className="order-1 min-w-0 lg:order-2">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id)
                try { window.localStorage.setItem(MODE_KEY, m.id) } catch { /* private mode */ }
                startCourse(course)
              }}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                mode === m.id ? 'bg-primary text-primary-foreground' : 'bg-accent/60 text-muted-foreground hover:bg-accent',
              )}
            >
              <m.icon className="h-3.5 w-3.5" aria-hidden />
              {m.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            {mode === 'time' && (
              <span className={cn('flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold tabular-nums', clock < 15 ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-accent/60')}>
                <Hourglass className="h-3.5 w-3.5" aria-hidden /> {Math.max(0, Math.ceil(clock))}s
              </span>
            )}
            {(mode === 'drill' || mode === 'time' || mode === 'dojo') && (
              <span className="flex items-center gap-1 rounded-full bg-accent/60 px-3 py-1.5 text-xs font-extrabold tabular-nums">
                <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden /> {stats.streak}
              </span>
            )}
            {mode === 'dojo' ? (
              <>
                <Button variant="secondary" size="sm" onClick={nextDojoRep} title="Skip to the next random rep">
                  <SkipForward className="h-3.5 w-3.5" aria-label="Skip rep" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => endSession('Dojo session ended.')} title="Finish and see the summary">
                  Finish
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => nextLine(course, line?.id)} title="Skip to the next line">
                <SkipForward className="h-3.5 w-3.5" aria-label="Skip line" />
              </Button>
            )}
          </div>
        </div>

        {mode === 'dojo' && dojoSource && (
          <div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            <Dumbbell className="h-3.5 w-3.5 text-primary" aria-hidden /> Dojo rep from {dojoSource}
          </div>
        )}
        <ChessBoard
          fen={fen}
          orientation={course.side}
          onMove={onPlayerMove}
          interactive={phase === 'awaiting'}
          movableSide={course.side}
          lastMove={lastMove}
          showLegal={phase === 'awaiting'}
          showCoords={showCoords}
          theme={boardTheme}
          flashes={flashes}
          shake={shake}
          className="h-full w-full"
        />

        {/* status strip */}
        <div className="mt-2 flex min-h-10 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-border/60">
          {phase === 'autopilot' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-label="Playing" />}
          {phase === 'complete' && <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
          {phase === 'awaiting' && <ModeIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
          <span className="min-w-0 flex-1 truncate" aria-live="polite">
            {praise && phase === 'awaiting' ? <span className="font-bold text-emerald-600 dark:text-emerald-400">{praise} </span> : null}
            {status || (phase === 'awaiting' ? 'Your move.' : 'Watch the board…')}
          </span>
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
            {lineProgress.done}/{lineProgress.total}
          </span>
        </div>

        {phase === 'awaiting' && mode === 'learn' && (
          <Button variant="secondary" size="sm" className="mt-2" onClick={showHint}>
            <Lightbulb className="mr-1 h-3.5 w-3.5" /> Show me the square
          </Button>
        )}
      </main>

      {/* session panel */}
      <aside className="order-3 min-w-0 space-y-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">This session</div>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Lines</dt><dd className="font-extrabold tabular-nums">{stats.lines}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Accuracy</dt><dd className="font-extrabold tabular-nums">{stats.studentMoves + stats.mistakes > 0 ? Math.round((stats.studentMoves / (stats.studentMoves + stats.mistakes)) * 100) : 100}%</dd></div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Best streak</dt>
              <dd className="flex items-center gap-2">
                {(() => {
                  const ms = milestoneFor(stats.bestStreak)
                  return ms ? (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">{ms.label}</span>
                  ) : null
                })()}
                <span className="font-extrabold tabular-nums">{stats.bestStreak}</span>
              </dd>
            </div>
            {mode === 'time' && <div className="flex justify-between"><dt className="text-muted-foreground">Score</dt><dd className="font-extrabold tabular-nums">{timeScore}</dd></div>}
            {mode === 'dojo' && <div className="flex justify-between"><dt className="text-muted-foreground">Dojo best</dt><dd className="font-extrabold tabular-nums">{Math.max(dojoBest, stats.bestStreak)}</dd></div>}
            {(() => {
              const nm = nextMilestone(stats.bestStreak)
              return nm ? (
                <div className="text-xs text-muted-foreground">{nm.at - stats.bestStreak} more clean {nm.at - stats.bestStreak === 1 ? 'line' : 'lines'} to {nm.label.toLowerCase()}</div>
              ) : stats.bestStreak > 0 ? (
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400">Top tier reached.</div>
              ) : null
            })()}
          </dl>
        </div>

        {/* Records (chessreps §7 item 8): daily / weekly / monthly / all-time
            maxes per course, kept fresh while the session runs. */}
        {records && (() => {
          const kind: RecordKind = mode === 'time' ? 'time' : mode === 'dojo' ? 'dojo' : 'drill'
          const rows: { label: string; entry: typeof records[RecordKind][PeriodKind] }[] = [
            { label: 'Today', entry: records[kind].daily },
            { label: 'This week', entry: records[kind].weekly },
            { label: 'This month', entry: records[kind].monthly },
            { label: 'All time', entry: records[kind].allTime },
          ]
          return (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Records — {recordKindLabel(kind)}</div>
                <Trophy className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              </div>
              <dl className="mt-2 space-y-1.5 text-sm">
                {rows.map((r) => (
                  <div key={r.label} className="flex justify-between">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-extrabold tabular-nums">{r.entry ? r.entry.value : '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })()}

        {/* completion card */}
        {phase === 'complete' && line && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <GraduationCap className="h-4 w-4 text-primary" aria-hidden /> Line learned
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{line.moves.join(' ')}</div>
            <p className="mt-2 text-sm leading-snug">{line.idea}</p>
            {mode === 'dojo' ? (
              <Button size="sm" className="mt-3 w-full" onClick={nextDojoRep}>
                Next rep <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : mode !== 'time' && (
              <Button size="sm" className="mt-3 w-full" onClick={() => nextLine(course, line.id)}>
                Next line <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

        <div className="rounded-xl border bg-card p-3 text-xs leading-snug text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide">
            <Brain className="h-3.5 w-3.5" aria-hidden /> How mastery works
          </div>
          Clean lines gain confidence and come back later. Mistakes bring the line back sooner. The dots on the left are your memory of each line.
        </div>
      </aside>
    </div>
  )
}
