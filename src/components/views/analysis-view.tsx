'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { EvalBar } from '@/components/chess/eval-bar'
import { MoveList } from '@/components/chess/move-list'
import { engine } from '@/lib/chess/engine-client'
import { accuracyFromLoss } from '@/lib/rating'
import { detectOpening } from '@/lib/chess/openings'
import { useApp } from '@/lib/store'
import { hasSpeech, speak, stopSpeaking } from '@/lib/speech'
import { coachMaybe } from '@/lib/coaches'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Loader2, Play, Pause, ChevronLeft, ChevronRight, Sparkles, Trash2, Copy, Check, Volume2, VolumeX, Square, MessageSquareText } from 'lucide-react'

export type Label = 'best' | 'brilliant' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export const LABEL_META: Record<Label, { text: string; bg: string; icon?: string }> = {
  best: { text: 'Best', bg: '#81b64c' },
  brilliant: { text: 'Brilliant', bg: '#26c2a3' },
  excellent: { text: 'Excellent', bg: '#95bb4a' },
  good: { text: 'Good', bg: '#96af8b' },
  inaccuracy: { text: 'Inaccuracy', bg: '#e6a82c' },
  mistake: { text: 'Mistake', bg: '#df8f2f' },
  blunder: { text: 'Blunder', bg: '#ca3431' },
}

export interface PlyEval {
  san: string
  color: 'w' | 'b'
  /** eval before the move, white POV pawns */
  before: number
  /** eval after the move, white POV pawns */
  after: number
  bestUci: string | null
  bestSan: string | null
  label: Label
}

