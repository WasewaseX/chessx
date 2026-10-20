'use client'
import { readJson } from '@/lib/api-client'
// Spaced-repetition Review: missed puzzles and shaky lessons resurface here
// on an SM-2 derived schedule, next to the weakest concepts from the skill model.
// On top sits the Mistake Corrector: the player's own analyzed-game errors
// (Mistakes / Blunders / Missed wins) replayed until mastered.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { useApp } from '@/lib/store'
import { PUZZLE_THEMES } from '@/content/schema'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Loader2,
  Puzzle,
  BookOpen,
  CalendarClock,
  Layers,
  RotateCcw,
  Target,
  X,
  SkipForward,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react'

interface QueueItem {
  id: string
  kind: 'puzzle' | 'lesson'
  refId: string
  concept: string | null
  reps: number
  lapses: number
  dueAt: string
  puzzle?: { id: string; title: string; rating: number; themes: string[]; fen: string } | null
  lesson?: { id: string; title: string; tierTitle: string } | null
}

interface MasteryRow {
  concept: string
  mastery: number
  attempts: number
  correct: number
}

// ------------------------- Mistake Corrector -------------------------------

interface DrillDTO {
  id: string
  fen: string
  sideToMove: 'w' | 'b'
  evalLossCp: number
  plyNumber: number
  opening: string | null
  opponent: string | null
  attempts: number
  fails: number
  mastered: boolean
  revealed: boolean
  nextDueAt: string
  createdAt: string
  saved: boolean
}

interface DrillFeedback {
  kind: 'correct' | 'wrong' | 'revealed'
  bestSan?: string
  userSan?: string
  lossCp?: number
  coachLine?: string
  mastered?: boolean
  arrow?: { from: string; to: string } | null
}

/** Board state travels with the active drill; switching drills rebuilds the
 * chess.js instance. The switch is adjusted during render (official
 * derived-state pattern) so no effect ever calls setState. */
interface BoardState {
  drillId: string | null
  fen: string
  game: Chess
}

const BOARD_VISIBLE = 12 // queue rows shown before "load more"

