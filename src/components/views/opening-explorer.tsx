'use client'
// The Opening Explorer: play moves on the board and see what real players
// chose in the same position — percentages for White wins, draws and Black
// wins per move, plus the average rating of the games and the ECO opening
// name when one matches. Data comes from the app's own /api/tools/explorer
// proxy (Lichess's community database, cached server-side), so the browser
// never touches a third-party host.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { Button } from '@/components/ui/button'
import { Loader2, RotateCcw, ChevronLeft, Compass } from 'lucide-react'
import { readJson } from '@/lib/api-client'

interface ExplorerMove {
  uci: string
  san: string
  white: number
  draws: number
  black: number
  averageRating?: number
}

interface ExplorerPayload {
  fen: string
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  opening: { eco: string; name: string } | null
  mode?: 'explorer' | 'cloud'
  cloudDepth?: number
  cloudCp?: number | null
  cloudMate?: number | null
  cached?: boolean
  error?: string
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function OpeningExplorer() {
  const [game, setGame] = useState(() => new Chess())
  const [history, setHistory] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [payload, setPayload] = useState<ExplorerPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoverUci, setHoverUci] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fen = game.fen()

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // All state updates live inside the async IIFE: the effect body itself
    // stays free of synchronous setState (React cascade-render lint rule).
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/tools/explorer?fen=${encodeURIComponent(fen)}`, { signal: ctrl.signal })
        const d = (await res.json()) as ExplorerPayload & { error?: string }
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        setPayload(d)
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'The explorer is unreachable.')
        setPayload(null)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    })()
    return () => ctrl.abort()
  }, [fen])

  const onMove = useCallback((from: Square, to: Square, promotion?: string) => {
    setGame((prev) => {
      const clone = new Chess(prev.fen())
      try {
        const mv = clone.move({ from, to, promotion: promotion ?? 'q' })
        if (!mv) return prev
        setHistory((h) => [...h, mv.san])
        setLastMove({ from: mv.from, to: mv.to })
        return clone
      } catch {
        return prev // illegal drag: ignore, the board snaps back
      }
    })
  }, [])

  const back = useCallback(() => {
    setHistory((h) => {
      const next = h.slice(0, -1)
      const clone = new Chess()
      let last: { from: string; to: string } | null = null
      for (const san of next) {
        try {
          const mv = clone.move(san)
          if (mv) last = { from: mv.from, to: mv.to }
        } catch {
          break
        }
      }
      setGame(clone)
      setLastMove(last)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setGame(new Chess())
    setHistory([])
    setLastMove(null)
  }, [])

  const totalGames = payload ? payload.white + payload.draws + payload.black : 0
  const bestUci = payload?.moves[0]?.uci ?? null
  const cloudMode = payload?.mode === 'cloud'

  const arrows: Arrow[] = useMemo(() => {
    if (!hoverUci || hoverUci === bestUci) return []
    return [{ from: hoverUci.slice(0, 2), to: hoverUci.slice(2, 4), color: 'gray' as const }]
  }, [hoverUci, bestUci])

  const arrowBest: Arrow[] = useMemo(() => {
    if (!bestUci || hoverUci) return []
    return [{ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'green' as const }]
  }, [bestUci, hoverUci])

  const gameOver = game.isGameOver()

  return (
    <section aria-label="Opening explorer" className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <ChessBoard
          fen={fen}
          interactive={!gameOver}
          movableSide="any"
          onMove={onMove}
          lastMove={lastMove}
          arrows={[...arrowBest, ...arrows]}
          showCoords
          className="mx-auto w-full max-w-[340px]"
        />
        <div className="mt-2 flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={back} disabled={!history.length} className="min-h-11">
            <ChevronLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <Button variant="secondary" size="sm" onClick={reset} disabled={!history.length} className="min-h-11">
            <RotateCcw className="h-4 w-4" aria-hidden /> Start
          </Button>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading explorer data" />}
        </div>
        <ol className="mt-2 flex flex-wrap justify-center gap-1 text-xs text-muted-foreground" aria-label="Moves played">
          {history.map((san, i) => (
            <li key={`${san}-${i}`} className="rounded bg-secondary/70 px-1.5 py-0.5 font-mono">
              {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}
              {san}
            </li>
          ))}
        </ol>
      </div>

      <div className="min-w-0">
        {payload?.opening && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/40 px-2 py-1 text-xs">
            <Compass className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-mono font-semibold">{payload.opening.eco}</span>
            <span className="truncate">{payload.opening.name}</span>
          </div>
        )}
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {gameOver && (
          <p className="mb-2 rounded-md border border-border/50 bg-secondary/30 p-3 text-sm text-muted-foreground">
            {game.isCheckmate() ? 'Checkmate here.' : 'No legal moves left (stalemate or draw).'} Go Back or Start to explore again.
          </p>
        )}
        {payload && !gameOver && (
          <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
            {cloudMode
              ? `The community database is unreachable from this server, so this is the Lichess cloud engine's verified evaluation${payload.cloudDepth ? ` (depth ${payload.cloudDepth})` : ''}${payload.cloudMate != null ? `: mate in ${Math.abs(payload.cloudMate)}` : payload.cloudCp != null ? `: ${payload.cloudCp > 0 ? '+' : ''}${(payload.cloudCp / 100).toFixed(1)} for White` : ''}. Play moves on the board to keep exploring.`
              : `${fmt(totalGames)} games in the database at this position${payload.cached ? ' (cached)' : ''}.`}
          </p>
        )}
        <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1 scroll-slim" aria-label={cloudMode ? 'Engine lines' : 'Moves with statistics'}>
          {payload?.moves.map((m) => {
            const games = m.white + m.draws + m.black
            const pw = games ? (m.white / games) * 100 : 0
            const pd = games ? (m.draws / games) * 100 : 0
            const pb = games ? (m.black / games) * 100 : 0
            return (
              <li key={m.uci}>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const clone = new Chess(fen)
                      const mv = clone.move(m.san)
                      if (mv) {
                        setGame(clone)
                        setHistory((h) => [...h, mv.san])
                        setLastMove({ from: mv.from, to: mv.to })
                      }
                    } catch {
                      /* stale row: ignore */
                    }
                  }}
                  onMouseEnter={() => setHoverUci(m.uci)}
                  onMouseLeave={() => setHoverUci(null)}
                  className="w-full rounded-md border border-border/40 bg-background p-2 text-left transition-colors hover:border-border hover:bg-secondary/30"
                  aria-label={`Play ${m.san}: ${pw.toFixed(0)} percent White wins, ${pd.toFixed(0)} percent draws, ${pb.toFixed(0)} percent Black wins, ${fmt(games)} games`}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono font-bold">{m.san}</span>
                    {cloudMode ? (
                      <span className="text-xs text-muted-foreground">engine line</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {fmt(games)} games{m.averageRating ? ` · avg ${Math.round(m.averageRating)}` : ''}
                      </span>
                    )}
                  </div>
                  {games > 0 && (
                    <>
                      <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full" aria-hidden>
                        <div className="h-full bg-[#e8e6e3] dark:bg-[#c8c6c3]" style={{ width: `${pw}%` }} />
                        <div className="h-full bg-[#9e9c9a] dark:bg-[#7a7876]" style={{ width: `${pd}%` }} />
                        <div className="h-full bg-[#4a4846] dark:bg-[#35333f]" style={{ width: `${pb}%` }} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
                        <span>{pw.toFixed(0)}%</span>
                        <span>{pd.toFixed(0)}%</span>
                        <span>{pb.toFixed(0)}%</span>
                      </div>
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        {!payload && !error && loading && (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Asking the database what real players play here…
          </div>
        )}
      </div>
    </section>
  )
}
