'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { EvalBar } from '@/components/chess/eval-bar'
import { MoveList } from '@/components/chess/move-list'
import { engine, type EngineInfo } from '@/lib/chess/engine-client'
import {
  LABEL_META,
  GOOD_ORDER,
  BAD_ORDER,
  coerceLabel,
  classifyMove,
  type MoveLabel,
  type LabelMeta,
  type ClassifyInput,
} from '@/lib/chess/move-classification'
import {
  cplOf,
  accuracyOfCpl,
  computeReviewAreas,
  computeCallouts,
  type PlyEvalDTO,
  type Callout,
  type TheoryInfo,
  type ReviewAreas,
  type ClockArea,
} from '@/lib/chess/review-types'
import { detectOpening } from '@/lib/chess/openings'
import { useApp } from '@/lib/store'
import { hasSpeech, speak, stopSpeaking } from '@/lib/speech'
import { coachMaybe } from '@/lib/coaches'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ImportGamePanel } from '@/components/views/import-game-panel'
import { cn } from '@/lib/utils'
import {
  Loader2,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Sparkles,
  Trash2,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Square as SquareIcon,
  MessageSquareText,
  Undo2,
  Target,
  Zap,
} from 'lucide-react'
import { BOTS } from '@/lib/chess/bots'

// The 12-label set, classifier and helpers are the FROZEN shared contract
// (src/lib/chess/move-classification.ts). This file never redefines them.
export type Label = MoveLabel
export type PlyEval = PlyEvalDTO

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** chess.com microlabel: 10px, uppercase, letterspaced, muted. */
function Micro({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</div>
}

/** The classification circle: official color + glyph, always guarded. */
function LabelBadge({ label, size = 'sm' }: { label: string; size?: 'sm' | 'md' }) {
  const meta: LabelMeta = LABEL_META[coerceLabel(label)]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full px-0.5 font-bold leading-none text-white',
        size === 'sm' ? 'h-4 min-w-4 text-[8px]' : 'h-6 min-w-6 text-[11px]',
      )}
      style={{ background: meta.color }}
      title={meta.text}
      aria-label={meta.text}
    >
      {meta.glyph}
    </span>
  )
}

/** White POV eval formatting: "+1.0" white ahead, "-2.5" black ahead, "#3", "0.0". */
function fmtEval(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`
}

function sideName(c: 'w' | 'b'): string {
  return c === 'w' ? 'White' : 'Black'
}

/** Guarded label lookup for any label string that traveled through data. */
function metaOf(label: string): LabelMeta {
  return LABEL_META[coerceLabel(label)]
}

function moveNumberOf(plyIndex: number): number {
  return Math.floor(plyIndex / 2) + 1
}

/** Mover-POV eval drop in pawns (>= 0). */
function moverDrop(e: { before: number; after: number; color: 'w' | 'b' }): number {
  const pov = (v: number) => (e.color === 'w' ? v : -v)
  return Math.max(0, pov(e.before) - pov(e.after))
}

// ---------------------------------------------------------------------------
// PGN parsing (plies + %clk clocks)
// ---------------------------------------------------------------------------

interface ReviewPly {
  san: string
  color: 'w' | 'b'
  fenBefore: string
}

interface ParsedGame {
  plies: ReviewPly[]
  /** seconds SPENT per ply (null where not inferable), or null when the PGN carries no %clk data */
  clocks: (number | null)[] | null
  error: string | null
}

/** Parse a PGN into plies (fenBefore included) and per-move clock spending. */
function parseGame(text: string): ParsedGame {
  if (!text.trim()) return { plies: [], clocks: null, error: null }
  try {
    const g = new Chess()
    g.loadPgn(text)
    const history = g.history({ verbose: true })
    const plies: ReviewPly[] = []
    const replay = new Chess()
    for (const h of history) {
      plies.push({ san: h.san, color: h.color, fenBefore: replay.fen() })
      replay.move(h.san)
    }
    return { plies, clocks: parseClockSpent(text, plies), error: null }
  } catch {
    return { plies: [], clocks: null, error: 'Could not read that PGN.' }
  }
}

/**
 * Extract per-move time spending from PGN "%clk" comments.
 * remaining-after-move comes from the comments; timeSpent = previous remaining
 * of the same side - remaining + increment (from the TimeControl header), when
 * both ends are known. Returns null when the PGN has no clock data at all.
 */
function parseClockSpent(pgn: string, plies: ReviewPly[]): (number | null)[] | null {
  if (plies.length === 0) return null

  // time control header: "180+2" -> initial 180s, increment 2s
  const tc = /\[TimeControl\s+"([^"]*)"\]/.exec(pgn)
  let initial: number | null = null
  let inc = 0
  if (tc) {
    const parts = tc[1].split('+')
    const secs = Number(parts[0])
    if (Number.isFinite(secs) && secs > 0) initial = secs
    const incRaw = Number(parts[1])
    if (Number.isFinite(incRaw) && incRaw >= 0) inc = incRaw
  }

  // movetext only, with variations removed (they would break ply alignment)
  let body = pgn.replace(/^\[[^\]]*\][ \t]*$/gm, ' ')
  for (;;) {
    const stripped = body.replace(/\([^()]*\)/g, ' ')
    if (stripped === body) break
    body = stripped
  }

  // single pass: comments attach to the SAN token right before them
  const remaining: (number | null)[] = []
  let ply = -1
  const tokens = body.match(/\{[^}]*\}|[^\s{}]+/g) ?? []
  for (const t of tokens) {
    if (t.startsWith('{')) {
      const m = /%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/.exec(t)
      if (m && ply >= 0) {
        const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        while (remaining.length <= ply) remaining.push(null)
        remaining[ply] = Number.isFinite(secs) ? secs : null
      }
      continue
    }
    if (/^\d+\.{1,3}$/.test(t)) continue // move numbers
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue // results
    if (/^\$\d+$/.test(t)) continue // NAGs
    ply += 1 // a SAN token
  }
  if (!remaining.some((s) => s != null)) return null

  const spent: (number | null)[] = plies.map(() => null)
  const prevByColor: Record<'w' | 'b', number | null> = { w: initial, b: initial }
  for (let i = 0; i < plies.length && i < remaining.length; i++) {
    const rem = remaining[i]
    const color = plies[i].color
    const prev = prevByColor[color]
    if (rem != null && prev != null) {
      const delta = prev - rem + inc
      if (Number.isFinite(delta)) spent[i] = Math.max(0, Math.round(delta))
    }
    if (rem != null) prevByColor[color] = rem
  }
  return spent
}

// ---------------------------------------------------------------------------
// Server evals contract (POST /api/analysis/evals, upgraded in parallel by
// agent 2-b). Everything except the core fields is optional and defensively
// coerced on arrival, so both the current and the richer payload render.
// ---------------------------------------------------------------------------

type ServerPly = Partial<Omit<PlyEvalDTO, 'label' | 'color' | 'san'>> & {
  san?: string
  color?: string
  label?: string
}

interface EvalsChunkResponse {
  evals?: ServerPly[]
  engine?: string | null
  depth?: number
  /** optional theory info (openingName / theoryPlies / firstDeviationSan) */
  theory?: Partial<TheoryInfo> | null
  /** optional areas-style payload; `areas.openings` carries the same fields */
  areas?: { openings?: Partial<TheoryInfo> | null } | null
}

function toPlyEval(e: ServerPly, fallback: ReviewPly, clock: number | null): PlyEvalDTO {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const before = num(e.before) ?? 0
  const after = num(e.after) ?? 0
  const color: 'w' | 'b' = e.color === 'w' || e.color === 'b' ? e.color : fallback.color
  const cplServer = num(e.cpl)
  const timeServer = 'timeSpentSec' in e ? num(e.timeSpentSec) : null
  const reason = typeof e.reason === 'string' && e.reason.trim() ? e.reason : undefined
  return {
    san: typeof e.san === 'string' && e.san ? e.san : fallback.san,
    color,
    before,
    after,
    bestUci: typeof e.bestUci === 'string' && e.bestUci ? e.bestUci : null,
    bestSan: typeof e.bestSan === 'string' && e.bestSan ? e.bestSan : null,
    label: coerceLabel(typeof e.label === 'string' && e.label ? e.label : 'best'),
    ...(reason ? { reason } : {}),
    cpl: cplServer != null ? Math.max(0, Math.round(cplServer)) : cplOf(before, after, color),
    timeSpentSec: timeServer ?? clock,
  }
}

function readTheory(data: EvalsChunkResponse): TheoryInfo | null {
  const t = data.theory ?? data.areas?.openings ?? null
  if (!t || typeof t !== 'object') return null
  const openingName = typeof t.openingName === 'string' ? t.openingName : ''
  const theoryPlies = typeof t.theoryPlies === 'number' && Number.isFinite(t.theoryPlies) ? t.theoryPlies : 0
  const firstDeviationSan = typeof t.firstDeviationSan === 'string' && t.firstDeviationSan ? t.firstDeviationSan : null
  if (!openingName && theoryPlies === 0 && !firstDeviationSan) return null
  return { openingName, theoryPlies, firstDeviationSan }
}

// ---------------------------------------------------------------------------
// Top-level view: Board & engine | Game review | Insights
// ---------------------------------------------------------------------------

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

  const modes: { id: 'free' | 'review' | 'insights'; label: string }[] = [
    { id: 'free', label: 'Board & engine' },
    { id: 'review', label: 'Game review' },
    { id: 'insights', label: 'Insights' },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Analysis</h1>
        <div className="inline-flex rounded-xl bg-secondary p-1" role="tablist" aria-label="Analysis modes">
          {modes.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                'min-h-10 rounded-lg px-3 text-sm font-bold transition-colors sm:px-4',
                mode === m.id
                  ? 'bg-[#f7c437] text-[#312e2b] shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'free' ? <FreeAnalysis /> : mode === 'review' ? <GameReview initialPgn={pgnInput} onPgnChange={setPgnInput} /> : <InsightsPanel />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Free board + engine ("Board & engine" mode)
// ---------------------------------------------------------------------------

interface FreeEngineInfo {
  /** white-POV eval in pawns (mate flattened) */
  score: number
  /** white-POV mate: +N white mates in N, -N black mates in N */
  mateWhite: number | null
  depth: number
  pv: string[]
  pvSan: string[]
  bestSan: string | null
}

function evalStripText(info: FreeEngineInfo): { big: string; side: string } {
  if (info.mateWhite != null) {
    return { big: `#${Math.abs(info.mateWhite)}`, side: info.mateWhite > 0 ? 'White mates' : 'Black mates' }
  }
  if (info.score > 0.049) return { big: `+${info.score.toFixed(1)}`, side: 'White ahead' }
  if (info.score < -0.049) return { big: info.score.toFixed(1), side: 'Black ahead' }
  return { big: '0.0', side: 'Equal' }
}