export function AnalysisView() {
  const setReviewPgn = useApp((s) => s.setReviewPgn)
  // snapshot at mount: the PGN is set right before navigating here
  const incomingPgn = useApp.getState().reviewPgn
  const [mode, setMode] = useState<'free' | 'review' | 'insights'>(incomingPgn ? 'review' : 'free')
  const [pgnInput, setPgnInput] = useState(incomingPgn ?? '')

  useEffect(() => {
    // clear the handoff once consumed (store update, not local state)
    if (incomingPgn) setReviewPgn(null)
  }, [incomingPgn, setReviewPgn])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Analysis</h1>
        <div className="flex overflow-hidden rounded-md border">
          {(['free', 'review', 'insights'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('px-4 py-1.5 text-sm font-semibold capitalize', mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary')}
            >
              {m === 'free' ? 'Board & engine' : m === 'review' ? 'Game review' : 'Insights'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'free' ? <FreeAnalysis /> : mode === 'review' ? <GameReview initialPgn={pgnInput} onPgnChange={setPgnInput} /> : <InsightsPanel />}
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
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        {/* bar + board share one stretch row so the bar matches the board exactly */}
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
          </div>
        </div>
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
                Best: <span className="font-mono font-bold text-foreground">{info.bestSan ?? 'none'}</span>
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

/** Longer games get a shallower search so a review finishes in reasonable time. */
function reviewDepth(plies: number): number {
  if (plies <= 40) return 14
  if (plies <= 80) return 12
  if (plies <= 140) return 10
  return 8
}

function GameReview({ initialPgn, onPgnChange }: { initialPgn: string; onPgnChange: (s: string) => void }) {
  const [pgn, setPgn] = useState(initialPgn)
  // the saved game this review belongs to, when it came from the Play tab
  const gameId = useApp.getState().reviewGameId
  // coach speech: the player's chosen coach reads the key moments out loud
  const profile = useApp((s) => s.profile)
  const coach = coachMaybe(profile?.coach)
  const speechVoice = coach?.voice ?? 'default'
  const speechSpeed = coach?.speed ?? 1
  const soundEnabled = profile?.soundEnabled ?? true
  const [speechSupported, setSpeechSupported] = useState(false)
  useEffect(() => setSpeechSupported(hasSpeech()), [])
  const speechReady = soundEnabled && speechSupported
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [queueRunning, setQueueRunning] = useState(false)
  const [queuePos, setQueuePos] = useState(0)
  // guards the sequential "listen to report" runner against stale callbacks
  const speechRunRef = useRef(0)
  const stopSpeech = useCallback(() => {
    speechRunRef.current += 1
    stopSpeaking()
    setSpeakingId(null)
    setQueueRunning(false)
    setQueuePos(0)
  }, [])
  // leaving the view (or switching tabs) must never leave audio behind
  useEffect(() => () => {
    speechRunRef.current += 1
    stopSpeaking()
  }, [])

  /** Speak one coach line. Toggling the same line again stops it. */
  const speakOne = useCallback(
    (id: string, text: string) => {
      if (!speechReady) return
      if (speakingId === id && !queueRunning) {
        speechRunRef.current += 1
        stopSpeaking() // its onDone callback clears the id
        return
      }
      speechRunRef.current += 1 // invalidates any running report queue
      const run = speechRunRef.current
      setQueueRunning(false)
      setQueuePos(0)
      void speak({
        text,
        voice: speechVoice,
        speed: speechSpeed,
        onDone: () => {
          if (speechRunRef.current === run) setSpeakingId(null)
        },
      }).catch(() => {
        /* speech is a nicety, never let it break the report view */
      })
      setSpeakingId(id)
    },
    [speechReady, speakingId, queueRunning, speechVoice, speechSpeed],
  )
  // one-time parse of the incoming PGN during first render (no effect needed)
  const initialParse = useMemo(() => {
    if (!initialPgn) return { plies: [], error: null as string | null }
    try {
      const g = new Chess()
      g.loadPgn(initialPgn)
      const history = g.history({ verbose: true })
      const fens: { san: string; color: 'w' | 'b'; fenBefore: string }[] = []
      const replay = new Chess()
      for (const h of history) {
        fens.push({ san: h.san, color: h.color, fenBefore: replay.fen() })
        replay.move(h.san)
      }
      return { plies: fens, error: null }
    } catch {
      return { plies: [], error: 'Could not read that PGN.' }
    }
     
  }, [])
  const [plies, setPlies] = useState(initialParse.plies)
  const [evals, setEvals] = useState<PlyEval[]>([])
  const [cursor, setCursor] = useState(-1)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(initialParse.error)
  const [savedToInsights, setSavedToInsights] = useState(false)
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
      stopSpeech()
      return true
    } catch {
      setError('Could not read that PGN.')
      return false
    }
  }, [stopSpeech])

  const runReview = useCallback(async () => {
    if (plies.length === 0 || analyzing) return
    setAnalyzing(true)
    setProgress(0)
    setSavedToInsights(false)
    stopSpeech() // fresh numbers make old spoken lines stale
    const depth = reviewDepth(plies.length)
    const results: PlyEval[] = []
    let prevWhitePov = 0
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i]
      const gBefore = new Chess(p.fenBefore)
      // eval before the move
      const beforeRes = await engine.eval({ fen: p.fenBefore, depth })
      const turn = gBefore.turn()
      // engine mate scores are side-to-move POV; mate 0 means mated right now
      const mateToWhite = (m: number, t: 'w' | 'b') => (t === 'w' ? (m > 0 ? 80 : -80) : (m > 0 ? -80 : 80))
      const beforeWhite = beforeRes.mate != null ? mateToWhite(beforeRes.mate, turn) : ((turn === 'w' ? beforeRes.scoreCp ?? 0 : -(beforeRes.scoreCp ?? 0)) / 100)

      const gAfter = new Chess(p.fenBefore)
      gAfter.move(p.san)
      const afterTurn = gAfter.turn()
      // terminal positions: score from the game state, the engine has nothing to add
      let afterWhite: number
      if (gAfter.isCheckmate()) afterWhite = afterTurn === 'w' ? -80 : 80
      else if (gAfter.isGameOver()) afterWhite = 0
      else {
        const afterRes = await engine.eval({ fen: gAfter.fen(), depth })
        afterWhite = afterRes.mate != null ? mateToWhite(afterRes.mate, afterTurn) : ((afterTurn === 'w' ? afterRes.scoreCp ?? 0 : -(afterRes.scoreCp ?? 0)) / 100)
      }

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
      const bestSan: string | null = (() => {
        if (!beforeRes.pv.length) return null
        try {
          const test = new Chess(p.fenBefore)
          return test.move({ from: beforeRes.pv[0].slice(0, 2), to: beforeRes.pv[0].slice(2, 4), promotion: beforeRes.pv[0].slice(4, 5) || undefined })?.san ?? null
        } catch {
          return null
        }
      })()

      // sacrifice detection: the move gives up material AND the opponent can
      // actually take the piece, otherwise every quiet knight move would count
      const mv = gAfter.history({ verbose: true })[gAfter.history({ verbose: true }).length - 1]
      const pieceVals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
      const capturedVal = mv?.captured ? pieceVals[mv.captured] : 0
      const movedVal = mv ? pieceVals[mv.piece] : 0
      const givesMaterial = movedVal - capturedVal >= 3
      const canBeTaken = mv
        ? gAfter
            .moves({ verbose: true })
            .some((m: { to: string; flags: string }) => m.to === mv.to && /[ce]/.test(m.flags))
        : false
      const realSac = givesMaterial && canBeTaken

      let label: Label
      if (isBest && realSac && afterPov >= beforePov - 0.4) label = 'brilliant'
      else if (isBest) label = 'best'
      else if (drop < 0.15) label = 'excellent'
      else if (drop < 0.5) label = 'good'
      else if (drop < 1.2) label = 'inaccuracy'
      else if (drop < 2.5) label = 'mistake'
      else label = 'blunder'

      results.push({ san: p.san, color: p.color, before: Math.round(beforeWhite * 100) / 100, after: Math.round(afterWhite * 100) / 100, bestUci: beforeRes.pv[0] ?? null, bestSan, label })
      prevWhitePov = afterWhite
      void prevWhitePov
      setEvals([...results])
      setProgress(Math.round(((i + 1) / plies.length) * 100))
    }
    setAnalyzing(false)

    // persist the summary so Insights can aggregate it (games played here only)
    if (gameId) {
      try {
        const res = await fetch('/api/games/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, plies: results, localHour: new Date().getHours() }),
        })
        if (res.ok) setSavedToInsights(true)
      } catch {
        /* report saving is best effort, the on-screen report still works */
      }
    }
  }, [plies, analyzing, stopSpeech])

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault() // keep the page from scrolling while stepping
        setCursor((c) => Math.max(-1, c - 1))
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCursor((c) => Math.min(plies.length - 1, c + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plies.length])

  const shownFen = cursor >= 0 && cursor < plies.length ? fenAfterPly(plies, cursor, startFen) : cursor === -1 ? startFen : startFen
  const lastPly = cursor >= 0 ? plies[cursor] : null
  const plyEval = cursor >= 0 ? evals[cursor] : null
  const headers = useMemo(() => pgnHeaders(pgn), [pgn])
  const opening = useMemo(() => detectOpening(plies.map((p) => p.san)), [plies])
  const result = resultText(headers.result)
  const moments = useMemo(() => keyMoments(evals), [evals])

  /** Read the key moments in display order, one line each, stoppable at any point. */
  const speakReport = useCallback(() => {
    if (!speechReady) return
    if (queueRunning) {
      stopSpeech()
      return
    }
    const items = moments.map(({ index, eval: e }) => ({
      id: `m${index}`,
      text: `${moveNumber(index)}. ${e.san} (${e.color === 'w' ? 'White' : 'Black'}): ${LABEL_META[e.label].text}. ${reasonFor(e)}`,
    }))
    if (items.length === 0) return
    speechRunRef.current += 1
    const run = speechRunRef.current
    let i = 0
    const advance = () => {
      if (speechRunRef.current !== run) return
      if (i >= items.length) {
        setSpeakingId(null)
        setQueueRunning(false)
        setQueuePos(0)
        return
      }
      const item = items[i]
      i += 1
      setQueuePos(i)
      setSpeakingId(item.id)
      // deferred so the previous line's onDone (fired synchronously by
      // speak()'s internal cancel) cannot re-enter this runner
      setTimeout(() => {
        if (speechRunRef.current !== run) return
        void speak({
          text: item.text,
          voice: speechVoice,
          speed: speechSpeed,
          onDone: advance,
        }).catch(() => {
          /* speech is a nicety, never let it break the report view */
        })
      }, 0)
    }
    setQueueRunning(true)
    advance()
  }, [speechReady, queueRunning, moments, speechVoice, speechSpeed, stopSpeech])

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
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        {/* bar + board share one stretch row so the bar matches the board exactly */}
        <div className="flex gap-2">
          <EvalBar score={plyEval?.after ?? 0} className="hidden sm:block" />
          <div className="min-w-0 flex-1">
            <ChessBoard
              fen={shownFen}
              interactive={false}
              lastMove={lastPly ? extractLastMove(plies, cursor) : null}
            />
          </div>
        </div>
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

        {/* eval graph */}
        {evals.length > 1 && (
          <div className="mt-4 rounded-lg bg-card p-3 shadow-sm">
            <EvalGraph evals={evals} cursor={cursor} onSeek={setCursor} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {plies.length === 0 ? (
          <div className="rounded-lg bg-card p-6 shadow-sm">
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
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Game report</div>
                {analyzing && (
                  <span className="text-sm font-semibold text-muted-foreground">{progress}%</span>
                )}
              </div>
              {(headers.white || headers.black || result) && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  {headers.white && <span className="font-bold">{headers.white}</span>}
                  {headers.white && headers.black && <span className="text-xs text-muted-foreground">vs</span>}
                  {headers.black && <span className="font-bold">{headers.black}</span>}
                  {result && <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-xs font-bold">{result}</span>}
                </div>
              )}
              {plies.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Opening: <span className="font-semibold text-foreground">{opening}</span>
                </div>
              )}
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
                <div className="mt-3 flex gap-2">
                  <Button className="btn-hero flex-1" onClick={runReview} disabled={analyzing}>
                    <Sparkles className="h-4 w-4" /> {evals.length ? 'Re-analyze' : 'Analyze game'}
                  </Button>
                  {evals.length > 0 && (
                    <CopyReportButton
                      buildText={() =>
                        reportText({
                          white: headers.white ?? 'White',
                          black: headers.black ?? 'Black',
                          result,
                          opening,
                          whiteAcc,
                          blackAcc,
                          evals,
                          moments,
                        })
                      }
                    />
                  )}
                </div>
              )}
              {savedToInsights && (
                <p className="mt-2 text-xs font-semibold text-primary">Saved to your insights.</p>
              )}
              {!savedToInsights && evals.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Insights only collect games you play here. Paste a PGN from somewhere else and it stays out.
                </p>
              )}
              {gameId && evals.length > 0 && (
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => {
                    useApp.getState().setPendingCoachGame(gameId)
                    useApp.getState().navigate('coach')
                  }}
                >
                  <MessageSquareText className="h-4 w-4" /> Ask the coach about this game
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
                {(plyEval.label === 'blunder' || plyEval.label === 'mistake' || plyEval.label === 'inaccuracy' || plyEval.label === 'brilliant') && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{reasonFor(plyEval)}</p>
                )}
              </div>
            )}

            {moments.length > 0 && (
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key moments</div>
                  {speechReady && (
                    <Button
                      variant={queueRunning ? 'default' : 'secondary'}
                      size="sm"
                      className="h-7 px-2.5 text-xs transition-transform active:scale-95"
                      onClick={speakReport}
                      aria-pressed={queueRunning}
                      aria-label={queueRunning ? 'Stop reading the report' : 'Listen to report'}
                    >
                      {queueRunning ? (
                        <>
                          <Square className="h-3 w-3" /> Stop
                          <span className="font-normal text-primary-foreground/80">
                            {queuePos}/{moments.length}
                          </span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" /> Listen to report
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {moments.map(({ index, eval: e }) => {
                    const momentId = `m${index}`
                    const line = `${moveNumber(index)}. ${e.san} (${e.color === 'w' ? 'White' : 'Black'}): ${LABEL_META[e.label].text}. ${reasonFor(e)}`
                    const isSpeaking = speakingId === momentId
                    return (
                      <div
                        key={index}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent',
                          isSpeaking && 'bg-primary/10',
                        )}
                      >
                        <button
                          onClick={() => setCursor(index)}
                          className="pressable flex min-w-0 flex-1 items-start gap-2 rounded-md text-left"
                          aria-label={`Go to move ${moveNumber(index)}, ${e.san}`}
                        >
                          <span
                            className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                            style={{ background: LABEL_META[e.label].bg }}
                          >
                            {LABEL_META[e.label].text}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold">
                              {moveNumber(index)}. {e.san}
                              <span className="ml-1 font-normal text-muted-foreground">({e.color === 'w' ? 'White' : 'Black'})</span>
                            </span>
                            <span className="block text-xs leading-snug text-muted-foreground">{reasonFor(e)}</span>
                          </span>
                        </button>
                        {speechReady && (
                          <button
                            type="button"
                            onClick={() => speakOne(momentId, line)}
                            aria-label={isSpeaking ? 'Stop reading this moment' : 'Read this moment aloud'}
                            className={cn(
                              'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-accent active:scale-90',
                              isSpeaking && 'bg-primary/15 text-primary',
                            )}
                          >
                            {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
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

/* ---------------- game report helpers ---------------- */

/** Pull the named headers straight out of the PGN text, only what exists. */
function pgnHeaders(text: string): { white?: string; black?: string; result?: string; date?: string } {
  const pick = (key: string) => {
    const m = text.match(new RegExp(`\\[${key} "([^"]*)"\\]`))
    const v = m?.[1]?.trim()
    return v && v !== '?' && v !== '' ? v : undefined
  }
  return { white: pick('White'), black: pick('Black'), result: pick('Result'), date: pick('Date') }
}

function resultText(r?: string): string | null {
  if (r === '1-0') return 'White won'
  if (r === '0-1') return 'Black won'
  if (r === '1/2-1/2') return 'Draw'
  return null
}

function moveNumber(plyIndex: number): number {
  return Math.floor(plyIndex / 2) + 1
}

/** One honest line per key move, generated from the numbers we already have. */
function reasonFor(e: PlyEval): string {
  const drop = Math.max(0, (e.color === 'w' ? e.before : -e.before) - (e.color === 'w' ? e.after : -e.after))
  const best = e.bestSan
  switch (e.label) {
    case 'brilliant':
      return `A real sacrifice: the piece can be taken, but the engine confirms ${e.san} still works.`
    case 'blunder': {
      const swing = Math.abs(e.after - e.before)
      const winning = e.color === 'w' ? e.after >= 3 : e.after <= -3
      if (swing >= 20) {
        return best
          ? `This decides the game by force. ${best} was the shot instead.`
          : 'This walks into a forced finish.'
      }
      const base = best ? `The engine preferred ${best}` : 'The position swung hard against you'
      return `${base}. The swing is ${swing.toFixed(1)} points${winning ? ' and hands the opponent a winning position' : ''}.`
    }
    case 'mistake':
      return best ? `Costs about ${drop.toFixed(1)} points. ${best} was stronger.` : `Costs about ${drop.toFixed(1)} points.`
    case 'inaccuracy':
      return best ? `A slight drift, about ${drop.toFixed(1)} points. ${best} keeps more of an edge.` : `A slight drift, about ${drop.toFixed(1)} points.`
    default:
      return best ? `Solid, though ${best} was marginally sharper.` : 'Solid move.'
  }
}

interface KeyMoment {
  index: number
  eval: PlyEval
}

/** The plies worth talking about: the biggest swings plus any brilliancy. */
function keyMoments(evals: PlyEval[]): KeyMoment[] {
  const scored = evals.map((e, index) => {
    const drop = Math.max(0, (e.color === 'w' ? e.before : -e.before) - (e.color === 'w' ? e.after : -e.after))
    const interest = e.label === 'brilliant' ? 9 + drop : drop
    return { index, eval: e, interest }
  })
  const interesting = scored.filter((s) => s.eval.label !== 'best' && s.eval.label !== 'excellent' && s.eval.label !== 'good')
  interesting.sort((a, b) => b.interest - a.interest)
  return interesting.slice(0, 4).map(({ index, eval: e }) => ({ index, eval: e }))
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

/* ---------------- copy report ---------------- */

function CopyReportButton({ buildText }: { buildText: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="icon"
      className="h-9 w-9 shrink-0 self-stretch"
      aria-label="Copy report"
      title="Copy report"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(buildText())
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          /* clipboard blocked, nothing to do */
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
    </Button>
  )
}

/** Plain-text shareable summary. Only numbers this report actually computed. */
function reportText(r: {
  white: string
  black: string
  result: string | null
  opening: string
  whiteAcc: number | null
  blackAcc: number | null
  evals: PlyEval[]
  moments: { index: number; eval: PlyEval }[]
}): string {
  const lines: string[] = []
  lines.push(`ChessX game report: ${r.white} vs ${r.black}`)
  if (r.result) lines.push(`Result: ${r.result}`)
  lines.push(`Opening: ${r.opening}`)
  if (r.whiteAcc != null && r.blackAcc != null) {
    lines.push(`Accuracy: ${r.whiteAcc}% White, ${r.blackAcc}% Black`)
  }
  const quality = (color: 'w' | 'b') => {
    const c: Record<string, number> = {}
    for (const e of r.evals.filter((x) => x.color === color)) c[e.label] = (c[e.label] ?? 0) + 1
    return c
  }
  const fmt = (c: Record<string, number>) =>
    (['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as Label[])
      .map((l) => `${LABEL_META[l].text} ${c[l] ?? 0}`)
      .join(', ')
  lines.push('')
  lines.push(`White moves: ${fmt(quality('w'))}`)
  lines.push(`Black moves: ${fmt(quality('b'))}`)
  if (r.moments.length) {
    lines.push('')
    lines.push('Key moments:')
    for (const { index, eval: e } of r.moments) {
      lines.push(`  ${Math.floor(index / 2) + 1}. ${e.san} (${e.color === 'w' ? 'White' : 'Black'}): ${LABEL_META[e.label].text}. ${reasonFor(e)}`)
    }
  }
  return lines.join('\n')
}

/* ---------------- insights ---------------- */

interface InsightsGame {
  id: string
  botName: string
  color: string
  result: string
  rated: boolean
  opening: string | null
  playerAcc: number | null
  createdAt: string
}

interface InsightsData {
  games: InsightsGame[]
  labels: { inaccuracy: number; mistake: number; blunder: number; brilliant: number; best: number; excellent: number; good: number } | null
  openings: { opening: string; games: number; wins: number; losses: number; draws: number; avgAcc: number | null }[]
  timeOfDay: { bucket: string; games: number; wins: number; avgAcc: number | null }[]
}

function InsightsPanel() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/insights')
      .then((r) => readJson<unknown>(r))
      .then((d) => {
        setData(d)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your insights…
      </div>
    )
  }

  const analyzed = data?.games.filter((g) => g.playerAcc != null) ?? []
  if (analyzed.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-xl bg-card p-6 text-center shadow-sm">
        <h2 className="font-display text-xl font-extrabold">No analyzed games yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Play a game in the Play tab, press Game review, then Analyze game. Insights build from
          the reports of games you actually play here, never from invented filler.
        </p>
      </div>
    )
  }

  const accs = analyzed.map((g) => g.playerAcc as number)
  const avgAcc = Math.round((accs.reduce((a, b) => a + b, 0) / accs.length) * 10) / 10
  const wins = analyzed.filter((g) => g.result === 'win').length
  const losses = analyzed.filter((g) => g.result === 'loss').length
  const draws = analyzed.length - wins - losses
  const labels = data?.labels

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">{avgAcc}%</div>
          <div className="text-xs text-muted-foreground">Average accuracy</div>
        </div>
        <div className="rounded-lg bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">{analyzed.length}</div>
          <div className="text-xs text-muted-foreground">Analyzed games</div>
        </div>
        <div className="rounded-lg bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">
            {wins}<span className="text-base text-muted-foreground">/{draws}/{losses}</span>
          </div>
          <div className="text-xs text-muted-foreground">Win / draw / loss</div>
        </div>
      </div>

      <AccuracyTrend games={analyzed} />

      {labels && (
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your move quality mix</div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {(['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as Label[]).map((l) => (
              <div key={l} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[l].bg }} />
                  {LABEL_META[l].text}
                </span>
                <span className="font-bold">{labels[l]}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Every move you played in analyzed games, counted by the report.</p>
        </div>
      )}

      <OpeningTable rows={data?.openings ?? []} />

      <TimeOfDay rows={data?.timeOfDay ?? []} />
    </div>
  )
}

/** Accuracy per analyzed game, oldest to newest, drawn as an honest line. */
function AccuracyTrend({ games }: { games: InsightsGame[] }) {
  const pts = games.map((g, i) => ({ i, acc: g.playerAcc as number, g }))
  const W = 100
  const H = 36
  const min = Math.min(...pts.map((p) => p.acc), 40)
  const max = Math.max(...pts.map((p) => p.acc), 100)
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W)
  const y = (a: number) => H - 3 - ((a - min) / Math.max(1, max - min)) * (H - 8)
  const line = pts.map((p, i) => `${x(i)},${y(p.acc)}`).join(' ')
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accuracy trend</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-28 w-full" preserveAspectRatio="none">
        {pts.length > 1 && <polyline points={`0,${H} ${line} ${W},${H}`} fill="rgba(130,182,76,0.15)" stroke="none" />}
        <polyline points={line} fill="none" stroke="#81b64c" strokeWidth="0.8" />
        {pts.map((p, i) => (
          <circle key={p.g.id} cx={x(i)} cy={y(p.acc)} r="1" fill="#81b64c" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>oldest</span>
        <span>{pts.length} game{pts.length === 1 ? '' : 's'}, {pts[0].acc}% to {pts[pts.length - 1].acc}%</span>
        <span>newest</span>
      </div>
      <div className="mt-2 space-y-1">
        {[...pts].reverse().slice(0, 5).map((p) => (
          <div key={p.g.id} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">
              {new Date(p.g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">vs {p.g.botName}</span>
            <span className={cn('font-bold', p.g.result === 'win' ? 'text-primary' : p.g.result === 'loss' ? 'text-destructive' : 'text-muted-foreground')}>
              {p.g.result === 'win' ? 'Win' : p.g.result === 'loss' ? 'Loss' : 'Draw'}
            </span>
            <span className="w-12 text-right font-mono font-bold">{p.acc}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OpeningTable({ rows }: { rows: InsightsData['openings'] }) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Openings you actually played</div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-semibold">Opening</th>
              <th className="py-1.5 text-center font-semibold">Games</th>
              <th className="py-1.5 text-center font-semibold">W/D/L</th>
              <th className="py-1.5 text-right font-semibold">Avg accuracy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.opening} className="border-t border-border/60">
                <td className="py-1.5 font-semibold">{r.opening}</td>
                <td className="py-1.5 text-center">{r.games}</td>
                <td className="py-1.5 text-center tabular-nums">{r.wins}/{r.draws}/{r.losses}</td>
                <td className="py-1.5 text-right font-mono">{r.avgAcc != null ? `${Math.round(r.avgAcc)}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TIME_BUCKETS: { bucket: string; hint: string }[] = [
  { bucket: 'morning', hint: '5:00 to 12:00' },
  { bucket: 'afternoon', hint: '12:00 to 17:00' },
  { bucket: 'evening', hint: '17:00 to 22:00' },
  { bucket: 'night', hint: '22:00 to 5:00' },
]

function TimeOfDay({ rows }: { rows: InsightsData['timeOfDay'] }) {
  const max = Math.max(1, ...rows.map((r) => r.games))
  const hintFor = (bucket: string) => TIME_BUCKETS.find((b) => b.bucket === bucket)?.hint
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When you play your best</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.bucket} className="rounded-md bg-secondary/60 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold capitalize">{r.bucket}</span>
              <span className="text-xs text-muted-foreground">{r.games} game{r.games === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${(r.games / max) * 100}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {r.avgAcc != null ? `${Math.round(r.avgAcc)}% avg accuracy` : 'no reports yet'}
              {r.games > 0 ? ` · ${r.wins} won` : ''}
            </div>
            <div className="text-[10px] text-muted-foreground/70">your hours: {hintFor(r.bucket)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