function MistakeCorrector() {
  const { navigate, profile, openingDrillFocus, setOpeningDrillFocus } = useApp()
  const [drills, setDrills] = useState<DrillDTO[]>([])
  const [masteredCount, setMasteredCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [current, setCurrent] = useState<DrillDTO | null>(null)
  const [feedback, setFeedback] = useState<DrillFeedback | null>(null)
  const [grading, setGrading] = useState(false)
  const [shake, setShake] = useState(false)
  const [visibleCount, setVisibleCount] = useState(BOARD_VISIBLE)
  const [board, setBoard] = useState<BoardState>(() => ({ drillId: null, fen: '', game: new Chess() }))
  const busyRef = useRef(false)

  const loadDrills = useCallback(
    (opening?: string | null) => {
      setLoading(true)
      setLoadError(false)
      const q = opening ? `?opening=${encodeURIComponent(opening)}` : ''
      fetch(`/api/drills${q}`)
        .then((r) => readJson<{ drills?: DrillDTO[]; mastered?: number }>(r))
        .then((d) => {
          const list = d.drills ?? []
          setDrills(list)
          setMasteredCount(d.mastered ?? 0)
          setCurrent((prev) => (prev && list.some((x) => x.id === prev.id) ? prev : (list[0] ?? null)))
          setVisibleCount(BOARD_VISIBLE)
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false))
    },
    [],
  )

  // Opening Review Queue deep link: when the home card focuses an opening,
  // (re)load the queue scoped to it. Clearing the chip reloads the full set.
  useEffect(() => {
    loadDrills(openingDrillFocus)
  }, [loadDrills, openingDrillFocus])

  // a new active drill rebuilds the board from its stored position
  if (current && board.drillId !== current.id) {
    let game: Chess
    try {
      game = new Chess(current.fen)
    } catch {
      game = new Chess()
    }
    setBoard({ drillId: current.id, fen: current.fen, game })
    setFeedback(null)
  }
  if (!current && board.drillId !== null) {
    setBoard({ drillId: null, fen: '', game: new Chess() })
    setFeedback(null)
  }

  const solved = feedback?.kind === 'correct'
  const arrows: Arrow[] = feedback?.arrow
    ? [{ from: feedback.arrow.from, to: feedback.arrow.to, color: feedback.kind === 'revealed' ? 'green' : 'green' }]
    : []

  async function handleMove(from: Square, to: Square, promotion?: string) {
    if (!current || grading || solved || busyRef.current) return
    const game = board.game
    let san: string | null = null
    try {
      san = game.move({ from, to, promotion: promotion || undefined })?.san ?? null
    } catch {
      san = null
    }
    if (!san) return // the board only offers legal moves; belt and braces
    setBoard({ ...board, fen: game.fen() }) // show the attempted move immediately
    setGrading(true)
    busyRef.current = true
    try {
      const res = await fetch('/api/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drillId: current.id, move: san }),
      })
      const data = await readJson<{
        correct?: boolean
        reveal?: boolean
        bestSan?: string
        userSan?: string
        lossCp?: number
        coachLine?: string
        drill?: { mastered?: boolean; attempts?: number; fails?: number }
      }>(res)
      if (data.correct) {
        if (data.drill?.mastered) setMasteredCount((m) => m + 1)
        // solved: leave the position on the board with the move marked, pulled
        // out of the waiting list, until "Next drill"
        setDrills((list) => list.filter((x) => x.id !== current.id))
        setFeedback({
          kind: 'correct',
          bestSan: data.bestSan,
          coachLine: data.coachLine,
          mastered: data.drill?.mastered,
          arrow: { from, to },
        })
      } else {
        // take the wrong move back: the drill restarts clean either way
        game.undo()
        setBoard({ drillId: current.id, fen: game.fen(), game })
        setShake(true)
        setTimeout(() => setShake(false), 600)
        if (data.reveal) {
          // 2nd consecutive failure (or explicit reveal): show the stored answer
          let arrow: { from: string; to: string } | null = null
          try {
            const mv = new Chess(current.fen).move(data.bestSan ?? '')
            if (mv) arrow = { from: mv.from, to: mv.to }
          } catch {
            arrow = null
          }
          setFeedback({
            kind: 'revealed',
            bestSan: data.bestSan,
            userSan: data.userSan,
            lossCp: data.lossCp,
            coachLine: data.coachLine,
            arrow,
          })
        } else {
          setFeedback({ kind: 'wrong' })
          // 10-minute retry: rotate it to the back of today's queue and face
          // the next one now
          const rest = drills.filter((x) => x.id !== current.id)
          setDrills([...rest, current])
          setCurrent(rest[0] ?? current)
        }
      }
    } catch {
      game.undo()
      setBoard({ drillId: current.id, fen: game.fen(), game })
      setFeedback({ kind: 'wrong' })
    } finally {
      setGrading(false)
      busyRef.current = false
    }
  }

  function nextDrill() {
    setCurrent((prev) => drills.find((x) => x.id !== prev?.id) ?? null)
  }

  function skipCurrent() {
    if (!current) return
    const rest = drills.filter((x) => x.id !== current.id)
    setDrills([...rest, current])
    setCurrent(rest[0] ?? current)
  }

  async function dismissCurrent() {
    if (!current) return
    const gone = current
    const rest = drills.filter((x) => x.id !== gone.id)
    setDrills(rest)
    if (current.id === gone.id) setCurrent(rest[0] ?? null)
    try {
      await fetch(`/api/drills?id=${encodeURIComponent(gone.id)}`, { method: 'DELETE' })
    } catch {
      /* dismissed locally; the next load reconciles with the server */
    }
  }

  function practiceNow(d: DrillDTO) {
    if (grading) return
    setCurrent(d)
  }

  const waiting = drills.length
  const totalSeen = masteredCount + waiting
  const masteredPct = totalSeen > 0 ? (masteredCount / totalSeen) * 100 : 0
  const visible = drills.slice(0, visibleCount)

  return (
    <section className="rounded-xl bg-card p-4 shadow-sm sm:p-6" aria-label="Mistake Corrector">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Target className="h-4 w-4 text-primary" /> Fix your mistakes
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => loadDrills(openingDrillFocus)} aria-label="Refresh the mistake queue" title="Refresh">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        {loading ? (
          'Checking your errors…'
        ) : openingDrillFocus ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {openingDrillFocus}
            </span>
            <span>
              {`${waiting} error${waiting === 1 ? '' : 's'} from this opening · ${masteredCount} mastered overall`}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-primary underline underline-offset-2"
              onClick={() => setOpeningDrillFocus(null)}
            >
              Show all openings
            </button>
          </span>
        ) : (
          `${waiting} error${waiting === 1 ? '' : 's'} waiting · ${masteredCount} mastered`
        )}
      </div>
      <Progress value={masteredPct} className="mt-2 h-2" aria-label={`${masteredCount} of ${totalSeen} errors mastered`} />

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Digging through your analyzed games…
        </div>
      ) : loadError ? (
        <div className="py-8 text-center" role="alert">
          <div className="font-display text-base font-bold">Could not load your mistakes.</div>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => loadDrills(openingDrillFocus)}>
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : waiting === 0 && !current ? (
        <div className="py-8 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="mt-2 font-display text-lg font-bold">
            {masteredCount > 0 ? 'Every stored mistake is mastered. Beautiful.' : 'No stored mistakes yet'}
          </div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            No stored mistakes yet — analyze a game in Game review and your errors will appear here.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => navigate('analysis')}>
            Open Game review
          </Button>
        </div>
      ) : current ? (
        <div className="mt-4 grid gap-4">
          <div className="mx-auto w-full max-w-[440px]">
            <ChessBoard
              fen={board.fen}
              orientation={current.sideToMove}
              movableSide={current.sideToMove}
              interactive={!grading && !solved}
              onMove={handleMove}
              arrows={arrows}
              shake={shake}
              theme={profile?.theme ?? 'green'}
              showCoords={profile?.showCoords ?? true}
            />
            <p className="mt-3 text-center text-sm leading-relaxed">
              You were <span className="font-bold">{current.sideToMove === 'w' ? 'White' : 'Black'}</span> here. In the game you
              played{' '}
              <span
                className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider"
                aria-label="the move you played is hidden until the drill is solved"
              >
                hidden
              </span>
              . {solved ? 'Found it!' : 'Find the move you missed.'}
            </p>
            <div className="mt-1 text-center text-xs text-muted-foreground">
              {current.opponent ? `vs ${current.opponent} · ` : ''}
              {current.opening ? `${current.opening} · ` : ''}
              cost about {current.evalLossCp}cp
              {current.attempts > 0 ? ` · faced ${current.attempts} time${current.attempts === 1 ? '' : 's'}` : ''}
            </div>

            <div className="mt-3 min-h-[3.5rem]" role="status" aria-live="polite">
              {grading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking against the engine…
                </div>
              ) : solved ? (
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-primary">
                    <CheckCircle2 className="h-4 w-4" /> That&apos;s the move you missed — {feedback?.bestSan}.
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {feedback?.mastered
                      ? 'This error is now scheduled for review in 7 days.'
                      : 'Clean pass — it comes back once more tomorrow to make it stick.'}
                    {feedback?.coachLine ? <span className="block">{feedback.coachLine}</span> : null}
                  </div>
                </div>
              ) : feedback?.kind === 'wrong' ? (
                <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm font-semibold text-destructive">
                  Not the move. Scan checks, captures and threats once more.
                </div>
              ) : feedback?.kind === 'revealed' ? (
                <div className="rounded-lg bg-secondary/60 p-3 text-center">
                  <div className="text-sm font-bold">
                    In the game you played {feedback.userSan} which cost {feedback.lossCp} centipawns.
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    The best move is marked on the board — play it to finish the pass.
                    {feedback.coachLine ? <span className="block">{feedback.coachLine}</span> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {solved ? (
                <Button className="btn-hero" size="sm" onClick={nextDrill}>
                  {drills.length > 0 ? 'Next drill' : 'All caught up'}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={skipCurrent} disabled={grading}>
                    <SkipForward className="h-4 w-4" /> Skip for now
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={dismissCurrent}
                    disabled={grading}
                    aria-label="Never show this mistake again"
                  >
                    <X className="h-4 w-4" /> Never show again
                  </Button>
                </>
              )}
            </div>
          </div>

          {drills.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</div>
              <div className="scroll-slim mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {visible.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => practiceNow(d)}
                    disabled={grading}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    aria-label={`Practice the error that cost about ${d.evalLossCp} centipawns${d.opponent ? ` against ${d.opponent}` : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {d.sideToMove === 'w' ? 'White' : 'Black'} to move · {d.opponent ?? 'your game'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {d.opening ? `${d.opening} · ` : ''}
                        cost about {d.evalLossCp}cp
                        {d.attempts > 0 ? ` · faced ${d.attempts}×` : ''}
                        {d.revealed ? ' · answer seen' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-primary">{d.id === current.id ? 'On the board' : 'Practice'}</span>
                  </button>
                ))}
              </div>
              {drills.length > visibleCount && (
                <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setVisibleCount((v) => v + BOARD_VISIBLE)}>
                  <ChevronDown className="h-4 w-4" /> Load more ({drills.length - visibleCount} left)
                </Button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

// ------------------------------- Review view -------------------------------

const CONCEPT_LABELS: Record<string, string> = {
  ...PUZZLE_THEMES,
  development: 'Development',
  center: 'Center',
  castlingSafety: 'Castling safety',
  kingSafety: 'King safety',
  pawnStructure: 'Pawn structure',
  openFiles: 'Open files',
  pieceActivity: 'Piece activity',
  kingActivity: 'King activity',
  opposition: 'Opposition',
  outposts: 'Outposts',
  zugzwang: 'Zugzwang',
  calculation: 'Calculation',
  prophylaxis: 'Prophylaxis',
  coordination: 'Coordination',
  pawnBreaks: 'Pawn breaks',
  bishopPair: 'Bishop pair',
  initiative: 'Initiative',
  technique: 'Technique',
  tempo: 'Tempo',
  tradeDecisions: 'Trade decisions',
}

function conceptLabel(c: string): string {
  return CONCEPT_LABELS[c] ?? c
}

function dueLabel(iso: string): string {
  const d = new Date(iso)
  const days = Math.round((d.getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'due now'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

export function ReviewView() {
  const { navigate, setPendingReview } = useApp()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [mastery, setMastery] = useState<MasteryRow[]>([])

  const loadQueue = useCallback(() => {
    fetch('/api/review')
      .then((r) => readJson<{ queue?: QueueItem[]; dueCount?: number; upcomingCount?: number; mastery?: MasteryRow[] }>(r))
      .then((d) => {
        setQueue(d.queue ?? [])
        setDueCount(d.dueCount ?? 0)
        setUpcomingCount(d.upcomingCount ?? 0)
        setMastery(d.mastery ?? [])
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  function retryQueue() {
    setLoading(true)
    setLoadError(false)
    loadQueue()
  }

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  function startPuzzle(item: QueueItem) {
    setPendingReview({ itemId: item.id, kind: 'puzzle', refId: item.refId })
    navigate('puzzles')
  }

  function startLesson(item: QueueItem) {
    setPendingReview({ itemId: item.id, kind: 'lesson', refId: item.refId })
    navigate('lesson', item.refId)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-extrabold">Review</h1>
        <div className="text-sm text-muted-foreground">
          Missed puzzles and lessons you finished with help come back here on a schedule, right before you would forget them.
        </div>
      </div>

      {/* Mistake Corrector: the player's own errors as a replay-until-mastered loop */}
      <div className="mb-6">
        <MistakeCorrector />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking the queue…
        </div>
      ) : loadError ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm" role="alert">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="mt-2 font-display text-lg font-bold">Could not load your review queue.</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Check your connection and try again. Nothing is lost, everything stays scheduled on the server.
          </p>
          <Button variant="secondary" className="mt-4" onClick={retryQueue}>
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <CalendarClock className="h-4 w-4 text-primary" /> Due now
              </div>
              <div className="mt-1 font-display text-3xl font-extrabold">{dueCount}</div>
              {upcomingCount > 0 && <div className="text-xs text-muted-foreground">{upcomingCount} more scheduled for later</div>}
            </div>
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Layers className="h-4 w-4 text-primary" /> Weakest concepts
              </div>
              {mastery.length === 0 ? (
                <div className="mt-1 text-sm text-muted-foreground">Solve puzzles and finish lessons to map your strengths.</div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mastery.slice(0, 4).map((m) => (
                    <span key={m.concept} className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">
                      {conceptLabel(m.concept)} {Math.round(m.mastery * 100)}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {queue.length === 0 ? (
            <div className="rounded-xl bg-card p-6 text-center shadow-sm">
              <div className="font-display text-lg font-bold">Nothing due right now.</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                When a rated puzzle gets the better of you, or a lesson only clicks with hints, it lands here so you can face it again with fresh eyes.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {queue.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.kind === 'puzzle' ? <Puzzle className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                      {item.kind === 'puzzle' ? 'Missed puzzle' : 'Lesson revisit'}
                    </div>
                    <div className="mt-1 truncate font-bold">
                      {item.kind === 'puzzle'
                        ? item.puzzle
                          ? `Puzzle · ${item.puzzle.rating}`
                          : 'Puzzle'
                        : item.lesson
                          ? item.lesson.title
                          : 'Lesson'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.kind === 'lesson' && item.lesson ? `${item.lesson.tierTitle} · ` : ''}
                      {`seen ${item.reps + item.lapses} time${item.reps + item.lapses === 1 ? '' : 's'} · ${dueLabel(item.dueAt)}`}
                    </div>
                  </div>
                  <Button className="btn-hero" size="sm" onClick={() => (item.kind === 'puzzle' ? startPuzzle(item) : startLesson(item))}>
                    {item.kind === 'puzzle' ? 'Face it again' : 'Replay lesson'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {mastery.length > 0 && (
            <div className="rounded-xl bg-card p-6 shadow-sm">
              <div className="font-display text-lg font-bold">Concept strength</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {mastery.map((m) => (
                  <div key={m.concept}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold">{conceptLabel(m.concept)}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.correct}/{m.attempts}
                      </span>
                    </div>
                    <Progress value={m.mastery * 100} className="mt-1 h-2" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
