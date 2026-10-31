'use client'

/**
 * Opening Arena — the chessreps.com Arena mode ported from the deep-dive
 * evidence (docs/chessreps-arena-deep-dive.md, P1/P2/P3).
 *
 * The student plays THEIR repertoire against a named opponent whose rating
 * is sampled (Box–Muller, σ=60) around their own arena Elo. The opponent
 * replies with moves real club players actually play at that level —
 * popularity-weighted from the lichess opening explorer, fetched from the
 * student's own browser — with a local Stockfish fallback so an API outage
 * never freezes a game.
 *
 * While the game stays on the booked repertoire line the bot plays theory;
 * the moment anyone steps out of the line, the engine evals that book-exit
 * position and the game becomes real chess. The result is scored exactly
 * like chessreps scores it: final eval vs book-exit eval — delta > 0 win,
 * delta ≥ −50cp draw, else loss — and draws never move your Elo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard } from '@/components/chess/board'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ChevronLeft, Flame, Loader2, ShieldQuestion, Swords, Trophy,
} from 'lucide-react'
import type { RepertoireCourse } from '@/lib/chess/opening-reps'
import { LABEL_META, type MoveLabel } from '@/lib/chess/move-classification'
import { classifyStudentMove, type BadgeResult } from '@/lib/chess/arena-badges'
import {
  applyElo, arenaResultFromDelta, clearExplorerCache, explorerReply, loadRatings,
  pickOpponent, saveRatings, whitePovCp, type ArenaResult, type Persona,
} from '@/lib/chess/arena-rating'

type Phase = 'intro' | 'playing' | 'over'

const BOT_DELAY_MS = 500
const MAX_HALFMOVES = 160

interface Outcome {
  result: ArenaResult
  eloChange: number // 0 for draws (draws never move the arena rating)
  reason: string
  bookExitCp: number | null
  finalCp: number | null
  moves: number
}

/** Random repertoire line: arena is about playing, not about the schedule. */
function randomLine(course: RepertoireCourse) {
  return course.lines[Math.floor(Math.random() * course.lines.length)]
}

function sanForUci(g: Chess, uci: string): string | null {
  try {
    const mv = g.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length >= 5 ? uci[4] : undefined,
    })
    return mv?.san ?? null
  } catch {
    return null
  }
}

