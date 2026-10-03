'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { EvalBar } from '@/components/chess/eval-bar'
import { MoveList } from '@/components/chess/move-list'
import { engine } from '@/lib/chess/engine-client'
import { accuracyFromLoss } from '@/lib/rating'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Loader2, Play, Pause, ChevronLeft, ChevronRight, Sparkles, Trash2 } from 'lucide-react'

type Label = 'best' | 'brilliant' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

const LABEL_META: Record<Label, { text: string; bg: string; icon?: string }> = {
  best: { text: 'Best', bg: '#81b64c' },
  brilliant: { text: 'Brilliant', bg: '#26c2a3' },
  excellent: { text: 'Excellent', bg: '#95bb4a' },
  good: { text: 'Good', bg: '#96af8b' },
  inaccuracy: { text: 'Inaccuracy', bg: '#e6a82c' },
  mistake: { text: 'Mistake', bg: '#df8f2f' },
  blunder: { text: 'Blunder', bg: '#ca3431' },
}

interface PlyEval {
  san: string
  color: 'w' | 'b'
  /** eval before the move, white POV pawns */
  before: number
  /** eval after the move, white POV pawns */
  after: number
  bestUci: string | null
  label: Label
}

export function AnalysisView() {
  const setReviewPgn = useApp((s) => s.setReviewPgn)
  // snapshot at mount: the PGN is set right before navigating here
  const incomingPgn = useApp.getState().reviewPgn
  const [mode, setMode] = useState<'free' | 'review'>(incomingPgn ? 'review' : 'free')
  const [pgnInput, setPgnInput] = useState(incomingPgn ?? '')

  useEffect(() => {
    // clear the handoff once consumed (store update, not local state)
    if (incomingPgn) setReviewPgn(null)
  }, [incomingPgn, setReviewPgn])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Analysis</h1>
        <div className="flex overflow-hidden rounded-md border">
          {(['free', 'review'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('px-4 py-1.5 text-sm font-semibold capitalize', mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary')}
            >
              {m === 'free' ? 'Board & engine' : 'Game review'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'free' ? <FreeAnalysis /> : <GameReview initialPgn={pgnInput} onPgnChange={setPgnInput} />}
    </div>
  )
}

/* ---------------- free board + engine ---------------- */

function FreeAnalysis() {
  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(gameRef.current.fen())
  const [moves, setMoves] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [info, setInfo] = useState<{ score: number; mate: number | null; depth: number; pv: string[]; bestSan: string | null } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [showBest, setShowBest] = useState(true)
  const [fenInput, setFenInput] = useState('')
  const analysisSeq = useRef(0)

  const runAnalysis = useCallback(async (f: string) => {
    const seq = ++analysisSeq.current
    setAnalyzing(true)
    try {
      const res = await engine.eval({ fen: f, depth: 14 })
      if (seq !== analysisSeq.current) return
      const turn = new Chess(f).turn()
      const whitePov = (v: number) => (turn === 'w' ? v : -v)
      const scoreCp = res.mate != null ? (res.mate > 0 ? 100 : -100) : whitePov(res.scoreCp ?? 0)
      const mateFor = res.mate != null ? (whitePov(res.mate) > 0 ? 1 : -1) : null
      // convert pv to SAN for display
      let bestSan: string | null = null
      const g = new Chess(f)
      if (res.pv.length) {
        try {
          const pm = g.move({ from: res.pv[0].slice(0, 2), to: res.pv[0].slice(2, 4), promotion: res.pv[0].slice(4, 5) || undefined })
          bestSan = pm?.san ?? null
        } catch {
          bestSan = null
        }
      }
      setInfo({ score: scoreCp / 100, mate: mateFor, depth: res.depth, pv: res.pv, bestSan })
    } finally {
      if (seq === analysisSeq.current) setAnalyzing(false)
    }
  }, [])

  useEffect(() => {
    void runAnalysis(fen)
  }, [fen, runAnalysis])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const g = gameRef.current
      try {
        const mv = g.move({ from, to, promotion: promotion ?? undefined })
        if (!mv) return
        setFen(g.fen())
        setMoves((m) => [...m, mv.san])
        setLastMove({ from: mv.from, to: mv.to })
      } catch {
        /* illegal */
      }
    },
    [],
  )

  const game = useMemo(() => new Chess(fen), [fen])
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  const bestArrow: Arrow | null =
    showBest && info?.pv.length
      ? { from: info.pv[0].slice(0, 2), to: info.pv[0].slice(2, 4), color: 'blue' as never }
      : null

  function loadFen() {
    try {
      const g = new Chess(fenInput.trim())
      gameRef.current = g
      setFen(g.fen())
      setMoves([])
      setLastMove(null)
      setInfo(null)
    } catch {
      /* invalid FEN */
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="flex gap-2">
        <EvalBar score={info?.score ?? 0} mateFor={info?.mate ?? null} className="hidden sm:block" />
        <div className="min-w-0 flex-1">
          <ChessBoard
            fen={fen}
            onMove={onMove}
            lastMove={lastMove}
            checkSquare={checkSquare}
            arrows={bestArrow ? [bestArrow] : []}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMoves((m) => { gameRef.current.undo(); setFen(gameRef.current.fen()); setLastMove(null); return m.slice(0, -1) })} disabled={moves.length === 0}>
              <ChevronLeft className="h-4 w-4" /> Undo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                gameRef.current = new Chess()
                setFen(gameRef.current.fen())
                setMoves([])
                setLastMove(null)
                setInfo(null)
              }}
            >
              <Trash2 className="h-4 w-4" /> Reset
            </Button>
            <Button variant={showBest ? 'default' : 'secondary'} size="sm" onClick={() => setShowBest(!showBest)}>
              {showBest ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Engine arrow
            </Button>
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {info ? `depth ${info.depth} · ${info.score > 0 ? '+' : ''}${info.score.toFixed(1)}` : 'analyzing…'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Engine</div>
          {info ? (
            <>
              <div className="mt-1 font-display text-2xl font-extrabold">
                {info.mate != null ? `Mate in ${Math.abs(info.mate)}` : `${info.score > 0 ? '+' : ''}${info.score.toFixed(2)}`}
                <span className="ml-2 text-sm font-semibold text-muted-foreground">White POV</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Best: <span className="font-mono font-bold text-foreground">{info.bestSan ?? '—'}</span>
              </div>
              {info.pv.length > 1 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  PV: <span className="font-mono">{info.pv.slice(0, 6).join(' ')}</span>
                </div>
              )}
            </>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        <div className="rounded-lg bg-card shadow-sm">
          <div className="border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</div>
          <MoveList moves={moves} maxHeightClass="max-h-72" />
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Load a position</div>
          <div className="mt-2 flex gap-2">
            <Textarea
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              placeholder="Paste a FEN…"
              className="min-h-[60px] font-mono text-xs"
            />
            <Button className="btn-hero self-end" size="sm" onClick={loadFen}>
              Load
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- game review ---------------- */

function GameReview({ initialPgn, onPgnChange }: { initialPgn: string; onPgnChange: (s: string) => void }) {
  const [pgn, setPgn] = useState(initialPgn)
  const [plies, setPlies] = useState<{ san: string; color: 'w' | 'b'; fenBefore: string }[]>([])
  const [evals, setEvals] = useState<PlyEval[]>([])
  const [cursor, setCursor] = useState(-1)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const boardFenRef = useRef('')

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

  const parsePgn = useCallback((text: string) => {
    try {
      const g = new Chess()
      g.loadPgn(text)
      const history = g.history({ verbose: true })
      const fens: { san: string; color: 'w' | 'b'; fenBefore: string }[] = []
      const replay = new Chess()
      for (const h of history) {
        fens.push({ san: h.san, color: h.color, fenBefore: replay.fen() })
        replay.move(h.san)
      }
      setPlies(fens)
      setEvals([])
      setCursor(-1)
      setError(null)
      return true
    } catch {
      setError('Could not read that PGN.')
      return false
    }
  }, [])

  useEffect(() => {
    if (initialPgn) parsePgn(initialPgn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runReview = useCallback(async () => {
    if (plies.length === 0 || analyzing) return
    setAnalyzing(true)
    setProgress(0)
    const results: PlyEval[] = []
    let prevWhitePov = 0
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i]
      const gBefore = new Chess(p.fenBefore)
      // eval before the move
      const beforeRes = await engine.eval({ fen: p.fenBefore, depth: 12 })
      const turn = gBefore.turn()
      const beforeWhite = beforeRes.mate != null ? (beforeRes.mate > 0 ? 80 : -80) : ((turn === 'w' ? beforeRes.scoreCp ?? 0 : -(beforeRes.scoreCp ?? 0)) / 100)

      const gAfter = new Chess(p.fenBefore)
      gAfter.move(p.san)
      const afterRes = await engine.eval({ fen: gAfter.fen(), depth: 12 })
      const afterTurn = gAfter.turn()
      const afterWhite = afterRes.mate != null ? (afterRes.mate > 0 ? 80 : -80) : ((afterTurn === 'w' ? afterRes.scoreCp ?? 0 : -(afterRes.scoreCp ?? 0)) / 100)

      // drop from mover's POV
      const beforePov = p.color === 'w' ? beforeWhite : -beforeWhite
      const afterPov = p.color === 'w' ? afterWhite : -afterWhite
      const drop = Math.max(0, beforePov - afterPov)

      // best move check
      let isBest = false
      if (beforeRes.pv.length) {
        try {
          const test = new Chess(p.fenBefore)
          const bm = test.move({ from: beforeRes.pv[0].slice(0, 2), to: beforeRes.pv[0].slice(2, 4), promotion: beforeRes.pv[0].slice(4, 5) || undefined })
          isBest = bm?.san.replace(/[+#]/g, '') === p.san.replace(/[+#]/g, '')
        } catch {
          isBest = false
        }
      }

      // sacrifice detection: move gives up material immediately
      const moved = gBefore.get(gAfter.history({ verbose: true })[gAfter.history().length - 1]?.from as never)
      void moved
      const mv = gAfter.history({ verbose: true })[gAfter.history({ verbose: true }).length - 1]
      const pieceVals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
      const capturedVal = mv?.captured ? pieceVals[mv.captured] : 0
      const movedVal = mv ? pieceVals[mv.piece] : 0
      const immediateSac = movedVal - capturedVal >= 3

      let label: Label
      if (isBest && immediateSac && afterPov >= beforePov - 0.4) label = 'brilliant'
      else if (isBest) label = 'best'
      else if (drop < 0.15) label = 'excellent'
      else if (drop < 0.5) label = 'good'
      else if (drop < 1.2) label = 'inaccuracy'
      else if (drop < 2.5) label = 'mistake'
      else label = 'blunder'

      results.push({ san: p.san, color: p.color, before: Math.round(beforeWhite * 100) / 100, after: Math.round(afterWhite * 100) / 100, bestUci: beforeRes.pv[0] ?? null, label })
      prevWhitePov = afterWhite
      void prevWhitePov
      setEvals([...results])
      setProgress(Math.round(((i + 1) / plies.length) * 100))
    }
    setAnalyzing(false)
  }, [plies, analyzing])

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(-1, c - 1))
      if (e.key === 'ArrowRight') setCursor((c) => Math.min(plies.length - 1, c + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plies.length])

  const shownFen = cursor >= 0 && cursor < plies.length ? fenAfterPly(plies, cursor, startFen) : cursor === -1 ? startFen : startFen
  const shownLast = cursor >= 0 ? null : null
  const lastPly = cursor >= 0 ? plies[cursor] : null
  const plyEval = cursor >= 0 ? evals[cursor] : null

  const whiteLosses = evals.filter((e) => e.color === 'w').map((e) => Math.max(0, (e.color === 'w' ? e.before : -e.before) - (e.color === 'w' ? e.after : -e.after)))
  const blackLosses = evals.filter((e) => e.color === 'b').map((e) => Math.max(0, (e.color === 'b' ? -e.before : e.before) - (e.color === 'b' ? -e.after : e.after)))
  const whiteAcc = whiteLosses.length ? accuracyFromLoss(whiteLosses.reduce((a, b) => a + b, 0) / whiteLosses.length) : null
  const blackAcc = blackLosses.length ? accuracyFromLoss(blackLosses.reduce((a, b) => a + b, 0) / blackLosses.length) : null

  const counts = (color: 'w' | 'b') => {
    const c: Record<string, number> = {}
    for (const e of evals.filter((x) => x.color === color)) c[e.label] = (c[e.label] ?? 0) + 1
    return c
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        <div className="flex gap-2">
          <EvalBar score={plyEval?.after ?? 0} className="hidden sm:block" />
          <div className="min-w-0 flex-1">
            <ChessBoard
              fen={shownFen}
              interactive={false}
              lastMove={lastPly ? (shownLast ?? extractLastMove(plies, cursor)) : null}
            />
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCursor(-1)} disabled={cursor === -1}>
                Start
              </Button>
              <Button variant="secondary" size="icon" onClick={() => setCursor((c) => Math.max(-1, c - 1))} disabled={cursor === -1} aria-label="Previous move">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" onClick={() => setCursor((c) => Math.min(plies.length - 1, c + 1))} disabled={cursor >= plies.length - 1} aria-label="Next move">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCursor(plies.length - 1)} disabled={plies.length === 0}>
                End
              </Button>
            </div>
          </div>
        </div>

        {/* eval graph */}
        {evals.length > 1 && (
          <div className="mt-4 rounded-lg bg-card p-3 shadow-sm">
            <EvalGraph evals={evals} cursor={cursor} onSeek={setCursor} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {plies.length === 0 ? (
          <div className="rounded-lg bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Load a game</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Finish a game against a bot and press "Game review", or paste a PGN below.
            </p>
            <Textarea
              value={pgn}
              onChange={(e) => {
                setPgn(e.target.value)
                onPgnChange(e.target.value)
              }}
              placeholder="[Event …] 1. e4 e5 2. Nf3 …"
              className="mt-3 min-h-[120px] font-mono text-xs"
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <Button
              className="btn-hero mt-3 w-full py-2.5"
              onClick={() => parsePgn(pgn)}
              disabled={!pgn.trim()}
            >
              Load game
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review</div>
                {analyzing && (
                  <span className="text-sm font-semibold text-muted-foreground">{progress}%</span>
                )}
              </div>
              {whiteAcc != null ? (
                <div className="mt-2 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <div className="font-display text-2xl font-extrabold">{whiteAcc}%</div>
                    <div className="text-xs text-muted-foreground">White accuracy</div>
                  </div>
                  <div>
                    <div className="font-display text-2xl font-extrabold">{blackAcc}%</div>
                    <div className="text-xs text-muted-foreground">Black accuracy</div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {analyzing ? 'Evaluating every move…' : 'Press analyze to evaluate each move.'}
                </p>
              )}
              {analyzing && <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>}
              {!analyzing && (
                <Button className="btn-hero mt-3 w-full" onClick={runReview} disabled={analyzing}>
                  <Sparkles className="h-4 w-4" /> {evals.length ? 'Re-analyze' : 'Analyze game'}
                </Button>
              )}
            </div>

            <div className="rounded-lg bg-card shadow-sm">
              <div className="border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</div>
              <div className="scroll-slim max-h-80 overflow-y-auto p-2">
                <div className="grid grid-cols-[2.2rem_1fr_1fr] text-sm">
                  {plies.map((p, i) => {
                    const ev = evals[i]
                    return (
                      <div key={i} className="contents">
                        {p.color === 'w' && <div className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground">{Math.floor(i / 2) + 1}.</div>}
                        {p.color === 'w' ? null : i === 0 ? <div /> : null}
                        <button
                          onClick={() => setCursor(i)}
                          className={cn('flex items-center gap-1 truncate px-2 py-1 text-left font-medium hover:bg-accent', cursor === i && 'bg-accent font-bold')}
                        >
                          {p.san}
                          {ev && (
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: LABEL_META[ev.label].bg }} title={LABEL_META[ev.label].text} />
                          )}
                          {ev && (ev.label === 'blunder' || ev.label === 'brilliant') && (
                            <span className="text-[10px] font-bold" style={{ color: LABEL_META[ev.label].bg }}>
                              {ev.label === 'brilliant' ? '!!' : '??'}
                            </span>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {plyEval && (
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded px-2 py-0.5 text-xs font-bold uppercase text-white" style={{ background: LABEL_META[plyEval.label].bg }}>
                    {LABEL_META[plyEval.label].text}
                  </span>
                  <span className="font-mono text-sm font-bold">{plyEval.san}</span>
                  <span className="ml-auto text-sm text-muted-foreground">
                    {plyEval.before > 0 ? '+' : ''}{plyEval.before.toFixed(1)} → {plyEval.after > 0 ? '+' : ''}{plyEval.after.toFixed(1)}
                  </span>
                </div>
                {plyEval.label === 'blunder' && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Engine preferred <span className="font-mono font-bold text-foreground">{plyEval.bestUci?.slice(0, 2)}–{plyEval.bestUci?.slice(2, 4)}</span>. The gap is bigger than 2.5 points.
                  </p>
                )}
              </div>
            )}

            {whiteAcc != null && (
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Move quality</div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {(['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as Label[]).map((l) => (
                    <div key={l} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[l].bg }} />
                        {LABEL_META[l].text}
                      </span>
                      <span className="font-semibold">
                        <span className="text-foreground">{counts('w')[l] ?? 0}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-foreground">{counts('b')[l] ?? 0}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 text-right text-[10px] text-muted-foreground">White / Black</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function fenAfterPly(plies: { san: string; fenBefore: string }[], cursor: number, startFen: string): string {
  const g = new Chess(startFen)
  for (let i = 0; i <= cursor && i < plies.length; i++) {
    try {
      g.move(plies[i].san)
    } catch {
      break
    }
  }
  return g.fen()
}

function extractLastMove(plies: { san: string }[], cursor: number): { from: string; to: string } | null {
  if (cursor < 0) return null
  const g = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  for (let i = 0; i <= cursor && i < plies.length; i++) {
    try {
      const mv = g.move(plies[i].san)
      if (i === cursor && mv) return { from: mv.from, to: mv.to }
    } catch {
      return null
    }
  }
  return null
}

function EvalGraph({ evals, cursor, onSeek }: { evals: PlyEval[]; cursor: number; onSeek: (i: number) => void }) {
  const W = 100
  const H = 30
  const clamp = (v: number) => Math.max(-6, Math.min(6, v))
  const pts = evals.map((e, i) => `${(i / Math.max(1, evals.length - 1)) * W},${H / 2 - (clamp(e.after) / 6) * (H / 2)}`)
  const line = pts.join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full cursor-pointer" preserveAspectRatio="none" onClick={(e) => {
      const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      onSeek(Math.round(x * (evals.length - 1)))
    }}>
      <rect x="0" y={H / 2 - (0.5 / 6) * (H / 2)} width={W} height={(1 / 6) * H} fill="#81b64c" opacity="0.15" />
      <polyline points={`0,${H / 2} ${line} ${W},${H / 2}`} fill="rgba(130,182,76,0.3)" stroke="none" />
      <polyline points={line} fill="none" stroke="#81b64c" strokeWidth="0.7" />
      {cursor >= 0 && cursor < evals.length && (
        <line x1={(cursor / Math.max(1, evals.length - 1)) * W} y1="0" x2={(cursor / Math.max(1, evals.length - 1)) * W} y2={H} stroke="#ca3431" strokeWidth="0.5" />
      )}
    </svg>
  )
}
