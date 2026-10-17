'use client'
// Opening Trainer — chessigma-style repertoire drilling on top of the 18
// curated opening guides. The user plays the guide's side of the stored main
// line from memory; the opponent's book replies are replayed from the guide's
// own SAN arrays (no engine involved). Progress is device-local on purpose:
// it lives in localStorage under `chessx-opening-progress-v1`, never on a
// server, and the UI says so.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard } from '@/components/chess/board'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Search,
  GraduationCap,
  RotateCcw,
  FlipHorizontal2,
  ArrowLeft,
  Trophy,
  ListTree,
  Lightbulb,
  HardDrive,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OPENING_GUIDES, type OpeningGuide } from '@/content/opening-guides'

// ---------------------------------------------------------------------------
// Progress store (device-local localStorage)
// ---------------------------------------------------------------------------

const PROGRESS_KEY = 'chessx-opening-progress-v1'

interface GuideProgress {
  /** Furthest ply reached on the guide's main line. */
  donePlies: number
  /** Main line finished at least once. */
  completed: boolean
  lastAt: number
  /** Main line finished 100% from memory with zero assists at least once. */
  clean?: boolean
}

type ProgressMap = Record<string, GuideProgress>

const EMPTY_PROGRESS: GuideProgress = { donePlies: 0, completed: false, lastAt: 0 }

// ---------------------------------------------------------------------------
// Drill model
// ---------------------------------------------------------------------------

interface DrillLine {
  kind: 'main' | 'variation'
  name: string
  moves: string[]
}

interface PlayedMove {
  san: string
  from: string
  to: string
  byUser: boolean
  assisted: boolean
}

interface Drill {
  guide: OpeningGuide
  line: DrillLine
  /** The side the user plays. */
  side: 'w' | 'b'
  played: PlayedMove[]
  /** Wrong attempts on the current ply (drives the hint arrow / auto-play). */
  wrongTries: number
  assisted: number
  complete: boolean
}

const REPLY_DELAY_MS = 450
const FLASH_CLEAR_MS = 950
const SHAKE_MS = 550