function FreeAnalysis() {
  // Root + tip model: the line is ONE SAN path from startRef (the root FEN).
  // gameRef always holds the TIP position. Clicking any move in the list
  // rewinds the board to that ply; playing a move there spins a NEW sideline
  // universe from that point (the chessigma "alternate universe" model): the
  // path truncates to that ply and the new move becomes the continuation.
  const startRef = useRef<string>(new Chess().fen())
  const gameRef = useRef<Chess>(new Chess())
  const [moves, setMoves] = useState<string[]>([])
  /** FEN after each ply: posHistory[0] = root, posHistory[i] = after ply i. */
  const [posHistory, setPosHistory] = useState<string[]>([startRef.current])
  const [viewPly, setViewPly] = useState(0)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [info, setInfo] = useState<FreeEngineInfo | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [showBest, setShowBest] = useState(true)
  const [fenInput, setFenInput] = useState('')
  const [pgnInput, setPgnInput] = useState('')
  const [showPgnInput, setShowPgnInput] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const analysisSeq = useRef(0)

  // The position on the board right now (may be an earlier ply of the line).
  const atTip = viewPly >= posHistory.length - 1
  const fen = posHistory[Math.min(viewPly, posHistory.length - 1)] ?? startRef.current

  // Depth control: same ladder as game review, plus the deep tail. "Unlimited"
  // asks the maximum the engine will honor inside its budget; the strip then
  // reports the depth the engine ACTUALLY reached, never the ask.
  const [freeDepth, setFreeDepth] = useState(14)
  const [unlimited, setUnlimited] = useState(false)
  const askDepth = unlimited ? 40 : freeDepth

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 4200)
    return () => clearTimeout(t)
  }, [note])

  // One-time: a position shared through the URL (?fen=… search param or the
  // #/analysis?fen=… hash) loads on mount so links open exactly on the
  // position being discussed.
  useEffect(() => {
    const fromSearch = /[?&]fen=([^&]+)/.exec(window.location.search)
    const fromHash = /[?&]fen=([^&]+)/.exec(window.location.hash)
    const raw = fromSearch?.[1] ?? fromHash?.[1]
    if (!raw) return
    try {
      const g = new Chess(decodeURIComponent(raw))
      startRef.current = g.fen()
      gameRef.current = g
      setPosHistory([g.fen()])
      setMoves([])
      setViewPly(0)
      setLastMove(null)
      setInfo(null)
    } catch {
      /* bad FEN in the URL: keep the starting position */
    }
  }, [])

  // Mirror the current position into BOTH the ?fen= search param (the
  // chessigma-style canonical share link) and the #/analysis?fen=… hash.
  // replaceState (never pushState): one entry per position change, no
  // history spam, no hashchange side effects.
  useEffect(() => {
    try {
      const enc = encodeURIComponent(fen)
      window.history.replaceState(null, '', `?fen=${enc}#/analysis?fen=${enc}`)
    } catch {
      /* some browsers refuse replaceState on odd origins; the board still works */
    }
  }, [fen])

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?fen=${encodeURIComponent(fen)}`
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {
        /* clipboard blocked: the URL bar still carries ?fen= */
      })
  }, [fen])

  const runAnalysis = useCallback(async (f: string, depth: number) => {
    const seq = ++analysisSeq.current
    setAnalyzing(true)
    try {
      // Server engine first (native Stockfish 19): stronger numbers, SAN PV
      // comes ready-made. The browser wasm stays as the offline fallback.
      try {
        const res = await fetch('/api/engine/eval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: f, depth }),
        })
        if (res.ok) {
          const d = (await res.json()) as { scoreCp?: number; mate?: number | null; depth?: number; depthReached?: number; pv?: string[]; pvSan?: string[]; bestSan?: string | null }
          if (seq !== analysisSeq.current) return
          const turn = new Chess(f).turn()
          const whitePov = (v: number) => (turn === 'w' ? v : -v)
          const mateWhite = d.mate != null ? whitePov(d.mate) : null
          const score = d.mate != null ? (mateWhite != null && mateWhite > 0 ? 80 : -80) : whitePov(d.scoreCp ?? 0) / 100
          const pv = d.pv ?? []
          const pvSan = d.pvSan ?? []
          setInfo({ score, mateWhite, depth: d.depthReached ?? d.depth ?? depth, pv, pvSan, bestSan: d.bestSan ?? pvSan[0] ?? null })
          return
        }
      } catch {
        /* server engine unreachable, use the browser engine below */
      }
      const res = await engine.eval({ fen: f, depth })
      if (seq !== analysisSeq.current) return
      const turn = new Chess(f).turn()
      const whitePov = (v: number) => (turn === 'w' ? v : -v)
      const mateWhite = res.mate != null ? whitePov(res.mate) : null
      const score = res.mate != null ? (mateWhite != null && mateWhite > 0 ? 80 : -80) : whitePov(res.scoreCp ?? 0) / 100
      // The engine answers in raw UCI coordinates; a student reads SAN. The
      // whole PV is replayed on a scratch board so the line shows as
      // "e4 e5 Nf3 Nc6", never as "e2e4 e7e5 g1f3".
      const g = new Chess(f)
      const pvSan: string[] = []
      for (const uci of res.pv.slice(0, 12)) {
        try {
          const pm = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
          if (!pm) break
          pvSan.push(pm.san)
        } catch {
          break
        }
      }
      const bestSan = pvSan[0] ?? null
      setInfo({ score, mateWhite, depth: res.depth, pv: res.pv, pvSan, bestSan })
    } finally {
      if (seq === analysisSeq.current) setAnalyzing(false)
    }
  }, [])

  useEffect(() => {
    void runAnalysis(fen, askDepth)
  }, [fen, askDepth, runAnalysis])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const branching = viewPly < posHistory.length - 1
      const branchAt = viewPly
      if (branching) {
        // Spin the alternate universe: rebuild the tip at the viewed ply, then
        // the new move continues from there. The old future is replaced.
        const g = new Chess(startRef.current)
        for (let i = 0; i < branchAt; i++) {
          const san = moves[i]
          try {
            g.move(san)
          } catch {
            return
          }
        }
        gameRef.current = g
      }
      const g = gameRef.current
      try {
        const mv = g.move({ from, to, promotion: promotion ?? undefined })
        if (!mv) return
        const nextFen = g.fen()
        setMoves((m) => (branching ? m.slice(0, branchAt) : m).concat(mv.san))
        setPosHistory((p) => p.slice(0, branchAt + 1).concat(nextFen))
        setViewPly(branchAt + 1)
        setLastMove({ from: mv.from, to: mv.to })
        if (branching) setNote(`Sideline spun from move ${branchAt + 1} — the engine now follows this universe.`)
      } catch {
        /* illegal */
      }
    },
    [viewPly, posHistory.length, moves],
  )

  const playBest = useCallback(() => {
    const uci = info?.pv[0]
    if (!uci || uci.length < 4) return
    onMove(uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, uci.slice(4, 5) || undefined)
  }, [info, onMove])

  const gotoAbs = useCallback(
    (ply: number) => {
      setViewPly(Math.max(0, Math.min(ply, posHistory.length - 1)))
    },
    [posHistory.length],
  )

  const undo = useCallback(() => {
    // Viewing history: step back one ply without touching the line.
    if (viewPly > 0 && viewPly < posHistory.length - 1) {
      setViewPly(viewPly - 1)
      return
    }
    // At the tip: a real take-back of the last move.
    const g = gameRef.current
    if (g.history().length === 0) return
    g.undo()
    const hist = g.history({ verbose: true })
    const last = hist[hist.length - 1]
    setMoves((m) => m.slice(0, -1))
    setPosHistory((p) => p.slice(0, -1))
    setViewPly(posHistory.length - 2)
    setLastMove(last ? { from: last.from, to: last.to } : null)
  }, [viewPly, posHistory.length])

  const reset = useCallback(() => {
    gameRef.current = new Chess(startRef.current)
    setMoves([])
    setPosHistory([startRef.current])
    setViewPly(0)
    setLastMove(null)
    setInfo(null)
  }, [])

  const loadFen = useCallback(() => {
    try {
      const g = new Chess(fenInput.trim())
      startRef.current = g.fen()
      gameRef.current = g
      setPosHistory([g.fen()])
      setMoves([])
      setViewPly(0)
      setLastMove(null)
      setInfo(null)
    } catch {
      /* invalid FEN */
    }
  }, [fenInput])

  const loadPgn = useCallback(() => {
    try {
      const g = new Chess()
      g.loadPgn(pgnInput, { strict: false })
      const tip = g.fen()
      const hist = g.history({ verbose: true })
      if (hist.length === 0) {
        setNote('No moves found in that PGN.')
        return
      }
      // Walk back to the PGN's root (honours [FEN] headers automatically).
      const root = new Chess(tip)
      while (root.undo() !== null) {
        /* walk to the start */
      }
      startRef.current = root.fen()
      gameRef.current = new Chess(tip)
      setMoves(hist.map((m) => m.san))
      // Rebuild the per-ply position history by replaying the SANs.
      const hist2: string[] = [root.fen()]
      const r = new Chess(root.fen())
      for (const m of hist) {
        r.move(m.san)
        hist2.push(r.fen())
      }
      setPosHistory(hist2)
      setViewPly(hist2.length - 1)
      const lastM = hist[hist.length - 1]
      setLastMove({ from: lastM.from, to: lastM.to })
      setInfo(null)
      setNote(`Loaded ${hist.length} plies from PGN.`)
    } catch {
      setNote('Could not parse that PGN.')
    }
  }, [pgnInput])

  const game = useMemo(() => new Chess(fen), [fen])
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  const bestArrow: Arrow | null =
    showBest && info?.pv.length
      ? { from: info.pv[0].slice(0, 2), to: info.pv[0].slice(2, 4), color: 'green' }
      : null

  const strip = info ? evalStripText(info) : null

  const depthLadder = [10, 14, 18, 24]

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        {/* bar + board share one stretch row so the bar matches the board exactly */}
        <div className="flex gap-2">
          <EvalBar
            score={info?.score ?? 0}
            mateFor={info?.mateWhite != null ? Math.sign(info.mateWhite) : null}
            className="hidden sm:block"
          />
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

        {/* compact engine strip: eval from White's POV, depth, PV, best move */}
        <div className="mt-2 rounded-xl bg-card px-4 py-3 shadow-sm" role="status" aria-live="polite">
          {info && strip ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-extrabold tabular-nums">{strip.big}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{strip.side}</span>
              </div>
              <span
                className="text-xs font-semibold text-muted-foreground"
                title={info.depth < askDepth ? `Asked depth ${askDepth} — the time budget stopped it at ${info.depth}` : `Engine depth ${info.depth}`}
              >
                Depth {info.depth}
                {info.depth < askDepth ? <span className="text-[10px] text-muted-foreground">/{askDepth}</span> : null}
              </span>
              {info.pvSan.length > 0 && (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="Engine principal variation">
                  {info.pvSan.slice(0, 8).map((san, i) => (
                    <span
                      key={`${i}-${san}`}
                      title={i === 0 ? 'Engine choice' : `PV move ${i + 1}`}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-mono text-xs',
                        i === 0 ? 'bg-primary/15 font-bold text-primary' : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {san}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs font-bold" title="Engine best move">
                  Best: {info.bestSan ?? '—'}
                </span>
                <Button size="sm" className="min-h-11" onClick={playBest} disabled={!info.bestSan || analyzing}>
                  <Play className="h-4 w-4" /> Play best move
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        {note && (
          <div className="mt-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs font-medium text-foreground" role="status">
            {note}
          </div>
        )}

        {/* depth ladder: Fast/Balanced/Deep/Deepest + Deeper tail + Unlimited */}
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-card px-4 py-2.5 shadow-sm">
          <Micro>Engine depth</Micro>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Analysis depth presets">
            {depthLadder.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={!unlimited && freeDepth === d}
                onClick={() => {
                  setUnlimited(false)
                  setFreeDepth(d)
                }}
                className={cn(
                  'min-h-9 rounded-lg px-2.5 text-xs font-bold transition-colors',
                  !unlimited && freeDepth === d
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d === 10 ? 'Fast 10' : d === 14 ? 'Balanced 14' : d === 18 ? 'Deep 18' : 'Deepest 24'}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-9"
            disabled={unlimited || freeDepth >= 40}
            onClick={() => {
              setUnlimited(false)
              setFreeDepth((d) => Math.min(40, d + 8))
            }}
            title="Ask the engine for 8 more plies of depth"
          >
            <Zap className="h-3.5 w-3.5" /> Analyze deeper
          </Button>
          <button
            type="button"
            aria-pressed={unlimited}
            onClick={() => setUnlimited((u) => !u)}
            className={cn(
              'min-h-9 rounded-lg px-2.5 text-xs font-bold transition-colors',
              unlimited ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Unlimited
          </button>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">asking depth {askDepth}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => gotoAbs(0)} disabled={viewPly === 0} title="Jump to the root position">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={undo} disabled={viewPly === 0} title="Take back (or step back while browsing)">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => gotoAbs(viewPly + 1)} disabled={atTip} title="Step forward">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => gotoAbs(posHistory.length - 1)} disabled={atTip} title="Jump to the latest move">
            <ChevronsRight className="h-4 w-4" />
          </Button>
          {!atTip && (
            <Button variant="default" className="min-h-11" onClick={() => gotoAbs(posHistory.length - 1)}>
              Jump to latest
            </Button>
          )}
          <Button variant="secondary" className="min-h-11" onClick={reset}>
            <Trash2 className="h-4 w-4" /> Reset
          </Button>
          <Button
            variant={showBest ? 'default' : 'secondary'}
            className="min-h-11"
            onClick={() => setShowBest(!showBest)}
            aria-pressed={showBest}
          >
            {showBest ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Engine arrow
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={copyLink} title="Copy a shareable link to this exact position (?fen=…)">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Share position'}
          </Button>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            <span className="sr-only">{analyzing ? 'Engine analyzing' : 'Engine idle'}</span>
          </div>
        </div>
        {!atTip && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Browsing move {viewPly} of {posHistory.length - 1}. Play a move here to spin a new sideline universe from this ply.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-xl bg-card shadow-sm">
          <div className="border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</div>
          <MoveList moves={moves} cursor={viewPly - 1} onSelect={(ply) => gotoAbs(ply + 1)} maxHeightClass="max-h-72" />
        </div>

        <div className="rounded-xl bg-card p-4 shadow-sm">
          <Micro>Load a position</Micro>
          <div className="mt-2 flex gap-2">
            <Textarea
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              placeholder="Paste a FEN…"
              aria-label="FEN to load"
              className="min-h-[60px] font-mono text-xs"
            />
            <Button className="btn-hero self-end" size="sm" onClick={loadFen}>
              Load
            </Button>
          </div>
          {!showPgnInput ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setShowPgnInput(true)}
            >
              …or load a PGN instead
            </button>
          ) : (
            <div className="mt-3 flex gap-2">
              <Textarea
                value={pgnInput}
                onChange={(e) => setPgnInput(e.target.value)}
                placeholder="Paste a full game PGN…"
                aria-label="PGN to load"
                className="min-h-[60px] font-mono text-xs"
              />
              <Button className="btn-hero self-end" size="sm" onClick={loadPgn}>
                Load
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game review
// ---------------------------------------------------------------------------

/** Depth presets for the review engine. Balanced 14 is the default. */
const DEPTH_OPTIONS: { label: string; depth: number }[] = [
  { label: 'Fast', depth: 10 },
  { label: 'Balanced', depth: 14 },
  { label: 'Deep', depth: 18 },
  { label: 'Deepest', depth: 24 },
]
const DEFAULT_DEPTH = 14
const MAX_DEPTH = 26 // matches the server clamp in /api/analysis/evals
const REVIEW_CHUNK = 12

interface KeyMoment {
  index: number
  eval: PlyEvalDTO
}

interface GUIReport {
  accuracyWhite: number | null
  accuracyBlack: number | null
  bestMove: Callout | null
  worstMove: Callout | null
  areas: ReviewAreas
}

function GameReview({ initialPgn, onPgnChange }: { initialPgn: string; onPgnChange: (s: string) => void }) {
  const [pgn, setPgn] = useState(initialPgn)
  // the saved game this review belongs to, when it came from the Play tab
  const gameId = useApp.getState().reviewGameId
  const navigate = useApp((s) => s.navigate)
  const setPlayRequest = useApp((s) => s.setPlayRequest)
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
  useEffect(
    () => () => {
      speechRunRef.current += 1
      stopSpeaking()
    },
    [],
  )

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

  // depth control: chosen preset + the depth the finished analysis actually used
  const [depthChosen, setDepthChosen] = useState<number>(DEFAULT_DEPTH)
  const [analyzedDepth, setAnalyzedDepth] = useState<number | null>(null)

  // one-time parse of the incoming PGN during first render (no effect needed)
  const initialParse = useMemo(() => parseGame(initialPgn), [initialPgn])
  const [plies, setPlies] = useState<ReviewPly[]>(initialParse.plies)
  const [clockSpent, setClockSpent] = useState<(number | null)[] | null>(initialParse.clocks)
  // sparse-aligned with `plies`: undefined = not evaluated (yet)
  const [evals, setEvals] = useState<(PlyEvalDTO | undefined)[]>([])
  const [theory, setTheory] = useState<TheoryInfo | null>(null)
  const [cursor, setCursor] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(initialParse.error)
  const [savedToInsights, setSavedToInsights] = useState(false)
  const [engineName, setEngineName] = useState<string | null>(null)

  const parsePgn = useCallback(
    (text: string) => {
      const parsed = parseGame(text)
      stopSpeech()
      setPlies(parsed.plies)
      setClockSpent(parsed.clocks)
      setEvals([])
      setTheory(null)
      setCursor(-1)
      setPlaying(false)
      setAnalyzing(false)
      setProgress(0)
      setAnalyzedDepth(null)
      setSavedToInsights(false)
      setEngineName(null)
      setImportNote(null)
      setError(parsed.error)
    },
    [stopSpeech],
  )

  // chessigma-style online import: one-line attribution for games brought in
  // through the import panel ("Imported 84 plies from lichess game abc123")
  const [importNote, setImportNote] = useState<string | null>(null)

  // "Save as drill": pushes an error moment into the Mistake Corrector queue
  const [savedDrillKeys, setSavedDrillKeys] = useState<Set<number>>(new Set())
  const [savingDrillKey, setSavingDrillKey] = useState<number | null>(null)
  const [drillErrors, setDrillErrors] = useState<Record<number, string>>({})

  /** Handoff for ImportGamePanel: reuse the exact textarea → parsePgn flow. */
  const handleImport = useCallback(
    (text: string, source?: string) => {
      const parsed = parseGame(text)
      setPgn(text)
      onPgnChange(text)
      parsePgn(text) // resets report state and clears any stale note
      if (source && parsed.plies.length > 0) {
        setImportNote(`Imported ${parsed.plies.length} plies from ${source}`)
      }
    },
    [onPgnChange, parsePgn],
  )

  /** Best move for a FEN as SAN (from a UCI pv head), null when unavailable. */
  const sanOfUci = useCallback((fen: string, uci: string | null): string | null => {
    if (!uci || uci.length < 4 || uci === '(none)') return null
    try {
      const g = new Chess(fen)
      const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
      return mv?.san ?? null
    } catch {
      return null
    }
  }, [])

  const persistReport = useCallback(
    async (clean: PlyEvalDTO[]) => {
      if (!gameId || clean.length === 0) return
      try {
        const res = await fetch('/api/games/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, plies: clean, localHour: new Date().getHours() }),
        })
        if (res.ok) setSavedToInsights(true)
      } catch {
        /* report saving is best effort, the on-screen report still works */
      }
    },
    [gameId],
  )

  /**
   * The client-side fallback loop, used when the server engine is unreachable.
   * It feeds the FROZEN classifier (classifyMove) with everything measurable
   * in the browser: evals before/after, forced-mate info, the engine's best
   * reply, sacrifice geometry and legal-move counts. The loose inline label
   * decision is gone — the label set can never drift from the server's.
   */
  const runReviewLocal = useCallback(
    async (depth: number) => {
      const localDepth = Math.min(depth, 14) // the browser wasm stays usable
      setEngineName('Stockfish (browser wasm) · client fallback')
      const results: (PlyEvalDTO | undefined)[] = []
      // the after-position of ply i is the before-position of ply i+1: reuse it
      let cachedFen: string | null = null
      let cachedRes: EngineInfo | null = null

      for (let i = 0; i < plies.length; i++) {
        const p = plies[i]
        const gBefore = new Chess(p.fenBefore)
        const turn = gBefore.turn()
        let beforeRes: EngineInfo
        if (cachedFen === p.fenBefore && cachedRes) {
          beforeRes = cachedRes
          cachedFen = null
          cachedRes = null
        } else {
          beforeRes = await engine.eval({ fen: p.fenBefore, depth: localDepth })
        }
        const legalMoveCount = gBefore.moves().length

        // white-POV pawns, mate flattened to ±80
        const beforeWhite = evalToWhitePov(beforeRes, turn)
        const mateBeforeForWhite = beforeRes.mate != null ? (turn === 'w' ? beforeRes.mate > 0 : beforeRes.mate < 0) : null
        const mateBeforePlies = beforeRes.mate != null ? Math.abs(beforeRes.mate) : null

        const gAfter = new Chess(p.fenBefore)
        gAfter.move(p.san)
        const afterTurn = gAfter.turn()
        const verboseAfter = gAfter.history({ verbose: true })
        const mv = verboseAfter[verboseAfter.length - 1] ?? null

        let afterWhite: number
        let mateAfterForWhite: boolean | null = null
        let mateAfterPlies: number | null = null
        let bestReplyTakesOffer = false

        if (gAfter.isCheckmate()) {
          afterWhite = afterTurn === 'w' ? -80 : 80
          // the side to move now is the one being mated
          mateAfterForWhite = afterTurn === 'b'
          mateAfterPlies = 1
        } else if (gAfter.isGameOver()) {
          afterWhite = 0
        } else {
          const afterRes = await engine.eval({ fen: gAfter.fen(), depth: localDepth })
          afterWhite = evalToWhitePov(afterRes, afterTurn)
          if (afterRes.mate != null) {
            mateAfterForWhite = afterTurn === 'w' ? afterRes.mate > 0 : afterRes.mate < 0
            mateAfterPlies = Math.abs(afterRes.mate)
          }
          // is the engine's best reply the capture of the piece that just landed?
          const replyUci = afterRes.pv[0]
          if (mv && replyUci && replyUci.length >= 4) {
            try {
              const probe = new Chess(gAfter.fen())
              const reply = probe.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci.slice(4, 5) || undefined })
              bestReplyTakesOffer = reply != null && reply.to === mv.to && /[ce]/.test(reply.flags)
            } catch {
              bestReplyTakesOffer = false
            }
          }
          cachedFen = gAfter.fen()
          cachedRes = afterRes
        }

        const bestSan = sanOfUci(p.fenBefore, beforeRes.pv[0] ?? null)
        const isBest = bestSan != null && stripSuffix(bestSan) === stripSuffix(p.san)

        const input: ClassifyInput = {
          fenBefore: p.fenBefore,
          san: p.san,
          color: p.color,
          before: beforeWhite,
          after: afterWhite,
          mateBeforeForWhite,
          mateBeforePlies,
          mateAfterForWhite,
          mateAfterPlies,
          bestSan,
          secondBestSan: null,
          secondBestBefore: null,
          legalMoveCount,
          isBest,
          movedPiece: mv?.piece ?? null,
          capturedPiece: mv?.captured ?? null,
          offerCanBeTaken: mv ? gAfter.moves({ verbose: true }).some((m) => m.to === mv.to && /[ce]/.test(m.flags)) : false,
          bestReplyTakesOffer,
          bookHit: false,
          ply: i + 1,
        }

        results[i] = {
          san: p.san,
          color: p.color,
          before: round2(beforeWhite),
          after: round2(afterWhite),
          bestUci: beforeRes.pv[0] ?? null,
          bestSan,
          label: classifyMove(input),
          cpl: cplOf(beforeWhite, afterWhite, p.color),
          timeSpentSec: clockSpent?.[i] ?? null,
        }
        setEvals([...results])
        setProgress(Math.round(((i + 1) / plies.length) * 100))
      }
      setAnalyzing(false)
      setAnalyzedDepth(localDepth)
      void persistReport(results.filter((e): e is PlyEvalDTO => e != null))
    },
    [plies, clockSpent, sanOfUci, persistReport],
  )

  /**
   * Deep review on the server: the app's engine core (native Stockfish 19)
   * evaluates every position at the chosen depth and classifies each move
   * through the same frozen classifier. Work is sent in chunks so the progress
   * bar shows real progress, and the engine result cache makes overlapping
   * positions free across chunks and re-reviews.
   */
  const runReview = useCallback(
    async (depthOverride?: number) => {
      if (plies.length === 0 || analyzing) return
      const depth = Math.max(8, Math.min(MAX_DEPTH, Math.round(depthOverride ?? depthChosen)))
      setAnalyzing(true)
      setProgress(0)
      setSavedToInsights(false)
      setEngineName(null)
      setPlaying(false)
      stopSpeech() // fresh numbers make old spoken lines stale
      const results: (PlyEvalDTO | undefined)[] = []
      let serverRan = false
      let theoryFromServer: TheoryInfo | null = null
      let depthReached = depth

      for (let from = 0; from < plies.length; from += REVIEW_CHUNK) {
        const slice = plies.slice(from, from + REVIEW_CHUNK)
        try {
          const res = await fetch('/api/analysis/evals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plies: slice.map((p) => ({ san: p.san, color: p.color, fenBefore: p.fenBefore })),
              depth,
            }),
          })
          if (!res.ok) throw new Error(`status ${res.status}`)
          const data = await readJson<EvalsChunkResponse>(res)
          const chunk = Array.isArray(data.evals) ? data.evals : []
          if (typeof data.depth === 'number' && data.depth > 0) depthReached = data.depth
          if (data.engine) setEngineName(`${data.engine} · depth ${depthReached}`)

          // align the answer to the requested slice: prefer SAN matching (a
          // server may skip plies it cannot validate), positional otherwise
          let matched = 0
          let k = 0
          slice.forEach((p, j) => {
            const e = chunk[k]
            if (e && typeof e.san === 'string' && e.san === p.san) {
              results[from + j] = toPlyEval(e, p, clockSpent?.[from + j] ?? null)
              k += 1
              matched += 1
            }
          })
          if (matched === 0 && chunk.length > 0) {
            chunk.forEach((e, j) => {
              const p = slice[j]
              if (p && e) results[from + j] = toPlyEval(e, p, clockSpent?.[from + j] ?? null)
            })
          }
          const t = readTheory(data)
          if (t && !theoryFromServer) theoryFromServer = t
          serverRan = true
          setEvals([...results])
          setProgress(Math.round(Math.min(100, ((from + Math.max(chunk.length, 1)) / plies.length) * 100)))
          if (chunk.length < slice.length) break // engine stopped early, keep what we have
        } catch {
          break // server engine unreachable or failed mid-run
        }
      }

      if (theoryFromServer) setTheory(theoryFromServer)

      if (!serverRan) {
        // honest fallback: same UI, client wasm numbers, frozen classifier
        await runReviewLocal(depth)
        return
      }
      setAnalyzing(false)
      setAnalyzedDepth(depthReached)
      void persistReport(results.filter((e): e is PlyEvalDTO => e != null))
    },
    [plies, analyzing, depthChosen, clockSpent, stopSpeech, runReviewLocal, persistReport],
  )

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault() // keep the page from scrolling while stepping
        setPlaying(false)
        setCursor((c) => Math.max(-1, c - 1))
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        setCursor((c) => Math.min(plies.length - 1, c + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plies.length])

  // playback: auto-advance one ply at a time until the end of the game
  useEffect(() => {
    if (!playing) return
    if (cursor >= plies.length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setCursor((c) => Math.min(plies.length - 1, c + 1)), 1200)
    return () => clearTimeout(t)
  }, [playing, cursor, plies.length])

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

  const shownFen = fenAfterPly(plies, cursor, startFen)
  const plyEval = cursor >= 0 ? (evals[cursor] ?? null) : null

  const headers = useMemo(() => pgnHeaders(pgn), [pgn])
  const result = resultText(headers.result)

  /** Evaluated plies (dense prefix), plus ply-aligned label/cpl arrays for the move list. */
  const doneEvals = useMemo(() => evals.filter((e): e is PlyEvalDTO => e != null), [evals])
  const labelsForList = useMemo(
    () =>
      plies.map((_, i) => {
        const e = evals[i]
        return e ? coerceLabel(e.label) : null
      }),
    [plies, evals],
  )
  const cplsForList = useMemo(
    () =>
      plies.map((_, i) => {
        const e = evals[i]
        return e ? (e.cpl ?? cplOf(e.before, e.after, e.color)) : null
      }),
    [plies, evals],
  )

  const openingInfo = useMemo<TheoryInfo>(
    () =>
      theory ?? {
        openingName: detectOpening(plies.map((p) => p.san)),
        theoryPlies: 0,
        firstDeviationSan: null,
      },
    [theory, plies],
  )

  const report = useMemo<GUIReport | null>(() => {
    if (doneEvals.length === 0) return null
    const accFor = (color: 'w' | 'b'): number | null => {
      const cpls = doneEvals.filter((e) => e.color === color).map((e) => e.cpl ?? cplOf(e.before, e.after, e.color))
      return cpls.length > 0 ? accuracyOfCpl(cpls) : null
    }
    const { bestMove, worstMove } = computeCallouts(doneEvals)
    const areas = computeReviewAreas(doneEvals, openingInfo, clockSpent)
    return { accuracyWhite: accFor('w'), accuracyBlack: accFor('b'), bestMove, worstMove, areas }
  }, [doneEvals, openingInfo, clockSpent])

  const bestCallout = report?.bestMove ?? null
  const worstCallout = report?.worstMove ?? null

  const counts = useMemo(() => {
    const c: Record<'w' | 'b', Partial<Record<MoveLabel, number>>> = { w: {}, b: {} }
    for (const e of doneEvals) {
      const l = coerceLabel(e.label)
      c[e.color][l] = (c[e.color][l] ?? 0) + 1
    }
    return c
  }, [doneEvals])

  const moments = useMemo(() => keyMoments(doneEvals), [doneEvals])

  const jumpTo = useCallback(
    (ply: number) => {
      if (!Number.isFinite(ply)) return
      setPlaying(false)
      setCursor(Math.max(-1, Math.min(plies.length - 1, ply - 1)))
    },
    [plies.length],
  )

  /** Replay the position right before a key moment against a bot, from the
   * mover's side — the review-to-rematch loop: find the turning move, refight
   * it. The bot strength travels with the game when it was a bot game. */
  const replayFrom = useCallback(
    (index: number, color: 'w' | 'b') => {
      const fen = index <= 0 ? startFen : fenAfterPly(plies, index - 1, startFen)
      const est = [headers.white, headers.black]
        .map((h) => /est\.\s*(\d+)/.exec(h ?? '')?.[1])
        .find(Boolean)
      let botLevel: number | undefined
      if (est) {
        const rating = Number(est)
        const nearest = BOTS.reduce((best, b) => (Math.abs(b.rating - rating) < Math.abs(best.rating - rating) ? b : best), BOTS[0])
        botLevel = nearest.level
      }
      setPlayRequest({ fen, botLevel, color })
      navigate('play')
    },
    [plies, startFen, headers, setPlayRequest, navigate],
  )

  // the side the player had in this game, when the PGN headers reveal it
  // (bot games carry the profile name; imported games match when the
  // imported username is the profile name)
  const playerColor = useMemo<'w' | 'b' | null>(() => {
    const name = profile?.name
    if (!name) return null
    if (headers.white === name) return 'w'
    if (headers.black === name) return 'b'
    return null
  }, [headers, profile])

  /** "Save as drill": store this exact error moment for the Mistake
   * Corrector in Review — the position before it, the played move and the
   * engine's preference travel together so the drill can be replayed. */
  const saveAsDrill = useCallback(
    async (index: number, e: PlyEvalDTO) => {
      if (savingDrillKey != null) return
      setSavingDrillKey(index)
      try {
        const fen = index <= 0 ? startFen : fenAfterPly(plies, index - 1, startFen)
        const res = await fetch('/api/drills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen,
            userSan: e.san,
            bestSan: e.bestSan ?? undefined,
            evalLossCp: e.cpl ?? cplOf(e.before, e.after, e.color),
            plyNumber: index,
            gameRecordId: gameId ?? undefined,
            opening: openingInfo.openingName || undefined,
            opponent: (e.color === 'w' ? headers.black : headers.white) ?? undefined,
          }),
        })
        const data = await readJson<{ error?: string }>(res)
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
        setSavedDrillKeys((s) => new Set(s).add(index))
      } catch (err) {
        setDrillErrors((m) => ({ ...m, [index]: err instanceof Error ? err.message : 'Could not save the drill' }))
      } finally {
        setSavingDrillKey(null)
      }
    },
    [savingDrillKey, plies, startFen, gameId, openingInfo, headers],
  )

  /** Read the key moments in display order, one line each, stoppable at any point. */
  const speakReport = useCallback(() => {
    if (!speechReady) return
    if (queueRunning) {
      stopSpeech()
      return
    }
    const items = moments.map(({ index, eval: e }) => ({
      id: `m${index}`,
      text: `${moveNumberOf(index)}. ${e.san} (${sideName(e.color)}): ${metaOf(e.label).text}. ${reasonFor(e)}`,
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

  const deeperTarget = Math.min(MAX_DEPTH, (analyzedDepth ?? depthChosen) + 8)
  const showDeeper = doneEvals.length > 0 && !analyzing && (analyzedDepth ?? depthChosen) < MAX_DEPTH

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        {/* bar + board share one stretch row so the bar matches the board exactly */}
        <div className="flex gap-2">
          <EvalBar score={plyEval?.after ?? 0} className="hidden sm:block" />
          <div className="min-w-0 flex-1">
            <ChessBoard fen={shownFen} interactive={false} lastMove={cursor >= 0 ? extractLastMove(plies, cursor) : null} />
          </div>
        </div>

        {/* playback controls: first / prev / play / next / last */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11"
            onClick={() => {
              setPlaying(false)
              setCursor(-1)
            }}
            disabled={cursor === -1}
            aria-label="Go to game start"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11"
            onClick={() => {
              setPlaying(false)
              setCursor((c) => Math.max(-1, c - 1))
            }}
            disabled={cursor === -1}
            aria-label="Previous move"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11"
            onClick={() => setPlaying((p) => !p)}
            disabled={plies.length === 0}
            aria-pressed={playing}
            aria-label={playing ? 'Pause playback' : 'Play through the game'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11"
            onClick={() => {
              setPlaying(false)
              setCursor((c) => Math.min(plies.length - 1, c + 1))
            }}
            disabled={cursor >= plies.length - 1}
            aria-label="Next move"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11"
            onClick={() => {
              setPlaying(false)
              setCursor(plies.length - 1)
            }}
            disabled={plies.length === 0 || cursor >= plies.length - 1}
            aria-label="Go to game end"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>

        {/* eval graph: white/gray area with orange error dots, click to jump */}
        {doneEvals.length > 1 && (
          <div className="mt-3 rounded-xl bg-card p-3 shadow-sm">
            <EvalGraph
              evals={doneEvals}
              cursor={cursor}
              onSeek={(i) => {
                setPlaying(false)
                jumpTo(i + 1)
              }}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {plies.length === 0 ? (
          <div className="rounded-xl bg-card p-6 shadow-sm">
            <Micro>Load a game</Micro>
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
              aria-label="PGN to review"
              className="mt-3 min-h-[120px] font-mono text-xs"
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <Button className="btn-hero mt-3 min-h-11 w-full" onClick={() => parsePgn(pgn)} disabled={!pgn.trim()}>
              Load game
            </Button>
            <ImportGamePanel onImport={handleImport} className="mt-2" />
          </div>
        ) : (
          <>
            {/* ---------------- report header ---------------- */}
            <div className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <Micro>Game report</Micro>
                {analyzing && (
                  <span className="text-sm font-bold tabular-nums text-muted-foreground">{progress}%</span>
                )}
              </div>
              {(headers.white || headers.black || result) && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  {headers.white && <span className="font-bold">{headers.white}</span>}
                  {headers.white && headers.black && <span className="text-xs text-muted-foreground">vs</span>}
                  {headers.black && <span className="font-bold">{headers.black}</span>}
                  {result && <span className="ml-auto rounded-md bg-secondary px-1.5 py-0.5 text-xs font-bold">{result}</span>}
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                Opening: <span className="font-semibold text-foreground">{openingInfo.openingName}</span>
                {openingInfo.theoryPlies > 0 && (
                  <span>
                    {' '}
                    · left book at move {moveNumberOf(openingInfo.theoryPlies)}
                    {openingInfo.firstDeviationSan ? ` (${openingInfo.firstDeviationSan})` : ''}
                  </span>
                )}
              </div>
              {importNote && (
                <div className="mt-0.5 text-[11px] font-semibold text-primary" role="status">
                  {importNote}
                </div>
              )}
              {engineName && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Engine: <span className="font-semibold text-foreground">{engineName}</span>
                </div>
              )}
              {report && (report.accuracyWhite != null || report.accuracyBlack != null) ? (
                <div className="mt-2 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <div className="font-display text-2xl font-extrabold tabular-nums">
                      {report.accuracyWhite != null ? `${report.accuracyWhite}%` : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">White accuracy</div>
                  </div>
                  <div>
                    <div className="font-display text-2xl font-extrabold tabular-nums">
                      {report.accuracyBlack != null ? `${report.accuracyBlack}%` : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">Black accuracy</div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {analyzing ? 'Evaluating every move…' : 'Press analyze to evaluate each move.'}
                </p>
              )}
              {analyzing && (
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}

              {/* depth control */}
              <div className="mt-3">
                <Micro>Engine depth</Micro>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Analysis depth">
                  {DEPTH_OPTIONS.map((o) => (
                    <button
                      key={o.depth}
                      type="button"
                      role="radio"
                      aria-checked={depthChosen === o.depth}
                      disabled={analyzing}
                      onClick={() => setDepthChosen(o.depth)}
                      className={cn(
                        'min-h-11 rounded-lg px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        depthChosen === o.depth
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o.label} <span className="ml-0.5 font-mono">{o.depth}</span>
                    </button>
                  ))}
                </div>
              </div>

              {!analyzing && (
                <div className="mt-3 flex gap-2">
                  <Button className="btn-hero min-h-11 flex-1" onClick={() => void runReview()} disabled={analyzing}>
                    <Sparkles className="h-4 w-4" /> {doneEvals.length ? 'Re-analyze' : 'Analyze game'}
                  </Button>
                  {doneEvals.length > 0 && (
                    <CopyReportButton
                      buildText={() =>
                        reportText({
                          white: headers.white ?? 'White',
                          black: headers.black ?? 'Black',
                          result,
                          opening: openingInfo.openingName,
                          whiteAcc: report?.accuracyWhite ?? null,
                          blackAcc: report?.accuracyBlack ?? null,
                          evals: doneEvals,
                          moments,
                          bestMove: bestCallout,
                          worstMove: worstCallout,
                        })
                      }
                    />
                  )}
                </div>
              )}
              {showDeeper && (
                <Button variant="secondary" className="mt-2 min-h-11 w-full" onClick={() => void runReview(deeperTarget)}>
                  <Zap className="h-4 w-4" /> Analyze deeper (depth {deeperTarget})
                </Button>
              )}
              {savedToInsights && <p className="mt-2 text-xs font-semibold text-primary">Saved to your insights.</p>}
              {!savedToInsights && doneEvals.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Insights only collect games you play here. Paste a PGN from somewhere else and it stays out.
                </p>
              )}
              {gameId && doneEvals.length > 0 && (
                <Button
                  variant="secondary"
                  className="mt-3 min-h-11 w-full"
                  onClick={() => {
                    useApp.getState().setPendingCoachGame(gameId)
                    useApp.getState().navigate('coach')
                  }}
                >
                  <MessageSquareText className="h-4 w-4" /> Ask the coach about this game
                </Button>
              )}
            </div>

            {/* ---------------- best & turning-point callouts ---------------- */}
            {bestCallout && (
              <CalloutCard title="Your best move" callout={bestCallout} onJump={() => jumpTo(bestCallout.ply)} />
            )}
            {worstCallout && (
              <CalloutCard title="The turning point" callout={worstCallout} onJump={() => jumpTo(worstCallout.ply)} />
            )}

            {/* ---------------- move quality (12 labels, good vs bad) ---------------- */}
            {report && (
              <div className="rounded-xl bg-card p-4 shadow-sm">
                <Micro>Move quality</Micro>
                <div className="mt-2 grid grid-cols-2 gap-x-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Good
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {GOOD_ORDER.map((l) => (
                        <QualityRow key={l} label={l} w={counts.w[l] ?? 0} b={counts.b[l] ?? 0} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-destructive">
                      <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden /> Bad
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {BAD_ORDER.map((l) => (
                        <QualityRow key={l} label={l} w={counts.w[l] ?? 0} b={counts.b[l] ?? 0} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-right text-[10px] text-muted-foreground">White / Black</div>
              </div>
            )}

            {/* ---------------- key moments ---------------- */}
            {moments.length > 0 && (
              <div className="rounded-xl bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <Micro>Key moments</Micro>
                  {speechReady && (
                    <Button
                      variant={queueRunning ? 'default' : 'secondary'}
                      size="sm"
                      className="min-h-9 px-2.5 text-xs transition-transform active:scale-95"
                      onClick={speakReport}
                      aria-pressed={queueRunning}
                      aria-label={queueRunning ? 'Stop reading the report' : 'Listen to report'}
                    >
                      {queueRunning ? (
                        <>
                          <SquareIcon className="h-3 w-3" /> Stop
                          <span className="font-normal text-primary-foreground/80">
                            {queuePos}/{moments.length}
                          </span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" /> Listen
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="scroll-slim mt-2 max-h-80 space-y-1 overflow-y-auto pr-1">
                  {moments.map(({ index, eval: e }) => {
                    const momentId = `m${index}`
                    const line = `${moveNumberOf(index)}. ${e.san} (${sideName(e.color)}): ${metaOf(e.label).text}. ${reasonFor(e)}`
                    const isSpeaking = speakingId === momentId
                    const cpl = e.cpl ?? cplOf(e.before, e.after, e.color)
                    // "Save as drill" only makes sense on the player's own errors
                    const isMyError =
                      BAD_ORDER.includes(coerceLabel(e.label)) && (playerColor == null || e.color === playerColor)
                    return (
                      <div
                        key={index}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent',
                          isSpeaking && 'bg-primary/10',
                        )}
                      >
                        <button
                          onClick={() => jumpTo(index + 1)}
                          className="pressable flex min-w-0 flex-1 items-start gap-2 rounded-md text-left"
                          aria-label={`Go to move ${moveNumberOf(index)}, ${e.san}`}
                        >
                          <span className="mt-0.5 shrink-0">
                            <LabelBadge label={e.label} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold">
                              {moveNumberOf(index)}. {e.san}
                              <span className="ml-1 font-normal text-muted-foreground">({sideName(e.color)})</span>
                              {cpl > 0 && <span className="ml-1.5 font-mono text-[10px] font-normal tabular-nums text-muted-foreground">{cpl}cp</span>}
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
                              'mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-accent active:scale-90',
                              isSpeaking && 'bg-primary/15 text-primary',
                            )}
                          >
                            {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => replayFrom(index, e.color)}
                          aria-label={`Replay from the position before move ${moveNumberOf(index)}, ${e.san}`}
                          title="Refight this position against the bot, from this side"
                          className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-accent active:scale-90"
                        >
                          <Undo2 className="h-4 w-4" />
                        </button>
                        {isMyError &&
                          (drillErrors[index] ? (
                            <span className="mt-0.5 max-w-[9rem] shrink-0 text-right text-[10px] leading-tight text-destructive" role="alert">
                              {drillErrors[index]}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => saveAsDrill(index, e)}
                              disabled={savingDrillKey === index}
                              aria-label={`Save move ${moveNumberOf(index)} as a drill in the Mistake Corrector`}
                              title={
                                savedDrillKeys.has(index)
                                  ? 'Saved — find it under Review › Fix your mistakes'
                                  : 'Save as drill — replay this exact mistake until you master it'
                              }
                              className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-accent active:scale-90"
                            >
                              {savingDrillKey === index ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : savedDrillKeys.has(index) ? (
                                <Check className="h-4 w-4 text-primary" />
                              ) : (
                                <Target className="h-4 w-4" />
                              )}
                            </button>
                          ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ---------------- five-area breakdown (chessigma) ---------------- */}
            {report && (
              <>
                <AreaCard title="Blunders" callouts={report.areas.blunders} onJump={jumpTo} />
                <AreaCard title="Tactics" callouts={report.areas.tactics} onJump={jumpTo} />
                {report.areas.clock && <ClockCard clock={report.areas.clock} onJump={jumpTo} />}
                <AreaCard title="Converting wins" callouts={report.areas.conversion} onJump={jumpTo} />
                <div className="rounded-xl bg-card p-4 shadow-sm">
                  <Micro>Openings</Micro>
                  <div className="mt-1.5 text-sm font-bold">{openingInfo.openingName}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {openingInfo.theoryPlies > 0
                      ? `${openingInfo.theoryPlies} plies of theory${
                          openingInfo.firstDeviationSan ? ` · left book at ${openingInfo.firstDeviationSan}` : ' · stayed in book'
                        }`
                      : 'Play the main lines to build a real repertoire.'}
                  </div>
                </div>
              </>
            )}

            {/* ---------------- move list ---------------- */}
            <div className="rounded-xl bg-card shadow-sm">
              <div className="border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</div>
              <MoveList
                moves={plies.map((p) => p.san)}
                cursor={cursor}
                onSelect={(ply) => {
                  setPlaying(false)
                  setCursor(ply)
                }}
                labels={labelsForList}
                cpls={cplsForList}
                maxHeightClass="max-h-80"
                className="p-2"
              />
            </div>

            {/* ---------------- selected move detail ---------------- */}
            {plyEval && (
              <div className="rounded-xl bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
                    style={{ background: metaOf(plyEval.label).color }}
                  >
                    <span aria-hidden>{metaOf(plyEval.label).glyph}</span> {metaOf(plyEval.label).text}
                  </span>
                  <span className="font-mono text-sm font-bold">{plyEval.san}</span>
                  <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    {(plyEval.cpl ?? 0) > 0 && (
                      <span className="font-mono text-xs tabular-nums">{plyEval.cpl}cp</span>
                    )}
                    <span className="font-mono tabular-nums">
                      {fmtEval(plyEval.before)} → {fmtEval(plyEval.after)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{reasonFor(plyEval)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** One row of the good/bad move-quality summary. */
function QualityRow({ label, w, b }: { label: MoveLabel; w: number; b: number }) {
  const meta = LABEL_META[label]
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-0.5 text-[8px] font-bold leading-none text-white"
          style={{ background: meta.color }}
          aria-hidden
        >
          {meta.glyph}
        </span>
        <span className="truncate text-xs text-muted-foreground">{meta.text}</span>
      </span>
      <span className="shrink-0 text-xs font-bold tabular-nums">
        <span className="text-foreground">{w}</span>
        <span className="mx-0.5 text-muted-foreground">/</span>
        <span className="text-foreground">{b}</span>
      </span>
    </div>
  )
}

/** "Your best move" / "The turning point" highlight card; click jumps to the ply. */
function CalloutCard({ title, callout, onJump }: { title: string; callout: Callout; onJump: () => void }) {
  const meta = metaOf(callout.label)
  return (
    <button
      type="button"
      onClick={onJump}
      className="pressable w-full rounded-xl bg-card p-4 text-left shadow-sm hover:shadow-md"
      aria-label={`${title}: ${callout.headline} Jump to the position.`}
    >
      <Micro>{title}</Micro>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none text-white"
          style={{ background: meta.color }}
          aria-hidden
        >
          {meta.glyph}
        </span>
        <span className="font-mono text-sm font-bold">{callout.san}</span>
        <span className="ml-auto text-xs text-muted-foreground">{sideName(callout.color)}</span>
      </div>
      <div className="mt-1.5 text-sm font-bold leading-snug">{callout.headline}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{callout.detail}</div>
    </button>
  )
}

/** One chessigma area card: microlabel header + scrollable callout chips. */
function AreaCard({ title, callouts, onJump }: { title: string; callouts: Callout[]; onJump: (ply: number) => void }) {
  if (callouts.length === 0) return null
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <Micro>{title}</Micro>
      <div className="scroll-slim mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
        {callouts.map((c) => (
          <AreaChip key={c.ply} callout={c} onJump={onJump} />
        ))}
      </div>
    </div>
  )
}

/** A clickable chip row: label-colored dot + SAN + short headline. */
function AreaChip({ callout, onJump }: { callout: Callout; onJump: (ply: number) => void }) {
  const meta = metaOf(callout.label)
  return (
    <button
      type="button"
      onClick={() => onJump(callout.ply)}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-accent"
      aria-label={`Go to ${callout.san}: ${callout.headline}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
      <span className="shrink-0 font-mono text-xs font-bold">{callout.san}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{callout.headline}</span>
    </button>
  )
}

