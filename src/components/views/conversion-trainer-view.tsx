'use client'

/**
 * Conversion Trainer — technique drills from engine-verified winning
 * positions (chessigma's Conversion Trainer ported to chessx's honesty
 * standard; RE report §8.4).
 *
 * Premise: every position is proven winning (+3.0..+9.0 Stockfish, no forced
 * mates) BEFORE you ever see it. You take the winning side against full
 * engine defense and must CONVERT — the exact skill that turns "won" games
 * into points and that tactics training never teaches.
 *
 * Honest rules, visible up front:
 *   - Converted: checkmate, or the engine's advantage collapses (they crack),
 *     or you still hold >= +3.0 after 30 of your moves.
 *   - Blew it: your advantage (engine-measured) drops under +1.0.
 *   - Draw: stalemate / repetition / 50-move while still ahead.
 * Per-move you get an advantage-kept chip (kept / leaked / slipped / lost)
 * computed from engine eval deltas — never vibes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Trophy, XCircle, Scale, Lightbulb, RotateCcw, TrendingUp, Shield, Flag } from 'lucide-react'

type Phase = 'intro' | 'playing' | 'thinking' | 'done'

interface PlyRecord {
  san: string
  byUser: boolean
  fenAfter: string
}

interface Position {
  id: string
  fen: string
  startEvalCp: number
  winner: 'w' | 'b'
  rating: number
  themes: string[]
}

interface Stats {
  attempts: number
  converted: number
  blew: number
  draws: number
  streak: number
  bestStreak: number
}

interface Attempt {
  result: 'converted' | 'blew' | 'draw'
  reason: string
  peakCp: number
  finalCp: number
  plies: number
  modelLine: string[]
}

const STATS_KEY = 'chessx.conversion.stats'
const RECENT_KEY = 'chessx.conversion.recent'

const KEEP_BANDS = [
  { max: 60, label: 'kept', color: 'text-emerald-600' },
  { max: 180, label: 'leaked', color: 'text-yellow-600' },
  { max: 350, label: 'slipped', color: 'text-orange-600' },
  { max: Infinity, label: 'lost', color: 'text-red-600' },
]

function bandFor(delta: number): { band: string; color: string } {
  const b = KEEP_BANDS.find((x) => delta < x.max) ?? KEEP_BANDS[KEEP_BANDS.length - 1]
  return { band: b.label, color: b.color }
}

const BLOW_THRESHOLD_CP = 100 // below +1.0 the win is gone
const CONVERT_CP = 850 // engine says the defense is collapsing
const MAX_USER_MOVES = 30

function loadStats(): Stats {
  if (typeof window === 'undefined') return { attempts: 0, converted: 0, blew: 0, draws: 0, streak: 0, bestStreak: 0 }
  try {
    const raw = window.localStorage.getItem(STATS_KEY)
    if (raw) return JSON.parse(raw) as Stats
  } catch {
    /* corrupt state -> fresh */
  }
  return { attempts: 0, converted: 0, blew: 0, draws: 0, streak: 0, bestStreak: 0 }
}

function saveStats(s: Stats): void {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

function loadRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (raw) return JSON.parse(raw) as string[]
  } catch {
    /* ignore */
  }
  return []
}

function pushRecent(id: string): void {
  const recent = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 12)
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    /* private mode */
  }
}

function cpLabel(cp: number): string {
  const pawns = cp / 100
  if (Math.abs(pawns) >= 8.5) return '#'
  return (pawns > 0 ? '+' : '') + pawns.toFixed(1)
}

