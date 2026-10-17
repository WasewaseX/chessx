'use client'
// The Woodpecker Method: one fixed puzzle set, replayed cycle after cycle,
// each cycle faster (and at least as accurate) than the last — until the
// patterns are automatic. The set composition is fixed per theme+size, the
// timer and the unlock rule make the repetition honest, and every move is
// graded server-side: no solution ever reaches the client before it is earned.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { Button } from '@/components/ui/button'
import { Loader2, Play, RotateCcw, Timer, Target } from 'lucide-react'
import { PUZZLE_THEMES, humanizeTheme, type PublicPuzzle } from '@/content/schema'
import { cn } from '@/lib/utils'
import { readJson } from '@/lib/api-client'

type Phase = 'idle' | 'running' | 'done'

interface SetSummary {
  id: string
  theme: string
  size: number
  cycle: number
  bestMs: number | null
  bestAccuracy: number | null
}

interface WoodpeckerPuzzle {
  id: string
  fen: string
  rating: number
  themes: string[]
}

const SET_SIZES = [12, 20, 30] as const

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function WoodpeckerPanel({ poolThemes }: { poolThemes?: string[] }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [theme, setTheme] = useState<string>('fork')
  const [size, setSize] = useState<number>(12)
  const [summary, setSummary] = useState<SetSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ms: number; accuracy: number; solved: number; total: number; unlocked: boolean; cycle: number } | null>(null)

  // run state
  const [puzzles, setPuzzles] = useState<WoodpeckerPuzzle[]>([])
  const [idx, setIdx] = useState(0)
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [solvedCount, setSolvedCount] = useState(0)
  const [missCount, setMissCount] = useState(0)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const gameRef = useRef(new Chess())
  const playedRef = useRef<string[]>([])
  const busyRef = useRef(false)
  const startedAtRef = useRef(0)
  const [elapsed, setElapsed] = useState(0)

  const themes = useMemo(() => {
    const base = poolThemes && poolThemes.length ? poolThemes : Object.keys(PUZZLE_THEMES)
    return base.slice(0, 24)
  }, [poolThemes])

  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 250)
    return () => clearInterval(t)
  }, [phase])

  useEffect(() => {
    // existing set stats for the chosen theme+size
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/puzzles/woodpecker', { cache: 'no-store' })
        const d = await readJson<{ sets: SetSummary[] }>(res)
        if (alive && d?.sets) {
          const mine = d.sets.find((s) => s.theme === theme && s.size === size) ?? null
          setSummary(mine)
        }
      } catch {
        /* stats are a nicety */
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [theme, size])

  const start = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/puzzles/woodpecker?theme=${encodeURIComponent(theme)}&size=${size}`, { cache: 'no-store' })
      const d = await readJson<{ puzzles?: WoodpeckerPuzzle[]; cycle?: number; bestMs?: number | null; bestAccuracy?: number | null; error?: string }>(res)
      if (!res.ok || !d?.puzzles?.length) {
        setError(d?.error ?? 'Could not build a set for that theme.')
        return
      }
      setSummary({ id: '', theme, size: d.puzzles.length, cycle: d.cycle ?? 1, bestMs: d.bestMs ?? null, bestAccuracy: d.bestAccuracy ?? null })
      setPuzzles(d.puzzles)
      setIdx(0)
      setSolvedCount(0)
      setMissCount(0)
      setResult(null)
      startedAtRef.current = Date.now()
      setElapsed(0)
      loadPuzzle(d.puzzles[0])
      setPhase('running')
    } catch {
      setError('The set could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [theme, size])

  const loadPuzzle = useCallback((p: WoodpeckerPuzzle) => {
    const g = new Chess(p.fen)
    const turn = g.turn()
    gameRef.current = g
    playedRef.current = []
    setFen(p.fen)
    setOrientation(turn)
    setLastMove(null)
  }, [])

  const finish = useCallback(async (solved: number, total: number, misses: number) => {
    const ms = Date.now() - startedAtRef.current
    const accuracy = total > 0 ? Math.round((solved / total) * 1000) / 10 : 0
    setPhase('done')
    try {
      const res = await fetch('/api/puzzles/woodpecker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, ms, accuracy, solved, total }),
      })
      const d = await readJson<{ unlocked?: boolean; cycle?: number }>(res)
      setResult({ ms, accuracy, solved, total: total + misses, unlocked: d?.unlocked ?? false, cycle: d?.cycle ?? 1 })
    } catch {
      setResult({ ms, accuracy, solved, total: total + misses, unlocked: false, cycle: 1 })
    }
    void misses
  }, [theme])

  const onMove = useCallback((from: Square, to: Square, promotion?: string) => {
    if (phase !== 'running' || busyRef.current) return
    const current = puzzles[idx]
    if (!current) return
    const g = gameRef.current
    let mv
    try {
      mv = g.move({ from, to, ...(promotion ? { promotion } : {}) })
    } catch {
      return
    }
    if (!mv) return
    playedRef.current.push(mv.san)
    busyRef.current = true
    void (async () => {
      try {
        const res = await fetch('/api/puzzles/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ puzzleId: current.id, played: playedRef.current }),
        })
        const v = await readJson<{ correct?: boolean; reply?: string | null; scriptDone?: boolean; hintFrom?: string | null }>(res)
        if (!res.ok || !v) {
          // network hiccup: take the move back rather than corrupt the cycle
          playedRef.current.pop()
          g.undo()
          setFen(g.fen())
          return
        }
        if (!v.correct) {
          playedRef.current.pop()
          g.undo()
          setMissCount((m) => m + 1)
          setFlashes([{ square: (v.hintFrom ?? from) as string, color: 'red' } as FlashMark])
          setTimeout(() => setFlashes([]), 1400)
          setFen(g.fen())
          return
        }
        setFen(g.fen())
        setLastMove({ from: mv.from, to: mv.to })
        if (v.reply) {
          setTimeout(() => {
            try {
              const reply = gameRef.current.move(v.reply as string)
              setFen(gameRef.current.fen())
              setLastMove({ from: reply.from, to: reply.to })
            } catch {
              setFen(gameRef.current.fen())
            }
          }, 320)
        }
        if (v.scriptDone) {
          const next = idx + 1
          const solved = solvedCount + 1
          setSolvedCount(solved)
          if (next >= puzzles.length) {
            await finish(solved, puzzles.length, missCount)
          } else {
            setTimeout(() => {
              setIdx(next)
              loadPuzzle(puzzles[next])
            }, v.reply ? 650 : 300)
          }
        }
      } finally {
        busyRef.current = false
      }
    })()
  }, [phase, puzzles, idx, solvedCount, missCount, loadPuzzle, finish])

  const current = puzzles[idx]

  if (phase === 'running' && current) {
    const total = puzzles.length
    return (
      <div className="mb-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-mono text-2xl font-bold tabular-nums" aria-live="off">
              <Timer className="h-4 w-4 text-muted-foreground" aria-hidden /> {fmtClock(elapsed)}
            </div>
            <div className="text-sm font-semibold text-muted-foreground">
              {idx + 1} / {total} · <Target className="inline h-3.5 w-3.5" aria-hidden /> {solvedCount} solved{missCount > 0 ? ` · ${missCount} miss${missCount === 1 ? '' : 'es'}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {humanizeTheme(theme)} · cycle {summary?.cycle ?? 1}
            </span>
            <Button variant="secondary" size="sm" onClick={() => { setPhase('idle') }} aria-label="Abandon this cycle">
              Stop
            </Button>
          </div>
        </div>
        <div className="mx-auto mt-3 w-full max-w-[560px]">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            onMove={onMove}
            movableSide={orientation}
            interactive
            lastMove={lastMove}
            flashes={flashes}
            showLegal
          />
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">Solve the whole set, then beat the clock. One miss costs accuracy, not the cycle.</p>
      </div>
    )
  }

  if (phase === 'done' && result) {
    return (
      <div className="mb-2 rounded-xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Cycle {result.cycle} complete</div>
        <div className="mt-1 font-mono text-4xl font-extrabold tabular-nums">{fmtClock(result.ms)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {result.solved}/{result.total} solved · {result.accuracy}% accuracy
        </div>
        <div
          className={cn(
            'mx-auto mt-3 max-w-sm rounded-lg px-3 py-2 text-sm font-semibold',
            result.unlocked ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground',
          )}
          role="status"
        >
          {result.unlocked
            ? `Cycle ${result.cycle + 1} unlocked — faster than your best.`
            : `Repeat the cycle: unlock needs a faster time than ${summary?.bestMs != null ? fmtClock(summary.bestMs) : 'your best'} and equal accuracy.`}
        </div>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={start} disabled={loading} className="min-h-11">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            {result.unlocked ? 'Start next cycle' : 'Repeat cycle'}
          </Button>
          <Button variant="secondary" onClick={() => setPhase('idle')} className="min-h-11">Change set</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Woodpecker method</div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        A fixed set of real Lichess puzzles, solved repeatedly in ever-faster cycles until the patterns are automatic. The next cycle unlocks only when you are faster and at least as accurate.
      </p>

      <div className="mt-3" role="group" aria-label="Choose a theme">
        <div className="flex flex-wrap gap-1.5">
          {themes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              className={cn(
                'inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition active:scale-95',
                theme === t ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {humanizeTheme(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Set size">
          {SET_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSize(n)}
              aria-pressed={size === n}
              className={cn(
                'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-bold transition active:scale-95',
                size === n ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {summary && (
          <div className="text-xs text-muted-foreground">
            Cycle {summary.cycle} · best {summary.bestMs != null ? fmtClock(summary.bestMs) : '—'} · {summary.bestAccuracy != null ? `${Math.round(summary.bestAccuracy)}%` : '—'}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-destructive">{error}</p>}

      <Button onClick={start} disabled={loading} className="mt-3 min-h-11 w-full sm:w-auto">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        Start cycle
      </Button>
    </div>
  )
}

/** Kept for callers that want a light type re-export. */
export type { PublicPuzzle }

// ---------------------------------------------------------------------------
// The rated leaderboard: top solvers by puzzle Elo, ranked the way chess.com
// ranks puzzles. The caller's own row is highlighted; the header carries the
// honest proof line that the Lichess bank is really installed.
// ---------------------------------------------------------------------------

interface LeaderRow {
  rank: number
  name: string
  rating: number
  solved: number
}

export function PuzzleLeaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([])
  const [me, setMe] = useState<LeaderRow | null>(null)
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [lb, idx] = await Promise.all([
          fetch('/api/leaderboard', { cache: 'no-store' }),
          fetch('/api/puzzles/index', { cache: 'no-store' }),
        ])
        const d = await readJson<{ leaderboard?: LeaderRow[]; me?: LeaderRow | null }>(lb)
        const ix = await readJson<{ lichessTotal?: number }>(idx)
        if (!alive) return
        if (!lb.ok) {
          setState('error')
          return
        }
        setRows(d?.leaderboard ?? [])
        setMe(d?.me ?? null)
        setTotal(ix?.lichessTotal ?? 0)
        setState('ready')
      } catch {
        if (alive) setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const medal = (rank: number) => (rank === 1 ? '#f7c437' : rank === 2 ? '#c9c9c9' : rank === 3 ? '#cd7f32' : undefined)

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Leaderboard</span>
        <span className="text-[10px] text-muted-foreground">{total > 0 ? `${total.toLocaleString()} puzzles · Lichess database` : 'Rated solvers'}</span>
      </div>
      {state === 'loading' && (
        <div className="mt-3 space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-secondary/70" />
          ))}
        </div>
      )}
      {state === 'error' && <p className="mt-3 text-xs text-muted-foreground">The leaderboard could not be loaded.</p>}
      {state === 'ready' && rows.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No ranked solvers yet — be the first.</p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <ol className="mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-1 scroll-slim" aria-label="Top puzzle solvers">
          {rows.map((r) => (
            <li
              key={r.rank}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                me?.rank === r.rank && 'bg-primary/10',
              )}
            >
              <span className="w-6 shrink-0 text-center text-xs font-extrabold tabular-nums" style={medal(r.rank) ? { color: medal(r.rank) } : undefined}>
                {r.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className="shrink-0 font-mono text-xs font-bold tabular-nums">{r.rating}</span>
              <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{r.solved} solved</span>
            </li>
          ))}
        </ol>
      )}
      {state === 'ready' && me && !rows.some((r) => r.rank === me.rank) && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-sm">
          <span className="w-6 shrink-0 text-center text-xs font-extrabold tabular-nums">{me.rank}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{me.name} (you)</span>
          <span className="shrink-0 font-mono text-xs font-bold tabular-nums">{me.rating}</span>
          <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{me.solved} solved</span>
        </div>
      )}
    </div>
  )
}