/** Tolerant SAN comparison: ignore check/mate marks and 0-vs-O castling. */
function norm(san: string): string {
  return san.replace(/[+#]/g, '').replace(/0/g, 'O')
}

/** Replay the first `plies` SANs of a stored line from the initial position. */
function replayTo(moves: string[], plies: number): Chess {
  const g = new Chess()
  for (let i = 0; i < plies && i < moves.length; i++) {
    try {
      g.move(moves[i])
    } catch {
      break // guides are validated; defensive only
    }
  }
  return g
}

function sideOfPly(plies: number): 'w' | 'b' {
  return plies % 2 === 0 ? 'w' : 'b'
}

function sideName(side: 'w' | 'b'): string {
  return side === 'w' ? 'White' : 'Black'
}

function lineLabel(d: Drill): string {
  return d.line.kind === 'main' ? `${d.guide.name} main line` : `${d.line.name} line`
}

function kingSquareOf(g: Chess, color: 'w' | 'b'): string | null {
  for (const row of g.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square
    }
  }
  return null
}

function relTime(ts: number): string {
  if (!ts) return 'never'
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return `on ${new Date(ts).toLocaleDateString()}`
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SideBadge({ side }: { side: 'white' | 'black' | 'either' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        side === 'white' && 'bg-secondary text-secondary-foreground ring-1 ring-border',
        side === 'black' && 'bg-foreground/85 text-background',
        side === 'either' && 'bg-primary/15 text-primary',
      )}
    >
      {side === 'white' ? 'White' : side === 'black' ? 'Black' : 'Either'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// OpeningTrainer
// ---------------------------------------------------------------------------

export function OpeningTrainer() {
  const [progress, setProgress] = useState<ProgressMap>({})
  const progressRef = useRef<ProgressMap>({})
  const [drill, setDrill] = useState<Drill | null>(null)
  const drillRef = useRef<Drill | null>(null)

  const [query, setQuery] = useState('')
  const [sideFilter, setSideFilter] = useState<'all' | 'white' | 'black'>('all')
  const [flipped, setFlipped] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'wrong' | 'assist' } | null>(null)
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState<{ square: string; color: 'green' | 'red' }[]>([])
  const [showVars, setShowVars] = useState(false)

  const replyTimer = useRef<number | null>(null)
  const uiTimer = useRef<number | null>(null)

  // Load device-local progress after mount (kept out of the first render so
  // server and client markup match), and stop any pending drill timers on
  // unmount.
  useEffect(() => {
    void (async () => {
      try {
        const raw = window.localStorage.getItem(PROGRESS_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as ProgressMap
        if (!parsed || typeof parsed !== 'object') return
        progressRef.current = parsed
        setProgress(parsed)
      } catch {
        /* corrupt or unavailable storage — start fresh */
      }
    })()
    return () => {
      if (replyTimer.current !== null) window.clearTimeout(replyTimer.current)
      if (uiTimer.current !== null) window.clearTimeout(uiTimer.current)
    }
  }, [])

  function clearTimers() {
    if (replyTimer.current !== null) {
      window.clearTimeout(replyTimer.current)
      replyTimer.current = null
    }
    if (uiTimer.current !== null) {
      window.clearTimeout(uiTimer.current)
      uiTimer.current = null
    }
  }

  /** One transient UI timer (flash/shake clears) — feedback is one-at-a-time. */
  function later(fn: () => void, ms: number) {
    if (uiTimer.current !== null) window.clearTimeout(uiTimer.current)
    uiTimer.current = window.setTimeout(() => {
      uiTimer.current = null
      fn()
    }, ms)
  }

  function updateProgress(slug: string, fn: (p: GuideProgress) => GuideProgress) {
    const prev = progressRef.current[slug] ?? EMPTY_PROGRESS
    const next: ProgressMap = { ...progressRef.current, [slug]: fn(prev) }
    progressRef.current = next
    setProgress(next)
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable (private mode) — progress stays in memory */
    }
  }

  /**
   * Schedule the opponent's stored book reply for the position after `plies`.
   * All state reads happen inside the callback via the drill ref, so a stale
   * timer can never apply a move to the wrong position.
   */
  function scheduleReply(plies: number) {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current)
    replyTimer.current = window.setTimeout(() => {
      replyTimer.current = null
      const cur = drillRef.current
      if (!cur || cur.complete) return
      const idx = cur.played.length
      if (idx !== plies) return // drill moved on (reset / new drill) — stale
      if (sideOfPly(idx) === cur.side) return // user's turn — nothing to replay
      const san = cur.line.moves[idx]
      if (!san) return
      try {
        const g = replayTo(cur.line.moves, idx)
        const m = g.move(san)
        applyMove({ san: m.san, from: m.from, to: m.to }, false, false)
      } catch {
        /* stored lines are validated; ignore defensively */
      }
    }, REPLY_DELAY_MS)
  }

  /** Apply a verified book move to the drill and persist main-line progress. */
  function applyMove(mv: { san: string; from: string; to: string }, byUser: boolean, assisted: boolean) {
    const d = drillRef.current
    if (!d || d.complete) return
    const idx = d.played.length
    const expected = d.line.moves[idx]
    if (!expected || norm(expected) !== norm(mv.san)) return

    const played: PlayedMove[] = [...d.played, { ...mv, byUser, assisted }]
    const assistedTotal = d.assisted + (assisted ? 1 : 0)
    const complete = played.length >= d.line.moves.length
    const next: Drill = { ...d, played, wrongTries: 0, assisted: assistedTotal, complete }
    drillRef.current = next
    setDrill(next)
    setMessage(null)

    if (byUser) {
      setFlash([{ square: mv.to, color: 'green' }])
      later(() => setFlash([]), FLASH_CLEAR_MS)
    }

    // Main-line progress advances donePlies/completed/clean; variation drills
    // only refresh lastAt so main-line stats stay honest.
    if (d.line.kind === 'main') {
      updateProgress(d.guide.slug, (p) => ({
        donePlies: Math.max(p.donePlies, Math.min(played.length, d.line.moves.length)),
        completed: p.completed || complete,
        clean: p.clean || (complete && assistedTotal === 0),
        lastAt: Date.now(),
      }))
    } else {
      updateProgress(d.guide.slug, (p) => ({ ...p, lastAt: Date.now() }))
    }

    if (complete) return
    if (sideOfPly(played.length) !== d.side) scheduleReply(played.length)
  }

  function startDrill(guide: OpeningGuide, line: DrillLine, side: 'w' | 'b') {
    clearTimers()
    setShake(false)
    setFlash([])
    setMessage(null)
    setShowVars(false)
    setFlipped(false)
    const d: Drill = { guide, line, side, played: [], wrongTries: 0, assisted: 0, complete: false }
    drillRef.current = d
    setDrill(d)
    if (side === 'b') scheduleReply(0) // White opens in the book — replay move one
  }

  function goBack() {
    clearTimers()
    setShake(false)
    setFlash([])
    setMessage(null)
    setShowVars(false)
    drillRef.current = null
    setDrill(null)
  }

  function registerWrong(d: Drill, idx: number, attemptedTo: string | null) {
    const tries = d.wrongTries + 1
    const next: Drill = { ...d, wrongTries: tries }
    drillRef.current = next
    setDrill(next)
    setShake(true)
    if (attemptedTo) setFlash([{ square: attemptedTo, color: 'red' }])
    later(() => {
      setShake(false)
      setFlash([])
    }, SHAKE_MS)

    const expected = d.line.moves[idx]
    if (tries >= 3) {
      // Third miss: auto-play the book move as an assisted ply and continue.
      try {
        const g = replayTo(d.line.moves, idx)
        const em = g.move(expected)
        applyMove({ san: em.san, from: em.from, to: em.to }, false, true)
      } catch {
        /* stored lines are validated; ignore defensively */
      }
      setMessage({ text: `Not the main line — ${expected} is played for you. Watch the reply and continue.`, tone: 'assist' })
    } else if (tries >= 2) {
      setMessage({ text: 'Not the main line — try again. The green arrow shows the book move.', tone: 'wrong' })
    } else {
      setMessage({ text: 'Not the main line — try again.', tone: 'wrong' })
    }
  }

  function handleBoardMove(from: Square, to: Square, promotion?: string) {
    const d = drillRef.current
    if (!d || d.complete) return
    const idx = d.played.length
    const expected = d.line.moves[idx]
    if (!expected) return
    if (sideOfPly(idx) !== d.side) return // opponent is replying — input locked
    const g = replayTo(d.line.moves, idx)
    try {
      const m = g.move({ from, to, promotion })
      if (norm(m.san) === norm(expected)) {
        applyMove({ san: m.san, from, to }, true, false)
      } else {
        registerWrong(d, idx, to)
      }
    } catch {
      // The board only offers legal moves, so this is a rare guard.
      registerWrong(d, idx, to)
    }
  }

  // Derived drill visuals -----------------------------------------------------

  const boardPos = useMemo(() => {
    if (!drill) return null
    const plies = drill.played.length
    const g = replayTo(drill.line.moves, plies)
    return {
      fen: g.fen(),
      check: g.isCheck() ? kingSquareOf(g, g.turn()) : null,
      last: drill.played[plies - 1] ?? null,
    }
  }, [drill])

  const waiting = !!drill && !drill.complete && sideOfPly(drill.played.length) !== drill.side

  const orientation: 'w' | 'b' = drill
    ? drill.side === 'b'
      ? flipped
        ? 'w'
        : 'b'
      : flipped
        ? 'b'
        : 'w'
    : 'w'

  const hintArrow = useMemo(() => {
    if (!drill || drill.complete || drill.wrongTries < 2) return null
    const idx = drill.played.length
    const san = drill.line.moves[idx]
    if (!san) return null
    try {
      const g = replayTo(drill.line.moves, idx)
      const m = g.move(san)
      return { from: m.from, to: m.to }
    } catch {
      return null
    }
  }, [drill])

  const fromMemory = drill ? drill.played.filter((m) => m.byUser).length : 0
  const drillPct = drill && boardPos ? Math.round((drill.played.length / drill.line.moves.length) * 100) : 0

  // Picker filtering ----------------------------------------------------------

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return OPENING_GUIDES.filter((g) => {
      if (sideFilter === 'white' && g.side !== 'white' && g.side !== 'either') return false
      if (sideFilter === 'black' && g.side !== 'black' && g.side !== 'either') return false
      if (!q) return true
      return g.name.toLowerCase().includes(q) || g.eco.toLowerCase().includes(q)
    })
  }, [query, sideFilter])

  const masteredCount = OPENING_GUIDES.filter((g) => progress[g.slug]?.clean).length
  const startedCount = OPENING_GUIDES.filter((g) => (progress[g.slug]?.donePlies ?? 0) > 0).length

  // ---------------------------------------------------------------------------

  if (!drill || !boardPos) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Opening trainer</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Drill the 18 main lines from memory: you play your side, the app replays the book replies. Two misses earn a
          hint arrow, three and the move is played for you.{' '}
          <span className="font-semibold text-foreground/80">Progress is saved on this device.</span>
        </p>
        {(masteredCount > 0 || startedCount > 0) && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Trophy className="h-3 w-3 text-primary" aria-hidden />
            {masteredCount} mastered · {startedCount} in progress · {OPENING_GUIDES.length} guides
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="block flex-1">
            <span className="sr-only">Search openings to drill</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${OPENING_GUIDES.length} guides — name or ECO…`}
                className="min-h-11 pl-9"
                aria-label="Search openings to drill"
              />
            </div>
          </label>
          <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="Filter guides by side">
            {(['all', 'white', 'black'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSideFilter(f)}
                aria-pressed={sideFilter === f}
                className={cn(
                  'min-h-11 flex-1 px-4 py-2 text-sm font-bold capitalize transition',
                  sideFilter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <ul className="scroll-slim mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="Guides you can drill">
          {filtered.map((g) => {
            const p = progress[g.slug]
            const pct = p ? Math.min(100, Math.round((p.donePlies / g.moves.length) * 100)) : 0
            return (
              <li key={g.slug}>
                <button
                  type="button"
                  onClick={() => startDrill(g, { kind: 'main', name: g.name, moves: g.moves }, g.side === 'black' ? 'b' : 'w')}
                  className="min-h-11 w-full rounded-lg border border-border/60 bg-background p-3 text-left transition hover:border-primary/40 hover:bg-accent/60"
                  aria-label={`Drill the ${g.name} main line as ${g.side === 'black' ? 'Black' : 'White'}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-bold">{g.name}</span>
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">{g.eco}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <SideBadge side={g.side} />
                    <span className="text-muted-foreground">{g.moves.length} plies</span>
                    {p?.clean && (
                      <Badge className="h-5 gap-1 px-1.5 py-0 text-[10px]" aria-label="Mastered — main line played from memory with zero assists">
                        <Trophy aria-hidden /> Mastered
                      </Badge>
                    )}
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <Progress className="h-1.5 flex-1" value={pct} aria-label={`${pct}% of the ${g.name} main line drilled`} />
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {p?.donePlies ?? 0}/{g.moves.length}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {p?.clean
                      ? 'Mastered — drill it again any time.'
                      : p?.completed
                        ? 'Completed — a zero-assist run earns Mastered.'
                        : p?.lastAt
                          ? `Last drilled ${relTime(p.lastAt)}`
                          : 'Not started'}
                  </span>
                </button>
              </li>
            )
          })}
          {filtered.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No guide matches that search.</li>}
        </ul>
      </div>
    )
  }

  // Drill screen --------------------------------------------------------------

  const bookIdea = drill.line.kind === 'main' ? drill.guide.idea : drill.guide.variations.find((v) => v.name === drill.line.name)?.idea

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={goBack} className="min-h-11 px-3" aria-label="Back to the guide list">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Guides
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg font-extrabold">{drill.guide.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold">{drill.guide.eco}</span>
            <span>{drill.line.kind === 'main' ? 'Main line' : `Variation · ${drill.line.name}`}</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-foreground/80">You play {sideName(drill.side)}</span>
          </div>
        </div>
        {drill.guide.side === 'either' && (
          <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="Choose the side to play">
            {(['w', 'b'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (drill.side !== s) startDrill(drill.guide, drill.line, s)
                }}
                aria-pressed={drill.side === s}
                className={cn(
                  'min-h-11 px-3 text-xs font-bold transition',
                  drill.side === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                As {sideName(s)}
              </button>
            ))}
          </div>
        )}
        <Button variant="outline" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} className="min-h-11 px-3" aria-label="Flip the board">
          <FlipHorizontal2 className="h-4 w-4" aria-hidden /> Flip
        </Button>
      </div>

      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{bookIdea ?? drill.guide.idea}</p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div>
          <ChessBoard
            fen={boardPos.fen}
            orientation={orientation}
            onMove={handleBoardMove}
            movableSide={drill.side}
            interactive={!waiting && !drill.complete}
            lastMove={boardPos.last ? { from: boardPos.last.from, to: boardPos.last.to } : null}
            checkSquare={boardPos.check}
            arrows={hintArrow ? [{ from: hintArrow.from, to: hintArrow.to, color: 'green' }] : []}
            flashes={flash}
            shake={shake}
          />
          <div className="mt-2 flex items-center justify-between text-xs" role="status" aria-live="polite">
            <span className={cn('font-semibold', drill.complete ? 'text-primary' : waiting ? 'text-muted-foreground' : 'text-foreground')}>
              {drill.complete ? 'Line complete' : waiting ? 'Opponent plays the book reply…' : `Your move as ${sideName(drill.side)}`}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              Ply {drill.played.length}/{drill.line.moves.length}
            </span>
          </div>
          <Progress className="mt-1 h-1.5" value={drillPct} aria-label={`Drill progress: ply ${drill.played.length} of ${drill.line.moves.length}`} />
        </div>

        <div className="min-w-0 space-y-3">
          {message && !drill.complete && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-semibold',
                message.tone === 'wrong' && 'border-destructive/30 bg-destructive/5 text-destructive',
                message.tone === 'assist' && 'border-amber-500/40 bg-amber-500/10 text-foreground',
              )}
              role={message.tone === 'wrong' ? 'alert' : 'status'}
            >
              {message.tone === 'wrong' && hintArrow && <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <span>{message.text}</span>
            </div>
          )}

          {drill.complete && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4" role="status">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" aria-hidden />
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Line complete</span>
              </div>
              <p className="mt-2 text-sm font-semibold">
                You played the {lineLabel(drill)} ({fromMemory + drill.assisted} {fromMemory + drill.assisted === 1 ? 'move' : 'moves'}) —{' '}
                {fromMemory} from memory, {drill.assisted} assisted.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {drill.assisted === 0
                  ? 'Clean run — zero assists. This line counts as mastered.'
                  : 'A run with zero assists marks this line mastered.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => startDrill(drill.guide, drill.line, drill.side)} className="min-h-11">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Drill again
                </Button>
                <Button variant="secondary" onClick={() => setShowVars((v) => !v)} aria-expanded={showVars} className="min-h-11">
                  <ListTree className="h-4 w-4" aria-hidden /> Drill a variation
                </Button>
                <Button variant="outline" onClick={goBack} className="min-h-11">
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back to guides
                </Button>
              </div>
            </div>
          )}

          {showVars && (
            <div className="rounded-lg border border-border/40 bg-background p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Key variations — pick one to drill</div>
              <ul className="scroll-slim mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {drill.line.kind === 'variation' && (
                  <li className="flex items-start justify-between gap-3 rounded-md bg-secondary/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold">
                        {drill.guide.name} main line{' '}
                        <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{drill.guide.moves.length} plies</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{drill.guide.idea}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11 shrink-0"
                      onClick={() => startDrill(drill.guide, { kind: 'main', name: drill.guide.name, moves: drill.guide.moves }, drill.side)}
                    >
                      Drill
                    </Button>
                  </li>
                )}
                {drill.guide.variations.map((v) => (
                  <li key={v.name} className="flex items-start justify-between gap-3 rounded-md bg-secondary/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold">
                        {v.name} <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{v.moves.length} plies</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{v.idea}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11 shrink-0"
                      onClick={() => startDrill(drill.guide, { kind: 'variation', name: v.name, moves: v.moves }, drill.side)}
                    >
                      Drill
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-border/40 bg-background p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {drill.line.kind === 'main' ? 'Main line' : drill.line.name}
            </div>
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Moves played so far">
              {drill.played.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {drill.side === 'w' ? 'No moves yet — play the first move.' : 'White is opening — the book move arrives in a moment.'}
                </span>
              ) : (
                drill.played.map((m, i) => (
                  <span
                    key={`${i}-${m.san}`}
                    title={m.assisted ? 'Assisted — the move was played for you' : m.byUser ? 'Played from memory' : 'Book reply'}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-xs',
                      m.assisted ? 'bg-amber-500/15 font-semibold text-foreground ring-1 ring-amber-500/50' : '',
                      m.byUser && 'bg-secondary font-bold text-foreground',
                      !m.byUser && !m.assisted && 'bg-secondary/60 text-muted-foreground',
                    )}
                  >
                    {i % 2 === 0 ? `${i / 2 + 1}.` : ''}
                    {m.san}
                    {m.assisted ? ' ✦' : ''}
                  </span>
                ))
              )}
            </div>
            {drill.played.some((m) => m.assisted) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-bold text-amber-500" aria-hidden>
                  ✦
                </span>{' '}
                assisted — the move was shown or played for you
              </p>
            )}
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <HardDrive className="h-3 w-3" aria-hidden /> Progress is saved on this device.
          </p>
        </div>
      </div>
    </div>
  )
}