function terminalReason(g: Chess): string | null {
  if (g.isCheckmate()) return 'Checkmate.'
  if (g.isStalemate()) return 'Stalemate.'
  if (g.isInsufficientMaterial()) return 'Insufficient material.'
  if (g.isThreefoldRepetition()) return 'Draw by repetition.'
  if (g.isDraw()) return 'Draw.'
  return null
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '—'
  const pawns = cp / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`
}

export function OpeningArena({ course, onExit }: { course: RepertoireCourse; onExit: () => void }) {
  const { profile } = useApp()
  const soundOn = profile?.soundEnabled ?? true
  const boardTheme = profile?.theme ?? 'green'
  const showCoords = profile?.showCoords ?? true

  const [phase, setPhase] = useState<Phase>('intro')
  const [persona, setPersona] = useState<Persona | null>(null)
  const [studentElo, setStudentElo] = useState(950)

  // localStorage is unavailable during SSR: initialize lazily on first render
  // so the intro card shows the real rating without an effect round-trip.
  const [eloLoaded, setEloLoaded] = useState(false)
  if (!eloLoaded && typeof window !== 'undefined') {
    setEloLoaded(true)
    setStudentElo(loadRatings().arenaElo)
  }
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const [fen, setFen] = useState(new Chess().fen())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [status, setStatus] = useState('')
  const [inBook, setInBook] = useState(true)
  const [busy, setBusy] = useState(false) // bot is thinking / eval running
  const [badge, setBadge] = useState<{ label: MoveLabel; san: string; key: number } | null>(null)

  const gameRef = useRef(new Chess())
  const bookedRef = useRef<string[]>([])
  const bookedIdxRef = useRef(0)
  const outOfBookRef = useRef(false)
  const bookExitCpRef = useRef<number | null>(null)
  const evalBusyRef = useRef(false)
  const personaRef = useRef<Persona | null>(null)
  const genRef = useRef(0)
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    genRef.current++
    if (botTimerRef.current) clearTimeout(botTimerRef.current)
  }, [])

  /** White-POV eval of a FEN at a real depth. Never throws. */
  const evalFen = useCallback(async (fenEval: string, depth: number): Promise<number | null> => {
    const gen = genRef.current
    try {
      const turn = new Chess(fenEval).turn() as 'w' | 'b'
      const info = await engine.eval({ fen: fenEval, depth })
      if (gen !== genRef.current) return null
      return whitePovCp(info, turn)
    } catch {
      return null
    }
  }, [])

  const endGame = useCallback(async (reason: string, forced?: ArenaResult) => {
    genRef.current++
    const g = gameRef.current
    const personaNow = personaRef.current
    setBusy(true)
    let finalCp: number | null = null
    let result: ArenaResult
    if (forced) {
      result = forced
      finalCp = await evalFen(g.fen(), 14)
    } else {
      finalCp = await evalFen(g.fen(), 16)
      if (bookExitCpRef.current == null) {
        // Never left the booked line (resign/terminal right at the exit):
        // the line's last position IS the reference.
        bookExitCpRef.current = finalCp
      }
      const studentWhite = course.side === 'w'
      const deltaFromStudent = bookExitCpRef.current != null && finalCp != null
        ? (finalCp - bookExitCpRef.current) * (studentWhite ? 1 : -1)
        : 0
      result = arenaResultFromDelta(deltaFromStudent)
    }
    const ratings = loadRatings()
    const prevElo = ratings.arenaElo
    const nextElo = result === 'draw' ? prevElo : applyElo(prevElo, personaNow?.elo ?? prevElo, result, ratings.arenaAttempts)
    ratings.arenaElo = nextElo
    ratings.arenaAttempts = ratings.arenaAttempts + 1
    saveRatings(ratings)
    setStudentElo(nextElo)
    setOutcome({
      result,
      eloChange: nextElo - prevElo,
      reason,
      bookExitCp: bookExitCpRef.current,
      finalCp,
      moves: Math.ceil(g.history().length / 2),
    })
    setBusy(false)
    setPhase('over')
    playSound(result === 'win' ? 'win' : 'click', soundOn)
  }, [course.side, evalFen, soundOn])

  /** The opponent's move: booked theory while in the line, real-player
   * popularity replies after, engine as the safety net. */
  const botMove = useCallback(() => {
    const gen = genRef.current
    const g = gameRef.current
    setBusy(true)
    botTimerRef.current = setTimeout(async () => {
      if (gen !== genRef.current) return
      const term = terminalReason(g)
      if (term) {
        void endGame(term)
        return
      }
      let san: string | null = null
      let fromBook = false
      if (!outOfBookRef.current && bookedIdxRef.current < bookedRef.current.length) {
        san = bookedRef.current[bookedIdxRef.current] ?? null
        if (san) {
          try {
            const mv = g.move(san)
            if (!mv) san = null
          } catch {
            san = null
          }
          if (san) fromBook = true
        }
      }
      if (!san) {
        // Out of book: popularity-weighted club reply at the persona's level.
        const reply = await explorerReply(g.fen(), personaRef.current?.elo ?? studentElo)
        if (gen !== genRef.current) return
        if (reply.status === 'move') {
          try {
            const mv = g.move(reply.san)
            if (mv) san = mv.san
          } catch {
            san = null
          }
        }
      }
      if (!san) {
        // Explorer unavailable: Stockfish, then a random legal move, so the
        // game always goes on.
        const best = await engine.bestMove({ fen: g.fen(), depth: 12 })
        if (gen !== genRef.current) return
        san = sanForUci(g, best.uci)
      }
      if (!san) {
        try {
          const moves = g.moves()
          if (moves.length) san = g.move(moves[Math.floor(Math.random() * moves.length)]).san
        } catch {
          san = null
        }
      }
      if (!san) {
        void endGame(terminalReason(g) ?? 'No legal replies left.')
        return
      }
      if (fromBook) bookedIdxRef.current++
      setFen(g.fen())
      const last = g.history({ verbose: true }).slice(-1)[0]
      if (last) setLastMove({ from: last.from, to: last.to })
      setBusy(false)
      const term2 = terminalReason(g)
      if (term2) {
        void endGame(term2)
        return
      }
      if (g.history().length >= MAX_HALFMOVES) {
        void endGame('Game called: move limit reached.')
        return
      }
      setStatus('Your move.')
    }, BOT_DELAY_MS)
  }, [endGame, studentElo])

  const startGame = useCallback(() => {
    genRef.current++
    clearExplorerCache()
    if (botTimerRef.current) clearTimeout(botTimerRef.current)
    const p = pickOpponent(studentElo)
    personaRef.current = p
    setPersona(p)
    setOutcome(null)
    outOfBookRef.current = false
    bookExitCpRef.current = null
    evalBusyRef.current = false
    setInBook(true)
    setBusy(false)
    setBadge(null)
    const line = randomLine(course)
    const booked = [...course.trunk, ...line.moves]
    bookedRef.current = booked
    bookedIdxRef.current = 0
    const g = new Chess()
    gameRef.current = g
    for (const san of course.trunk) {
      try {
        if (!g.move(san)) break
      } catch {
        break
      }
    }
    bookedIdxRef.current = course.trunk.length
    setFen(g.fen())
    setLastMove(null)
    setPhase('playing')
    playSound('click', soundOn)
    if (g.turn() === course.side) {
      setStatus(`Your move — you have ${course.side === 'w' ? 'White' : 'Black'}. ${booked.length - bookedIdxRef.current} book moves ahead.`)
    } else {
      setStatus(`${p.name} is thinking…`)
      botMove()
    }
  }, [botMove, course, soundOn, studentElo])

  const onPlayerMove = useCallback((from: Square, to: Square, promotion?: string) => {
    const g = gameRef.current
    if (phase !== 'playing' || busy) return
    const fenBefore = g.fen()
    let playedSan: string | null = null
    let playedFrom = from as string
    let playedTo = to as string
    try {
      const mv = g.move({ from, to, promotion: promotion || 'q' })
      if (mv) {
        playedSan = mv.san
        playedFrom = mv.from
        playedTo = mv.to
      }
    } catch {
      playedSan = null
    }
    if (!playedSan) return
    setFen(g.fen())
    setLastMove({ from: playedFrom, to: playedTo })
    playSound('move', soundOn)

    // Track the booked line: the student may follow it, deviate from it, or
    // finish it — all three leave book at a defined position.
    if (!outOfBookRef.current) {
      const expected = bookedRef.current[bookedIdxRef.current]
      if (expected && playedSan.replace(/[+#]/g, '') === expected.replace(/[+#]/g, '')) {
        bookedIdxRef.current++
        if (bookedIdxRef.current >= bookedRef.current.length) {
          outOfBookRef.current = true
          setInBook(false)
          setStatus('Out of book — now it is real chess. Play on!')
        } else {
          setStatus(`Book move. ${bookedRef.current.length - bookedIdxRef.current} left in the line.`)
        }
      } else {
        outOfBookRef.current = true
        setInBook(false)
        setStatus('You left your line — now it is real chess. Play on!')
      }
      if (outOfBookRef.current && bookExitCpRef.current == null && !evalBusyRef.current) {
        // Eval the book-exit position in the background; the game never waits.
        evalBusyRef.current = true
        void evalFen(g.fen(), 16).then((cp) => {
          if (bookExitCpRef.current == null && cp != null) bookExitCpRef.current = cp
          evalBusyRef.current = false
        })
      }
    } else {
      setStatus('Your move.')
    }
    if (outOfBookRef.current) {
      // P2 prefetch: warm the explorer for the reply position now, while the
      // badge hold runs — the bot's later request rides the same cache entry.
      void explorerReply(g.fen(), personaRef.current?.elo ?? studentElo)
    }

    const term = terminalReason(g)
    if (term) {
      void endGame(term)
      return
    }
    if (g.history().length >= MAX_HALFMOVES) {
      void endGame('Game called: move limit reached.')
      return
    }
    // Badge pipeline (deep-dive P5): inside the booked line every student
    // move is simply "book"; after the line, the engine classifies the move
    // and the opponent WAITS for the badge (their annotation hold), on top
    // of the same 500 ms reply floor.
    const gen = genRef.current
    const plyNo = g.history().length
    const badgeKey = gen * 10_000 + plyNo
    if (!outOfBookRef.current) {
      setBadge({ label: 'book', san: playedSan, key: badgeKey })
      botMove()
      return
    }
    setBadge(null)
    void (async () => {
      const classify: Promise<BadgeResult | null> = classifyStudentMove({
        fenBefore,
        san: playedSan,
        color: course.side,
        ply: plyNo,
      })
      const floor = new Promise<void>((r) => setTimeout(r, BOT_DELAY_MS))
      const cap = new Promise<BadgeResult | null>((r) => setTimeout(() => r(null), 1500))
      const [result] = await Promise.all([Promise.race([classify, cap]), floor])
      if (gen !== genRef.current) return
      if (result) setBadge({ label: result.label, san: playedSan, key: badgeKey })
      botMove()
    })()
  }, [botMove, busy, endGame, evalFen, phase, soundOn, course.side, studentElo])

  const resign = useCallback(() => {
    if (phase !== 'playing') return
    void endGame('You resigned.', 'loss')
  }, [endGame, phase])

  const overall = useMemo(() => {
    // Honest header line: what this mode is.
    return `${course.name} · ranked games`
  }, [course.name])

  /* ------------------------------ intro ------------------------------ */
  if (phase === 'intro') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-3 py-8 text-center">
        <button onClick={onExit} className="mb-6 flex items-center gap-1 self-start text-sm font-bold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {course.name}
        </button>
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 font-display text-xl font-extrabold text-primary">
          <Swords className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="mt-3 font-display text-2xl font-extrabold">Arena</h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          Play your {course.name} lines against a real opponent pool: every reply is a move club players actually chose at that level.
          Leave the line and it becomes real chess. Elo moves only on wins and losses.
        </p>
        <div className="mt-5 w-full rounded-xl border bg-card p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Your arena rating</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{studentElo}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Games played</span>
            <span className="font-bold tabular-nums">{loadRatings().arenaAttempts}</span>
          </div>
        </div>
        <Button size="lg" className="mt-5 w-full" onClick={startGame}>
          <Swords className="mr-2 h-4 w-4" /> Play a ranked game
        </Button>
        <Button variant="secondary" className="mt-2 w-full" onClick={onExit}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to repertoires
        </Button>
      </div>
    )
  }

  /* ------------------------------ over ------------------------------ */
  if (phase === 'over' && outcome && persona) {
    const won = outcome.result === 'win'
    const draw = outcome.result === 'draw'
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-3 py-8 text-center">
        <div className={cn(
          'flex h-16 w-16 items-center justify-center rounded-2xl',
          won ? 'bg-emerald-500/15' : draw ? 'bg-amber-500/15' : 'bg-red-500/15',
        )}>
          <Trophy className={cn('h-7 w-7', won ? 'text-emerald-500' : draw ? 'text-amber-500' : 'text-red-400')} aria-hidden />
        </div>
        <h2 className="mt-3 font-display text-2xl font-extrabold">
          {won ? 'You won!' : draw ? 'A draw.' : `${persona.name} won.`}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{outcome.reason} · {outcome.moves} moves</p>

        <div className="mt-5 w-full rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Opponent</span>
            <span className="font-bold">{persona.name} · {persona.elo}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Rating change</span>
            <span className={cn(
              'font-display text-lg font-extrabold tabular-nums',
              outcome.eloChange > 0 ? 'text-emerald-600 dark:text-emerald-400' : outcome.eloChange < 0 ? 'text-red-500' : 'text-muted-foreground',
            )}>
              {outcome.eloChange > 0 ? '+' : ''}{outcome.eloChange} → {studentElo}
            </span>
          </div>
          {outcome.bookExitCp != null && (
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Eval out of book → final</span>
              <span className="tabular-nums font-bold">
                {fmtCp(outcome.bookExitCp)} → {fmtCp(outcome.finalCp)}
              </span>
            </div>
          )}
          {outcome.result === 'draw' && (
            <p className="mt-2 text-xs text-muted-foreground">Draws keep the rating exactly where it is — the same rule the original arena uses.</p>
          )}
        </div>

        <Button size="lg" className="mt-5 w-full" onClick={startGame}>
          <Swords className="mr-2 h-4 w-4" /> Next opponent
        </Button>
        <Button variant="secondary" className="mt-2 w-full" onClick={onExit}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to repertoires
        </Button>
      </div>
    )
  }

  /* ------------------------------ playing ------------------------------ */
  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-4 pb-24 sm:px-4 lg:pb-8">
      {/* match strip */}
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-xs font-extrabold text-stone-100" aria-hidden>
            {persona?.initials ?? '??'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{persona?.name ?? 'Opponent'}</div>
            <div className="text-[11px] text-muted-foreground">Arena rating {persona?.elo ?? '—'}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-1 font-extrabold', inBook ? 'bg-primary/15 text-primary' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
            {inBook ? 'In book' : 'Out of book'}
          </span>
          <span className="rounded-full bg-accent/60 px-2 py-1 font-extrabold tabular-nums">You · {studentElo}</span>
        </div>
      </div>

      <ChessBoard
        fen={fen}
        orientation={course.side}
        onMove={onPlayerMove}
        interactive={phase === 'playing' && !busy}
        movableSide={course.side}
        lastMove={lastMove}
        showCoords={showCoords}
        theme={boardTheme}
        className="h-full w-full"
      />

      {/* status strip */}
      <div className="mt-2 flex min-h-10 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-border/60">
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-label="Opponent is replying" />
        ) : (
          <Flame className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate" aria-live="polite">{status || '…'}</span>
        {badge && (
          <span key={badge.key} className="flex shrink-0 items-center gap-1.5" aria-label={`Your move ${badge.san}: ${LABEL_META[badge.label].text}`}>
            <span className="hidden text-xs text-muted-foreground sm:inline">{badge.san}</span>
            <span
              className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold leading-none text-white"
              style={{ backgroundColor: LABEL_META[badge.label].color }}
              title={LABEL_META[badge.label].meaning}
            >
              {LABEL_META[badge.label].glyph}
            </span>
          </span>
        )}
        {!badge && busy && !inBook && <span className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-muted-foreground/30" aria-hidden />}
        <Button variant="secondary" size="sm" onClick={resign} disabled={busy} title="Resign the game">
          <ShieldQuestion className="h-3.5 w-3.5" aria-label="Resign" />
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">{overall} · replies are popularity-weighted real games ({studentElo < 1600 ? 'blitz+rapid' : 'all speeds'})</p>
    </div>
  )
}