export function ConversionTrainerView() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [stats, setStats] = useState<Stats>({ attempts: 0, converted: 0, blew: 0, draws: 0, streak: 0, bestStreak: 0 })
  const [position, setPosition] = useState<Position | null>(null)
  const [fen, setFen] = useState('')
  const [evalCp, setEvalCp] = useState<number | null>(null) // user's perspective
  const [peakCp, setPeakCp] = useState(0)
  const [lastDelta, setLastDelta] = useState<{ band: string; color: string; from: number; to: number } | null>(null)
  const [userMoves, setUserMoves] = useState(0)
  const [plies, setPlies] = useState<PlyRecord[]>([])
  const [hintArrow, setHintArrow] = useState<Arrow[] | null>(null)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const gameRef = useRef<Chess>(new Chess())
  const settledRef = useRef(false)

  useEffect(() => {
    setStats(loadStats())
  }, [])

  const userColor = position?.winner ?? 'w'

  /** Evaluate the CURRENT position; returns cp from the USER's perspective. */
  const measure = useCallback(async (currentFen: string): Promise<number | null> => {
    try {
      const res = await fetch('/api/engine/eval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, depth: 12 }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { scoreCp: number; mate: number | null }
      const turn = new Chess(currentFen).turn()
      const stmCp = data.mate !== null ? (data.mate > 0 ? 10000 : -10000) : data.scoreCp
      return turn === userColor ? stmCp : -stmCp
    } catch {
      return null
    }
  }, [userColor])

  const finish = useCallback(
    async (result: Attempt['result'], reason: string, finalCp: number) => {
      if (settledRef.current) return
      settledRef.current = true
      const pliesSoFar = plies.length
      let modelLine: string[] = []
      try {
        const res = await fetch('/api/conversion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: position?.id, result, plies: pliesSoFar }),
        })
        if (res.ok) {
          const data = (await res.json()) as { modelLine?: string[] }
          modelLine = data.modelLine ?? []
        }
      } catch {
        /* offline: summary still shows local truth */
      }
      setAttempt({
        result,
        reason,
        peakCp,
        finalCp,
        plies: pliesSoFar,
        modelLine,
      })
      setStats((prev) => {
        const next: Stats = {
          attempts: prev.attempts + 1,
          converted: prev.converted + (result === 'converted' ? 1 : 0),
          blew: prev.blew + (result === 'blew' ? 1 : 0),
          draws: prev.draws + (result === 'draw' ? 1 : 0),
          streak: result === 'converted' ? prev.streak + 1 : 0,
          bestStreak: Math.max(prev.bestStreak, result === 'converted' ? prev.streak + 1 : 0),
        }
        saveStats(next)
        return next
      })
      setPhase('done')
    },
    [peakCp, plies.length, position?.id],
  )

  const engineReply = useCallback(
    async (currentFen: string) => {
      setPhase('thinking')
      try {
        const res = await fetch('/api/engine/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fen: currentFen, skill: 20, depth: 13, minTime: 300 }),
        })
        if (!res.ok) throw new Error('engine unavailable')
        const data = (await res.json()) as { uci: string; san: string }
        const game = gameRef.current
        game.move({ from: data.uci.slice(0, 2), to: data.uci.slice(2, 4), promotion: data.uci[4] || undefined })
        const after = game.fen()
        setFen(after)
        setPlies((p) => [...p, { san: data.san, byUser: false, fenAfter: after }])

        if (game.isGameOver()) {
          // Checkmate BY the engine from a winning position = blew it.
          if (game.isCheckmate()) {
            await finish('blew', 'You got checkmated — the win slipped all the way away.', -10000)
            return
          }
          await finish('draw', game.isStalemate() ? 'Stalemate — the classic converted-to-nothing trap.' : 'Draw rule reached (50-move / repetition).', 0)
          return
        }

        // Measure AFTER the engine's reply (user to move) — straight user POV.
        const cp = await measure(after)
        if (cp !== null) {
          setEvalCp(cp)
          setPeakCp((pk) => Math.max(pk, cp))
          if (evalCp !== null) {
            const delta = Math.max(0, evalCp - cp)
            const { band, color } = bandFor(delta)
            setLastDelta({ band, color, from: evalCp, to: cp })
          }
          if (cp < BLOW_THRESHOLD_CP) {
            await finish('blew', `Your advantage fell to ${cpLabel(cp)} — under the +1.0 line. The win was yours; technique lost it.`, cp)
            return
          }
          if (cp >= CONVERT_CP) {
            await finish('converted', `The defense collapsed (${cpLabel(cp)}) — resignation territory.`, cp)
            return
          }
          // Held the technique: 30 of your moves survived with the win intact.
          if (userMoves + 1 >= MAX_USER_MOVES && cp >= 300) {
            await finish('converted', `You held ≥ +3.0 for ${MAX_USER_MOVES} moves against best defense — technique proven.`, cp)
            return
          }
        }
        setPhase('playing')
      } catch {
        setError('The engine could not answer — retry the session in a moment.')
        setPhase('playing')
      }
    },
    [finish, measure, evalCp, userMoves],
  )

  const onUserMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'playing' || settledRef.current) return
      const game = gameRef.current
      try {
        game.move({ from, to, promotion: promotion || 'q' })
      } catch {
        return
      }
      const after = game.fen()
      setFen(after)
      setHintArrow(null)
      setPlies((p) => [...p, { san: game.history().slice(-1)[0] ?? '', byUser: true, fenAfter: after }])
      setUserMoves((n) => n + 1)

      if (game.isGameOver()) {
        if (game.isCheckmate()) {
          const cp = await measure(after)
          await finish('converted', 'Checkmate — the point is banked.', cp ?? 10000)
          return
        }
        await finish('draw', game.isStalemate() ? 'You stalemated the defender — half a point from a won game.' : 'Draw rule reached.', 0)
        return
      }

      await engineReply(after)
    },
    [phase, measure, finish, engineReply],
  )

  const start = useCallback(async () => {
    setError(null)
    setBusy(true)
    settledRef.current = false
    setAttempt(null)
    setPlies([])
    setUserMoves(0)
    setEvalCp(null)
    setPeakCp(0)
    setLastDelta(null)
    setHintArrow(null)
    setHintsUsed(0)
    try {
      const qs = loadRecent().length ? `?exclude=${encodeURIComponent(loadRecent().slice(0, 6).join(','))}` : ''
      const res = await fetch(`/api/conversion${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('pool unavailable')
      const pos = (await res.json()) as Position
      setPosition(pos)
      pushRecent(pos.id)
      const game = new Chess(pos.fen)
      gameRef.current = game
      setFen(pos.fen)
      setEvalCp(pos.startEvalCp)
      setPeakCp(pos.startEvalCp)
      setPhase('playing')
    } catch {
      setError('Could not load a position — the conversion pool is still building. Try again shortly.')
    } finally {
      setBusy(false)
    }
  }, [])

  const showHint = useCallback(async () => {
    if (phase !== 'playing') return
    setHintsUsed((n) => n + 1)
    try {
      const res = await fetch('/api/engine/eval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fen: gameRef.current.fen(), depth: 14 }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { bestSan: string | null }
      const bestSan = data.bestSan
      if (!bestSan) return
      const probe = new Chess(gameRef.current.fen())
      const mv = probe.move(bestSan)
      if (mv) setHintArrow([{ from: mv.from as string, to: mv.to as string, color: 'green' }])
    } catch {
      /* hint is best-effort */
    }
  }, [phase])

  const resign = useCallback(async () => {
    if (phase !== 'playing' && phase !== 'thinking') return
    await finish('blew', 'You resigned a winning position — the worst conversion of all.', evalCp ?? 0)
  }, [phase, finish, evalCp])

  const evalPct = useMemo(() => {
    // Map user eval [-2, +10] to a 4-100% bar (winning side).
    if (evalCp === null) return 50
    const clamped = Math.max(-200, Math.min(1000, evalCp))
    return Math.round(4 + ((clamped + 200) / 1200) * 96)
  }, [evalCp])

  const intro = (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950">
          <TrendingUp className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conversion Trainer</h1>
          <p className="text-sm text-muted-foreground">Winning is a position. Converting is a skill.</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Every position here is <strong className="text-foreground">proven winning by Stockfish</strong> (+3.0 or better,
        no forced mates — real technique, not one tactic). You take the winning side against full engine defense.
        Keep the advantage until the defender cracks. Let it drop under +1.0 and the win is gone — exactly like a real game.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Attempts', value: stats.attempts, icon: Flag },
          { label: 'Converted', value: stats.converted, icon: Trophy },
          { label: 'Blew it', value: stats.blew, icon: XCircle },
          { label: 'Best streak', value: stats.bestStreak, icon: Shield },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4 text-center">
            <s.icon className="mx-auto h-4 w-4 text-muted-foreground" />
            <div className="mt-1 text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {stats.streak > 0 && (
        <Badge variant="secondary" className="w-full justify-center py-1.5">
          <Trophy className="mr-1.5 h-3.5 w-3.5" /> current streak: {stats.streak}
        </Badge>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <Button size="lg" className="w-full" onClick={start} disabled={busy}>
        {busy ? 'Loading position…' : 'Convert a winning position'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Positions: real master games, engine-verified. Rating {position?.rating ? `≈ ${position.rating}` : 'varies'} · themes: {position?.themes?.join(', ') || 'material, endgame, advantage'}
      </p>
    </div>
  )

  const boardArea = (
    <div className="mx-auto w-full max-w-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            You convert <strong className="text-foreground">{userColor === 'w' ? 'White' : 'Black'}</strong> vs engine ·{' '}
            <span className="tabular-nums">move {userMoves + 1}/{MAX_USER_MOVES}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={showHint} disabled={phase !== 'playing'}>
            <Lightbulb className="mr-1 h-4 w-4" /> Hint{hintsUsed > 0 ? ` (${hintsUsed})` : ''}
          </Button>
          <Button variant="outline" size="sm" onClick={resign} disabled={phase !== 'playing' && phase !== 'thinking'}>
            <Flag className="mr-1 h-4 w-4" /> Resign
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{evalCp !== null ? cpLabel(evalCp) : '…'}</span>
        <Progress value={evalPct} className="h-2 flex-1" />
        <span className="w-16 text-xs tabular-nums text-muted-foreground">peak {cpLabel(peakCp)}</span>
      </div>
      {lastDelta && (
        <div className={`text-center text-xs font-medium ${lastDelta.color}`}>
          advantage {lastDelta.band}: {cpLabel(lastDelta.from)} → {cpLabel(lastDelta.to)}
        </div>
      )}

      <ChessBoard
        fen={fen}
        orientation={userColor}
        interactive={phase === 'playing'}
        movableSide={userColor}
        onMove={onUserMove}
        arrows={hintArrow ?? undefined}
        showCoords
        showLegal
        animateTargets
      />

      <div className="rounded-xl border bg-card p-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Rules of this drill</div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• Converted: mate, the defense collapses (≥ +8.5), or ≥ +3.0 still holds after move 30.</li>
          <li>• Blew it: your engine-measured advantage falls under +1.0.</li>
          <li>• No takebacks — technique means living with your moves.</li>
        </ul>
      </div>

      {plies.length > 0 && (
        <>
          <Separator />
          <ScrollArea className="h-24 rounded-lg border bg-card p-2">
            <div className="text-xs leading-6 tabular-nums">
              {plies.map((p, i) =>
                p.byUser ? (
                  <span key={i}>
                    <strong>{Math.floor(i / 2) + 1}.</strong> {p.san}{' '}
                  </span>
                ) : (
                  <span key={i}>{p.san} </span>
                ),
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )

  const summary = attempt && (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div
        className={`rounded-2xl border p-6 text-center ${
          attempt.result === 'converted'
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
            : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
        }`}
      >
        {attempt.result === 'converted' ? (
          <Trophy className="mx-auto h-10 w-10 text-emerald-600" />
        ) : attempt.result === 'draw' ? (
          <Scale className="mx-auto h-10 w-10 text-yellow-600" />
        ) : (
          <XCircle className="mx-auto h-10 w-10 text-red-600" />
        )}
        <h2 className="mt-2 text-xl font-bold">
          {attempt.result === 'converted' ? 'Converted.' : attempt.result === 'draw' ? 'Half a point.' : 'The win slipped away.'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{attempt.reason}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="font-bold tabular-nums">{cpLabel(attempt.peakCp)}</div>
            <div className="text-xs text-muted-foreground">peak advantage</div>
          </div>
          <div>
            <div className="font-bold tabular-nums">{cpLabel(attempt.finalCp)}</div>
            <div className="text-xs text-muted-foreground">final</div>
          </div>
          <div>
            <div className="font-bold tabular-nums">{Math.ceil(attempt.plies / 2)}</div>
            <div className="text-xs text-muted-foreground">moves defended</div>
          </div>
        </div>
      </div>

      {attempt.modelLine.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Model line (engine, from the start)</div>
          <div className="text-sm font-medium tabular-nums">{attempt.modelLine.join(' ')}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={start} disabled={busy}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Next position
        </Button>
        <Button variant="outline" onClick={() => setPhase('intro')}>
          Back to overview
        </Button>
      </div>
    </div>
  )

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      {phase === 'intro' && intro}
      {(phase === 'playing' || phase === 'thinking') && boardArea}
      {phase === 'done' && summary}
      {phase === 'thinking' && (
        <p className="mt-3 text-center text-xs text-muted-foreground">engine defending…</p>
      )}
    </div>
  )
}