/** The clock area: only rendered when the PGN actually carries %clk data. */
function ClockCard({ clock, onJump }: { clock: ClockArea; onJump: (ply: number) => void }) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Micro>The clock</Micro>
        {clock.trouble && (
          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
            Time trouble
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-sm">
        {clock.avgSec != null && (
          <>
            <span className="font-display text-lg font-extrabold tabular-nums">{clock.avgSec}s</span>
            <span className="text-xs text-muted-foreground">average per move</span>
          </>
        )}
      </div>
      {clock.flags.length > 0 && (
        <div className="scroll-slim mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
          {clock.flags.map((c) => (
            <AreaChip key={c.ply} callout={c} onJump={onJump} />
          ))}
        </div>
      )}
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

function stripSuffix(san: string): string {
  return san.replace(/[+#]/g, '')
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Engine result (side-to-move POV) -> white-POV pawns, mate flattened to ±80. */
function evalToWhitePov(res: EngineInfo, sideToMove: 'w' | 'b'): number {
  if (res.mate != null) {
    const whiteMates = sideToMove === 'w' ? res.mate > 0 : res.mate < 0
    return whiteMates ? 80 : -80
  }
  const cp = res.scoreCp ?? 0
  return (sideToMove === 'w' ? cp : -cp) / 100
}

/** One honest line per key move, generated from the numbers we already have. */
function reasonFor(e: PlyEvalDTO): string {
  if (e.reason) return e.reason // server-computed, evidence-backed explanation
  const drop = moverDrop(e)
  const best = e.bestSan
  switch (coerceLabel(e.label)) {
    case 'brilliant':
      return `A real sacrifice: the piece can be taken, but the engine confirms ${e.san} still works.`
    case 'great':
      return best ? `${e.san} was the only move that holds the position — everything else gives ground.` : 'The only move that holds the position.'
    case 'checkmate':
      return 'The game ends here — mate delivered.'
    case 'book':
      return 'Right down the main line, the way the masters play it.'
    case 'forced':
      return 'There was nothing else to consider — the move was forced.'
    case 'missedwin':
      return best ? `A win was on the board: ${best} was the way in.` : 'A winning position slipped away.'
    case 'blunder': {
      const swing = Math.abs(e.after - e.before)
      const winning = e.color === 'w' ? e.after >= 3 : e.after <= -3
      if (swing >= 20) {
        return best ? `This decides the game by force. ${best} was the shot instead.` : 'This walks into a forced finish.'
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

/** The plies worth talking about: the biggest swings plus any brilliancy. */
function keyMoments(evals: PlyEvalDTO[]): KeyMoment[] {
  const quiet = new Set<MoveLabel>(['best', 'excellent', 'good', 'book', 'forced'])
  const scored = evals.map((e, index) => {
    const drop = moverDrop(e)
    const interest = coerceLabel(e.label) === 'brilliant' ? 9 + drop : drop
    return { index, eval: e, interest }
  })
  const interesting = scored.filter((s) => !quiet.has(coerceLabel(s.eval.label)))
  interesting.sort((a, b) => b.interest - a.interest)
  return interesting.slice(0, 4).map(({ index, eval: e }) => ({ index, eval: e }))
}

function fenAfterPly(plies: ReviewPly[], cursor: number, startFen: string): string {
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

function extractLastMove(plies: ReviewPly[], cursor: number): { from: string; to: string } | null {
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

function EvalGraph({ evals, cursor, onSeek }: { evals: PlyEvalDTO[]; cursor: number; onSeek: (i: number) => void }) {
  const W = 100
  const H = 30
  const clamp = (v: number) => Math.max(-6, Math.min(6, v))
  const x = (i: number) => (evals.length <= 1 ? W / 2 : (i / (evals.length - 1)) * W)
  const y = (v: number) => H / 2 - (clamp(v) / 6) * (H / 2)
  const pts = evals.map((e, i) => `${x(i)},${y(e.after)}`)
  const errorLabels = new Set<MoveLabel>(['inaccuracy', 'mistake', 'missedwin', 'blunder'])
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-16 w-full cursor-pointer"
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation graph: click to jump to a move"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width
        onSeek(Math.round(px * (evals.length - 1)))
      }}
    >
      <rect x="0" y={y(0.5)} width={W} height={y(-0.5) - y(0.5)} fill="#81b64c" opacity="0.15" />
      <polyline points={`0,${H / 2} ${pts.join(' ')} ${W},${H / 2}`} fill="rgba(130,182,76,0.3)" stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke="#81b64c" strokeWidth="0.7" />
      {evals.map((e, i) => {
        const l = coerceLabel(e.label)
        if (!errorLabels.has(l)) return null
        return <circle key={i} cx={x(i)} cy={y(e.after)} r="0.9" fill={LABEL_META[l].color} stroke="rgba(255,255,255,0.55)" strokeWidth="0.15" />
      })}
      {cursor >= 0 && cursor < evals.length && (
        <line x1={x(cursor)} y1="0" x2={x(cursor)} y2={H} stroke="#ca3431" strokeWidth="0.5" />
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
      className="h-11 w-11 shrink-0 self-stretch"
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
  evals: PlyEvalDTO[]
  moments: KeyMoment[]
  bestMove: Callout | null
  worstMove: Callout | null
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
    for (const e of r.evals.filter((x) => x.color === color)) {
      const l = coerceLabel(e.label)
      c[l] = (c[l] ?? 0) + 1
    }
    return c
  }
  const fmt = (c: Record<string, number>) =>
    [...GOOD_ORDER, ...BAD_ORDER].map((l) => `${LABEL_META[l].text} ${c[l] ?? 0}`).join(', ')
  lines.push('')
  lines.push(`White moves: ${fmt(quality('w'))}`)
  lines.push(`Black moves: ${fmt(quality('b'))}`)
  if (r.bestMove) lines.push(`Your best move: ${r.bestMove.san} — ${r.bestMove.headline}`)
  if (r.worstMove) lines.push(`The turning point: ${r.worstMove.san} — ${r.worstMove.headline}`)
  if (r.moments.length) {
    lines.push('')
    lines.push('Key moments:')
    for (const { index, eval: e } of r.moments) {
      lines.push(`  ${moveNumberOf(index)}. ${e.san} (${sideName(e.color)}): ${metaOf(e.label).text}. ${reasonFor(e)}`)
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
  labels: Record<string, number> | null
  openings: { opening: string; games: number; wins: number; losses: number; draws: number; avgAcc: number | null }[]
  timeOfDay: { bucket: string; games: number; wins: number; avgAcc: number | null }[]
}

function InsightsPanel() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/insights')
      .then((r) => readJson<InsightsData>(r))
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
  const labels = data?.labels ?? null

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">{avgAcc}%</div>
          <div className="text-xs text-muted-foreground">Average accuracy</div>
        </div>
        <div className="rounded-xl bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">{analyzed.length}</div>
          <div className="text-xs text-muted-foreground">Analyzed game{analyzed.length === 1 ? '' : 's'}</div>
        </div>
        <div className="rounded-xl bg-card p-4 text-center shadow-sm">
          <div className="font-display text-3xl font-extrabold">
            {wins}
            <span className="text-base text-muted-foreground">/{draws}/{losses}</span>
          </div>
          <div className="text-xs text-muted-foreground">Win / draw / loss</div>
        </div>
      </div>

      <AccuracyTrend games={analyzed} />

      {labels && (
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <Micro>Your move quality mix</Micro>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {[...GOOD_ORDER, ...BAD_ORDER].map((l) => (
              <div key={l} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[l].color }} aria-hidden />
                  {LABEL_META[l].text}
                </span>
                <span className="font-bold tabular-nums">{labels[l] ?? 0}</span>
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
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <Micro>Accuracy trend</Micro>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-28 w-full" preserveAspectRatio="none" role="img" aria-label="Accuracy trend across analyzed games">
        {pts.length > 1 && <polyline points={`0,${H} ${line} ${W},${H}`} fill="rgba(130,182,76,0.15)" stroke="none" />}
        <polyline points={line} fill="none" stroke="#81b64c" strokeWidth="0.8" />
        {pts.map((p, i) => (
          <circle key={p.g.id} cx={x(i)} cy={y(p.acc)} r="1" fill="#81b64c" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>oldest</span>
        <span>
          {pts.length} game{pts.length === 1 ? '' : 's'}, {pts[0].acc}% to {pts[pts.length - 1].acc}%
        </span>
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
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <Micro>Openings you actually played</Micro>
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
                <td className="py-1.5 text-center tabular-nums">{r.games}</td>
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
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <Micro>When you play your best</Micro>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.bucket} className="rounded-lg bg-secondary/60 p-3">
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
