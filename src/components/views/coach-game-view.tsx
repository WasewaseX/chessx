'use client'

/**
 * Play with Coach — a live coaching game against the coach persona at a
 * student-chosen Elo.
 *
 * What makes it more than the bots lobby:
 *  - every move is classified by the SERVER engine pipeline (the same one
 *    behind game review), so labels, eval swings and the "why" can never
 *    drift from the review surfaces;
 *  - the coach reacts to each move in a chess.com-style coach card and, for
 *    real errors, explains out loud WHY via the chat thread (honest, grounded
 *    in the position dossier and claim-guarded);
 *  - a chat sidebar lets the student ask anything mid-game ("why wasn't Bg4
 *    good?") and get an honest answer about THIS position;
 *  - the finished game is stored with its full classification trail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { CharacterFace } from '@/components/chess/characters'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { useApp } from '@/lib/store'
import { COACHES, coachById, type Coach } from '@/lib/coaches'
import { LABEL_META, type MoveLabel } from '@/lib/chess/move-classification'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  CornerDownRight, Eye, Flag, Lightbulb, Loader2, RotateCcw,
  Send, Undo2, Swords,
} from 'lucide-react'

type Phase = 'setup' | 'playing' | 'over'

/** One ply of the game as displayed in the move list. */
interface PlyRecord {
  san: string
  color: 'w' | 'b'
  fenBefore: string
  /** Null while the server engine is still checking the move. */
  label: MoveLabel | null
  /** White-POV pawn eval before/after (engine-verified once label lands). */
  before: number | null
  after: number | null
  bestSan: string | null
  bestFrom: string | null
  bestTo: string | null
  reason: string | null
  cpl: number | null
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

const ELO_MIN = 400
const ELO_MAX = 2400
const ELO_CHIPS = [400, 800, 1200, 1600, 2000, 2400]

/** Elo -> Stockfish skill (0-20): 400 Elo = 0, 2400 = 20. */
function skillFor(elo: number): number {
  return Math.max(0, Math.min(20, Math.round(((elo - ELO_MIN) / (ELO_MAX - ELO_MIN)) * 20)))
}

/** Elo -> search depth: weak coaches look shallow, strong ones look far. */
function depthFor(elo: number): number {
  return Math.max(3, Math.min(15, Math.round(3 + ((elo - ELO_MIN) / (ELO_MAX - ELO_MIN)) * 12)))
}

/** Elo -> chance of a plain random move (fades to zero at ~1600). */
function blunderFor(elo: number): number {
  if (elo >= 1600) return 0
  return Math.max(0, 0.3 - (elo - ELO_MIN) / 4000)
}

/**
 * Opening repertoires: the coach opens like a real player of its level
 * instead of an engine's sharp line from move one. Each line is a full SAN
 * sequence from the start position (both sides). On the coach's turn, every
 * line whose played prefix matches the game's SAN history donates its next
 * move; one is picked at random. A student deviation simply drops the line
 * and the engine takes over. Lines are kept short — after the book the
 * engine's skill/depth/blunder knobs own the character again.
 */
const COACH_REPERTOIRES: { minElo: number; lines: string[][] }[] = [
  {
    // Beginner: natural development, no theory traps.
    minElo: 0,
    lines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'],
      ['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6'],
      ['e4', 'e5', 'Bc4', 'Nf6', 'd3', 'c6'],
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6'],
      ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5'],
    ],
  },
  {
    // Club: honest classical openings.
    minElo: 1000,
    lines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nxc6', 'bxc6'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
      ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7'],
      ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'],
      ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'],
      ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'],
    ],
  },
  {
    // Advanced: mainline Ruy/Najdorf/QGD ideas.
    minElo: 1700,
    lines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5'],
      ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'],
      ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'],
      ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5'],
      ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nc3', 'Qc7'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6', 'dxe5', 'Nf5', 'Qxd8+', 'Kxd8'],
      ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'Nf3', 'd6', 'g3', 'O-O', 'Bg2', 'Nbd7'],
      ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'Bg5', 'h6'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'e5', 'Nfd7', 'Bd3', 'c5'],
    ],
  },
]

/** Next book SAN for the coach, or null when out of book. */
function pickBookMove(sans: string[], elo: number): string | null {
  const bands = COACH_REPERTOIRES.filter((b) => elo >= b.minElo)
  const band = bands[bands.length - 1] // strongest band the Elo unlocks
  if (!band) return null
  const candidates: string[] = []
  for (const line of band.lines) {
    if (line.length <= sans.length) continue
    let matches = true
    for (let i = 0; i < sans.length; i++) {
      if (line[i] !== sans[i]) {
        matches = false
        break
      }
    }
    if (matches) candidates.push(line[sans.length])
  }
  if (!candidates.length) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** Elo -> how long the coach "thinks" on the clock (UI pacing). */
function minTimeFor(elo: number): number {
  return Math.max(250, Math.min(1300, 200 + Math.round(elo / 2.5)))
}

/** White-POV pawns from an engine score in side-to-move POV. */
function toWhitePawns(scoreCp: number | null, mate: number | null, turn: 'w' | 'b'): number | null {
  if (scoreCp == null && mate == null) return null
  let stmPawns: number
  if (mate != null) stmPawns = mate > 0 ? 100 - Math.min(50, mate * 0.5) : -100 + Math.min(50, -mate * 0.5)
  else stmPawns = Math.max(-100, Math.min(100, (scoreCp ?? 0) / 100))
  return turn === 'w' ? stmPawns : -stmPawns
}

function evalBadge(pawns: number | null, mateForWhite: boolean): string {
  if (pawns == null) return '?'
  const v = Math.abs(pawns) >= 90 ? `#${Math.max(1, Math.ceil((100 - Math.abs(pawns)) / 0.5))}` : pawns.toFixed(1)
  return `${pawns >= 0 ? '+' : '-'}${v.replace(/^-(?=\d)/, '')}`
}

function formatEval(pawns: number | null): string {
  if (pawns == null) return '?'
  if (Math.abs(pawns) >= 90) return `#${Math.max(1, Math.round((100 - Math.abs(pawns)) / 0.5))}`
  return `${pawns >= 0 ? '+' : '-'}${Math.abs(pawns).toFixed(1)}`
}

/** Lichess-style accuracy from centipawn loss (0-100). */
function accuracyFromCpls(cpls: number[]): number {
  if (!cpls.length) return 100
  const avg = cpls.reduce((a, b) => a + b, 0) / cpls.length
  const acc = 103.1668 * Math.exp(-0.04354 * avg) - 3.1668
  return Math.max(0, Math.min(100, Math.round(acc * 10) / 10))
}

function LabelBadge({ label, size = 16 }: { label: MoveLabel | null; size?: number }) {
  if (!label) {
    return <span className="inline-block h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/30" style={{ height: size, width: size }} />
  }
  const meta = LABEL_META[label]
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-extrabold leading-none text-white"
      style={{ height: size, width: size, backgroundColor: meta.color, fontSize: Math.max(8, Math.round(size * 0.52)) }}
      title={meta.text}
      aria-label={meta.text}
    >
      {meta.glyph}
    </span>
  )
}

function historyCountsLabel(counts: Record<string, number>): string {
  const parts: string[] = []
  for (const l of ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const) {
    if (counts[l]) parts.push(`${counts[l]} ${LABEL_META[l].text.toLowerCase()}`)
  }
  return parts.join(', ')
}

export function CoachGameView() {
  const { profile, navigate } = useApp()
  const soundOn = profile?.soundEnabled ?? true

  const [phase, setPhase] = useState<Phase>('setup')
  const [coachId, setCoachId] = useState<string>(profile?.coach && COACHES.some((c) => c.id === profile.coach) ? profile.coach : 'nina')
  const [elo, setElo] = useState(1200)
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('w')

  const gameRef = useRef<Chess>(new Chess())
  /** Mirror of the plies state for callbacks that must see the freshest list. */
  const pliesRef = useRef<PlyRecord[]>([])
  /** Server row id of this game's unfinished autosave; null until the first
   *  autosave lands. finishGame reuses it so one game stays one row. */
  const gameRowIdRef = useRef<string | null>(null)
  const [fen, setFen] = useState(gameRef.current.fen())
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w')
  const [plies, setPlies] = useState<PlyRecord[]>([])
  const [thinking, setThinking] = useState(false)
  const [selectedPly, setSelectedPly] = useState<number | null>(null) // view-only index into plies
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [takebacks, setTakebacks] = useState(2)
  const [hints, setHints] = useState(3)
  const [result, setResult] = useState<{ result: 'win' | 'loss' | 'draw'; reason: string } | null>(null)
  const [saved, setSaved] = useState(false)

  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  // Guards the auto "why" question: one in-flight explanation at a time.

  const coach: Coach = useMemo(() => coachById(coachId), [coachId])

  const [history, setHistory] = useState<
    Array<{
      id: string
      coachId: string
      coachElo: number
      color: string
      result: string
      accuracy: number | null
      labelCounts: Record<string, number>
      createdAt: string
      pgn?: string
      trail?: Array<{ san: string; color: string; label: string; before: number | null; after: number | null; bestSan: string | null; reason?: string; cpl: number | null }>
    }>
  >([])

  useEffect(() => {
    // Recent coaching games for the setup screen.
    fetch('/api/coach-game/save', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d: { games?: typeof history }) => setHistory(d.games ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat, chatBusy])

  /** View-only fen when a past ply is selected; live otherwise. */
  const shownFen = useMemo(() => {
    if (selectedPly == null) return fen
    const rec = plies[selectedPly]
    if (!rec) return fen
    try {
      const g = new Chess(rec.fenBefore)
      g.move(rec.san)
      return g.fen()
    } catch {
      return fen
    }
  }, [selectedPly, plies, fen])

  const shownLastMove = useMemo(() => {
    const idx = selectedPly ?? plies.length - 1
    const rec = plies[idx]
    if (!rec) return null
    try {
      const g = new Chess(rec.fenBefore)
      const mv = g.move(rec.san)
      return { from: mv.from, to: mv.to }
    } catch {
      return null
    }
  }, [selectedPly, plies])

  const askCoach = useCallback(
    async (question: string, focusSan?: string, historyOverride?: ChatMsg[]) => {
      if (chatBusy) return
      const userMsg: ChatMsg = { role: 'user', content: question }
      setChat((c) => [...c, userMsg])
      setChatBusy(true)
      try {
        const trail = plies.map((p) => ({
          san: p.san, color: p.color, label: p.label ?? 'unknown', before: p.before, after: p.after,
          bestSan: p.bestSan, reason: p.reason ?? undefined, cpl: p.cpl ?? undefined,
        }))
        const res = await fetch('/api/coach-game/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            fen: gameRef.current.fen(),
            coachId,
            elo,
            trail,
            focusSan,
            history: historyOverride ?? chat,
          }),
        })
        const data = (await res.json()) as { content?: string; error?: string }
        setChat((c) => [...c, { role: 'assistant', content: data.content ?? data.error ?? 'Something went wrong, ask me again.' }])
      } catch {
        setChat((c) => [...c, { role: 'assistant', content: 'The connection hiccuped. Ask me again.' }])
      } finally {
        setChatBusy(false)
      }
    },
    [chatBusy, plies, coachId, elo, chat],
  )

  /** Merge server-verified plies into the records by absolute ply number. */
  const mergeServerPlies = useCallback((serverPlies: Array<{
    san: string; color: 'w' | 'b'; before: number; after: number; bestSan: string | null
    label: MoveLabel; reason?: string; cpl: number | null
  }>, startIndex: number) => {
    setPlies((prev) => {
      const next = [...prev]
      serverPlies.forEach((sp, i) => {
        const idx = startIndex + i
        if (idx >= next.length || next[idx].san !== sp.san) return
        let bestFrom: string | null = null
        let bestTo: string | null = null
        if (sp.bestSan) {
          try {
            const g = new Chess(next[idx].fenBefore)
            const mv = g.move(sp.bestSan)
            if (mv) {
              bestFrom = mv.from
              bestTo = mv.to
            }
          } catch {
            /* best line display only */
          }
        }
        next[idx] = { ...next[idx], label: sp.label, before: sp.before, after: sp.after, bestSan: sp.bestSan, bestFrom, bestTo, reason: sp.reason ?? null, cpl: sp.cpl ?? null }
      })
      return next
    })
  }, [])

  /** Fire the auto "why" for a bad student move (runs once per ply). */
  const autoAskWhy = useCallback(
    (san: string, label: MoveLabel) => {
      if (!label || LABEL_META[label].good) return
      void askCoach(
        `Why is ${san} a ${LABEL_META[label].text.toLowerCase()}? What should I have played instead, and what was the idea?`,
        san,
      )
    },
    [askCoach],
  )

  /** Analyze the newest ply (or two) on the server and merge the verdicts. */
  const analyzeNewest = useCallback(
    async (count: number) => {
      // Always read from the live game: state plies would be stale here,
      // because callers fire this right after setPlies.
      const sans = gameRef.current.history()
      const fromPly = Math.max(1, sans.length - count + 1)
      try {
        const res = await fetch('/api/coach-game/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sans, fromPly, depth: 13 }),
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          plies: Array<{ san: string; color: 'w' | 'b'; before: number; after: number; bestSan: string | null; label: MoveLabel; reason?: string; cpl: number | null }>
          engineAvailable: boolean
        }
        if (!data.engineAvailable) return
        const startIndex = Math.max(0, sans.length - data.plies.length)
        mergeServerPlies(data.plies, startIndex)
        // Sound + auto-explanation for the player's move, now that the
        // verdict is in.
        const playerPly = [...data.plies].reverse().find((p) => p.color === playerColor)
        if (playerPly) {
          const label = playerPly.label
          if (label === 'blunder' || label === 'mistake' || label === 'missedwin') {
            playSound('wrong', soundOn)
            autoAskWhy(playerPly.san, label)
          } else if (label === 'brilliant' || label === 'great') {
            playSound('correct', soundOn)
          }
        }
      } catch {
        /* the live label stays provisional; the game continues either way */
      }
    },
    [mergeServerPlies, playerColor, autoAskWhy, soundOn],
  )

  const detectEnd = useCallback((g: Chess): { result: 'win' | 'loss' | 'draw'; reason: string } | null => {
    if (g.isCheckmate()) {
      const loser = g.turn()
      return { result: loser === playerColor ? 'loss' : 'win', reason: 'checkmate' }
    }
    if (g.isStalemate()) return { result: 'draw', reason: 'stalemate' }
    if (g.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient material' }
    if (g.isThreefoldRepetition()) return { result: 'draw', reason: 'threefold repetition' }
    if (g.isDraw()) return { result: 'draw', reason: 'draw' }
    return null
  }, [playerColor])

  const finishGame = useCallback(
    (r: { result: 'win' | 'loss' | 'draw'; reason: string }, finalPlies: PlyRecord[]) => {
      finishedRef.current = true
      setResult(r)
      setPhase('over')
      playSound(r.result === 'win' ? 'win' : r.result === 'loss' ? 'lose' : 'gameEnd', soundOn)
      // Persist with the verified trail. finalPlies is passed explicitly:
      // state plies would be stale when the game ends on the newest move.
      const studentCpls = finalPlies
        .filter((p) => p.color === playerColor && p.cpl != null)
        .map((p) => p.cpl as number)
      const accuracy = accuracyFromCpls(studentCpls)
      const pgn = gameRef.current.pgn()
      const trail = finalPlies.map((p) => ({
        san: p.san, color: p.color, label: p.label ?? 'unknown', before: p.before, after: p.after,
        bestSan: p.bestSan, reason: p.reason ?? undefined, cpl: p.cpl ?? undefined,
      }))
      fetch('/api/coach-game/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, elo, color: playerColor, result: r.result, reason: r.reason, pgn, trail, accuracy, id: gameRowIdRef.current ?? undefined }),
      })
        .then(() => {
          gameRowIdRef.current = null
          setSaved(true)
          return fetch('/api/coach-game/save', { cache: 'no-store' })
        })
        .then((r2) => (r2 && r2.ok ? r2.json() : null))
        .then((d: { games?: typeof history } | null) => {
          if (d?.games) setHistory(d.games)
        })
        .catch(() => {})
    },
    [playerColor, coachId, elo, soundOn],
  )

  /** Coach's reply move (client engine, paced by the chosen Elo). */
  const coachMove = useCallback(
    async (g: Chess) => {
      setThinking(true)
      try {
        // Opening book first: the coach opens like a real player of its
        // level; the engine owns the position once the book runs out.
        const bookSan = pickBookMove(pliesRef.current.map((p) => p.san), elo)
        let played: { mv: ReturnType<Chess['move']>; fenBefore: string } | null = null
        if (bookSan) {
          const fenBefore = g.fen()
          const mv = g.move(bookSan)
          if (mv) played = { mv, fenBefore }
        }
        if (!played) {
          await engine.init()
          const { uci } = await engine.bestMove({
            fen: g.fen(),
            skill: skillFor(elo),
            depth: depthFor(elo),
            minTime: minTimeFor(elo),
            blunder: blunderFor(elo),
          })
          if (uci && uci.length >= 4) {
            const fenBefore = g.fen()
            const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
            if (mv) played = { mv, fenBefore }
          }
        }
        if (played) {
          const { mv, fenBefore } = played
          setFen(g.fen())
          playSound(mv.captured ? 'capture' : mv.san.includes('+') ? 'check' : mv.flags.includes('k') || mv.flags.includes('q') ? 'castle' : 'move', soundOn)
          const newPlies: PlyRecord[] = [
            ...pliesRef.current,
            {
              san: mv.san, color: mv.color, fenBefore,
              label: null, before: null, after: null, bestSan: null, bestFrom: null, bestTo: null, reason: null, cpl: null,
            },
          ]
          pliesRef.current = newPlies
          setPlies(newPlies)
          const end = detectEnd(g)
          if (end) {
            finishGame(end, newPlies)
            return
          }
          // Verify the coach's move too (it gets a label like the student's).
          setTimeout(() => void analyzeNewest(1), 250)
        }
      } finally {
        setThinking(false)
      }
    },
    [elo, detectEnd, finishGame, analyzeNewest, soundOn],
  )

  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'playing' || thinking) return
      const g = gameRef.current
      if (g.turn() !== playerColor) return
      // Capture BEFORE the move: a fresh Chess built after the fact has no
      // history, so undo() there is a no-op and would mislabel the position.
      const fenBefore = g.fen()
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion || 'q' })
      } catch {
        return
      }
      if (!mv) return
      setSelectedPly(null)
      setArrows([])
      setFen(g.fen())
      playSound(mv.captured ? 'capture' : mv.san.includes('+') ? 'check' : mv.flags.includes('k') || mv.flags.includes('q') ? 'castle' : mv.promotion ? 'promote' : 'move', soundOn)
      const newPlies: PlyRecord[] = [
        ...pliesRef.current,
        {
          san: mv.san, color: mv.color, fenBefore,
          label: null, before: null, after: null, bestSan: null, bestFrom: null, bestTo: null, reason: null, cpl: null,
        },
      ]
      pliesRef.current = newPlies
      setPlies(newPlies)
      const end = detectEnd(g)
      if (end) {
        finishGame(end, newPlies)
        return
      }
      void analyzeNewest(1)
      void coachMove(g)
    },
    [phase, thinking, playerColor, detectEnd, finishGame, analyzeNewest, coachMove, soundOn],
  )

  const startGame = useCallback(() => {
    const color: 'w' | 'b' = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
    const g = new Chess()
    gameRef.current = g
    pliesRef.current = []
    gameRowIdRef.current = null
    finishedRef.current = false
    setPlayerColor(color)
    setFen(g.fen())
    setPlies([])
    setResult(null)
    setSaved(false)
    setSelectedPly(null)
    setArrows([])
    setTakebacks(2)
    setHints(3)
    setPhase('playing')
    setChat([
      {
        role: 'assistant',
        content: `Hi, ${coach.name} here. I'll play at about ${elo} Elo and tell you what I think after every move. Ask me anything, any time.`,
      },
    ])
    // If the student picked black, the coach opens.
    if (color === 'b') void coachMove(g)
  }, [colorChoice, elo, coach, coachMove])

  // Autosave (resumable): while playing, every trail change rewrites the same
  // unfinished row ~1.2s after the last change, and leaving the board for the
  // setup screen flushes immediately — a pending debounce must never be the
  // reason a trail is lost.
  const finishedRef = useRef(false)

  const saveUnfinished = useCallback(() => {
    if (pliesRef.current.length === 0) return
    const trail = pliesRef.current.map((p) => ({
      san: p.san, color: p.color, label: p.label ?? 'unknown', before: p.before, after: p.after,
      bestSan: p.bestSan, reason: p.reason ?? undefined, cpl: p.cpl ?? undefined,
    }))
    fetch('/api/coach-game/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coachId, elo, color: playerColor, result: 'unfinished',
        pgn: gameRef.current.pgn(), trail, id: gameRowIdRef.current ?? undefined,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string } | null) => {
        if (d?.id) gameRowIdRef.current = d.id
      })
      .catch(() => {})
  }, [coachId, elo, playerColor])

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (phase !== 'playing' || plies.length === 0) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    const t = setTimeout(saveUnfinished, 1200)
    autosaveTimer.current = t
    return () => clearTimeout(t)
  }, [plies.length, phase, saveUnfinished])

  // Flush on leaving the board (setup) unless the game just finished — the
  // final save already wrote the complete row in that case.
  useEffect(() => {
    if (phase !== 'setup') return
    if (finishedRef.current) return
    if (pliesRef.current.length === 0) return
    saveUnfinished()
  }, [phase, saveUnfinished])

  /** Continue an unfinished game: replay position, labels and evals. */
  const resumeGame = useCallback(
    (row: (typeof history)[number]) => {
      if (!row.pgn || phase !== 'setup') return
      const g = new Chess()
      try {
        g.loadPgn(row.pgn, { strict: false })
      } catch {
        return
      }
      const restored: PlyRecord[] = (row.trail ?? []).map((t) => ({
        san: t.san,
        color: t.color === 'b' ? 'b' : 'w',
        fenBefore: '',
        // 'unknown' (autosaved before the engine verdict landed) must restore
        // as null: LABEL_META has no 'unknown' entry and the coach card would
        // crash reading it. Null renders as "pending" and gets re-graded.
        label: t.label && t.label in LABEL_META ? (t.label as MoveLabel) : null,
        before: t.before,
        after: t.after,
        bestSan: t.bestSan,
        bestFrom: null,
        bestTo: null,
        reason: t.reason ?? null,
        cpl: t.cpl,
      }))
      // Rebuild each fenBefore by replaying from the start (the trail arrives
      // without fens; a fresh Chess replays them cheaply and verifiably).
      const replay = new Chess()
      for (const p of restored) {
        p.fenBefore = replay.fen()
        try {
          replay.move(p.san)
        } catch {
          break
        }
      }
      gameRef.current = g
      gameRowIdRef.current = row.id
      finishedRef.current = false
      setCoachId(row.coachId)
      setElo(row.coachElo)
      const me: 'w' | 'b' = row.color === 'b' ? 'b' : 'w'
      setPlayerColor(me)
      pliesRef.current = restored
      setPlies(restored)
      setFen(g.fen())
      setResult(null)
      setSaved(false)
      setSelectedPly(null)
      setArrows([])
      setTakebacks(2)
      setHints(3)
      setPhase('playing')
      setChat([
        {
          role: 'assistant',
          content: `Welcome back — ${coachById(row.coachId).name} here. We pick up where we left off${restored.length ? ` (after ${restored.length} half-moves)` : ''}. Ask me anything, any time.`,
        },
      ])
      // If the student already moved last, the coach owes a reply.
      if (g.turn() !== me) void coachMove(g)
    },
    [phase, coachMove],
  )

  /** Discard an unfinished game from the setup screen. */
  const deleteUnfinished = useCallback((id: string) => {
    fetch(`/api/coach-game/save?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => setHistory((h) => h.filter((x) => x.id !== id)))
      .catch(() => {})
  }, [])

  const takeBack = useCallback(() => {
    if (phase !== 'playing' || takebacks <= 0 || thinking) return
    const g = gameRef.current
    // Undo until it is the student's turn again (usually two plies).
    let undone = 0
    while (g.history().length > 0 && g.turn() !== playerColor) {
      g.undo()
      undone++
    }
    if (g.turn() === playerColor && g.history().length > 0) {
      g.undo()
      undone++
    }
    if (undone > 0) {
      setTakebacks((t) => t - 1)
      const kept = pliesRef.current.slice(0, Math.max(0, pliesRef.current.length - undone))
      pliesRef.current = kept
      setPlies(kept)
      setFen(g.fen())
      setSelectedPly(null)
      setArrows([])
      playSound('click', soundOn)
    }
  }, [phase, takebacks, thinking, playerColor, soundOn])

  const showHint = useCallback(async () => {
    if (phase !== 'playing' || hints <= 0 || gameRef.current.turn() !== playerColor) return
    setHints((h) => h - 1)
    await engine.init()
    const info = await engine.eval({ fen: gameRef.current.fen(), depth: 14 })
    if (info.pv.length >= 4) {
      try {
        const g = new Chess(gameRef.current.fen())
        const mv = g.move({ from: info.pv[0].slice(0, 2), to: info.pv[0].slice(2, 4), promotion: info.pv[0].slice(4, 5) || undefined })
        if (mv) setArrows([{ from: mv.from, to: mv.to, color: 'green' }])
      } catch {
        /* hint display only */
      }
    }
  }, [phase, hints, playerColor])

  const resign = useCallback(() => {
    if (phase !== 'playing') return
    finishGame({ result: 'loss', reason: 'resignation' }, pliesRef.current)
  }, [phase, finishGame])

  const showLine = useCallback(
    (idx: number) => {
      const rec = plies[idx]
      if (!rec?.bestFrom || !rec?.bestTo) return
      setSelectedPly(idx)
      setArrows([{ from: rec.bestFrom, to: rec.bestTo, color: 'green' }])
    },
    [plies],
  )

  const studentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of plies) {
      if (p.color !== playerColor || !p.label) continue
      counts[p.label] = (counts[p.label] ?? 0) + 1
    }
    return counts
  }, [plies, playerColor])

  const studentAccuracy = useMemo(
    () => accuracyFromCpls(plies.filter((p) => p.color === playerColor && p.cpl != null).map((p) => p.cpl as number)),
    [plies, playerColor],
  )

  /** Post-game recap: the student's three costliest moves (engine-verified cpl).
   *  Only real mistakes count — a "good" move with a small swing is noise. The
   *  chess.com review shows the same three; ours also carries the best move and
   *  one click each to replay the position with the better move drawn in. */
  const worstPlies = useMemo(() => {
    return plies
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.color === playerColor && p.cpl != null && (p.cpl as number) >= 50)
      .sort((a, b) => (b.p.cpl as number) - (a.p.cpl as number))
      .slice(0, 3)
      .sort((a, b) => a.idx - b.idx) // chronological order for the lesson feel
  }, [plies, playerColor])

  /** One honest sentence for the recap header, from the label distribution only. */
  const recapHeadline = useMemo(() => {
    const blunders = (studentCounts['blunder'] ?? 0) + (studentCounts['mistake'] ?? 0)
    const solid = (studentCounts['best'] ?? 0) + (studentCounts['brilliant'] ?? 0) + (studentCounts['excellent'] ?? 0)
    if (!worstPlies.length) return 'No costly mistakes found — solid game.'
    if (blunders >= 3) return 'Three or more big swings decided the game. Work the list below.'
    if (blunders > 0) return `One or two moments turned the game. ${solid ? 'Your other moves held up.' : ''}`
    return 'No blunders — the small inaccuracies below are where the edge leaked.'
  }, [studentCounts, worstPlies.length])

  /** Jump the board to a past position with the engine's better move drawn. */
  const reviewPly = useCallback((idx: number) => {
    const rec = plies[idx]
    setSelectedPly(idx)
    setArrows(rec?.bestFrom && rec?.bestTo ? [{ from: rec.bestFrom, to: rec.bestTo, color: 'green' }] : [])
  }, [plies])

  const latestStudentPlyIdx = useMemo(() => {
    for (let i = plies.length - 1; i >= 0; i--) {
      if (plies[i].color === playerColor) return i
    }
    return -1
  }, [plies, playerColor])

  // Group plies into rows for the chess.com-style move list.
  const moveRows = useMemo(() => {
    const rows: Array<{ n: number; w?: { idx: number; p: PlyRecord }; b?: { idx: number; p: PlyRecord } }> = []
    plies.forEach((p, idx) => {
      const n = Math.floor(idx / 2) + 1
      let row = rows[n - 1]
      if (!row) {
        row = { n }
        rows[n - 1] = row
      }
      if (p.color === 'w') row.w = { idx, p }
      else row.b = { idx, p }
    })
    return rows.filter(Boolean)
  }, [plies])

  /* ------------------------------- setup ---------------------------------- */

  if (phase === 'setup') {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 pb-24 lg:pb-6">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Play with Coach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your coach plays a full game at the strength you pick and tells you, move by move, what each move was and why.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 text-sm font-bold">Choose your coach</div>
            <div className="grid gap-2">
              {COACHES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCoachId(c.id)}
                  aria-pressed={coachId === c.id}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-2.5 text-left transition-all',
                    coachId === c.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40',
                  )}
                >
                  <CharacterFace id={c.id} label={c.name} className="h-10 w-10 shrink-0 rounded-full" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">
                      {c.name} <span className="font-medium text-muted-foreground">· {c.title}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{c.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-sm font-bold">Coach strength</div>
                <div className="font-display text-2xl font-extrabold text-primary-light">{elo}</div>
              </div>
              <input
                type="range"
                min={ELO_MIN}
                max={ELO_MAX}
                step={100}
                value={elo}
                onChange={(e) => setElo(Number(e.target.value))}
                className="w-full accent-primary"
                aria-label={`Coach Elo: ${elo}`}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ELO_CHIPS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setElo(v)}
                    aria-pressed={elo === v}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-bold transition-colors',
                      elo === v ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {elo < 900
                  ? 'The coach will make human mistakes and punish only the clearest errors.'
                  : elo < 1500
                    ? 'Solid club play. It punishes loose moves and drifted positions.'
                    : elo < 2100
                      ? 'Strong and consistent. Blunders get converted to wins.'
                      : 'Near-master discipline. Every slip costs material or the game.'}
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 text-sm font-bold">Your color</div>
              <div className="grid grid-cols-3 gap-2">
                {(['w', 'random', 'b'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setColorChoice(c)}
                    aria-pressed={colorChoice === c}
                    className={cn(
                      'rounded-lg border py-2 text-xs font-bold transition-colors',
                      colorChoice === c ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
                  </button>
                ))}
              </div>
              <Button onClick={startGame} className="mt-3 w-full">
                <Swords className="mr-2 h-4 w-4" /> Start training
              </Button>
            </div>
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-4 rounded-xl border bg-card p-4">
            <div className="mb-2 text-sm font-bold">Recent coaching games</div>
            <ul className="space-y-1.5">
              {(() => {
                // Unfinished games jump the queue: they are the resumable ones.
                const ordered = [...history].sort(
                  (a, b) => (a.result === 'unfinished' ? 0 : 1) - (b.result === 'unfinished' ? 0 : 1),
                )
                return ordered.slice(0, 5).map((g) => (
                  <li key={g.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
                    <span
                      className={cn(
                        'grid h-5 w-5 shrink-0 place-items-center rounded font-extrabold uppercase text-white',
                        g.result === 'unfinished'
                          ? 'bg-amber-500'
                          : g.result === 'win'
                            ? 'bg-primary'
                            : g.result === 'loss'
                              ? 'bg-destructive'
                              : 'bg-muted-foreground',
                      )}
                    >
                      {g.result === 'unfinished' ? '…' : g.result[0]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {g.result === 'unfinished' ? (
                        <span className="font-bold text-amber-600 dark:text-amber-400">In progress — </span>
                      ) : null}
                      vs {coachById(g.coachId).name} · {g.coachElo} Elo
                      {g.accuracy != null ? ` · ${g.accuracy}% accuracy` : ''}
                    </span>
                    {g.result === 'unfinished' ? (
                      <>
                        <button
                          onClick={() => resumeGame(g)}
                          className="shrink-0 rounded bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground transition hover:opacity-90"
                        >
                          Resume
                        </button>
                        <button
                          onClick={() => deleteUnfinished(g.id)}
                          aria-label="Delete unfinished game"
                          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] font-bold text-muted-foreground transition hover:bg-accent"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="hidden shrink-0 text-muted-foreground sm:block">{historyCountsLabel(g.labelCounts)}</span>
                    )}
                  </li>
                ))
              })()}
            </ul>
          </div>
        )}
      </div>
    )
  }

  /* ------------------------------- playing / over ------------------------- */

  const boardViewOnly = selectedPly != null || phase === 'over'
  const myTurn = phase === 'playing' && gameRef.current.turn() === playerColor && !thinking

  const cardPlyIdx = selectedPly ?? latestStudentPlyIdx
  const cardPly = cardPlyIdx >= 0 ? plies[cardPlyIdx] : null

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-2 py-4 pb-24 sm:px-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-4">
      {/* ------------------------------ board column ---------------------- */}
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPhase('setup')} aria-label="Back to setup">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> New game
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={takeBack} disabled={takebacks <= 0 || phase !== 'playing' || thinking} title={`${takebacks} takebacks left`}>
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Take back ({takebacks})
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void showHint()} disabled={hints <= 0 || !myTurn} title={`${hints} hints left`}>
              <Lightbulb className="mr-1 h-3.5 w-3.5" /> Hint ({hints})
            </Button>
            {phase === 'playing' && (
              <Button variant="secondary" size="sm" onClick={resign}>
                <Flag className="mr-1 h-3.5 w-3.5" /> Resign
              </Button>
            )}
          </div>
        </div>

        {/* coach plate */}
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-card px-3 py-2 shadow-sm ring-1 ring-inset ring-border/60">
          <CharacterFace id={coach.id} label={coach.name} className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{coach.name} <span className="font-medium text-muted-foreground">· Coach · ~{elo} Elo</span></div>
            <div className="truncate text-[11px] text-muted-foreground">{thinking ? 'Thinking…' : phase === 'over' ? 'Game over' : myTurn ? 'Your move' : 'Waiting'}</div>
          </div>
          {thinking && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-label="Coach is thinking" />}
        </div>

        <div className="relative">
          <ChessBoard
            fen={shownFen}
            orientation={playerColor}
            onMove={onPlayerMove}
            interactive={!boardViewOnly}
            movableSide={boardViewOnly ? undefined : playerColor}
            lastMove={shownLastMove}
            showLegal={!boardViewOnly}
            showCoords={profile?.showCoords ?? true}
            theme={profile?.theme ?? 'green'}
            arrows={arrows}
            className="h-full w-full"
          />
          {selectedPly != null && (
            <button
              onClick={() => {
                setSelectedPly(null)
                setArrows([])
              }}
              className="absolute left-2 top-2 rounded-md bg-black/70 px-2.5 py-1.5 text-xs font-bold text-white shadow hover:bg-black/80"
            >
              ← Back to live position
            </button>
          )}
        </div>

        {/* student plate */}
        <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-card px-3 py-2 shadow-sm ring-1 ring-inset ring-border/60">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary font-display text-sm font-extrabold uppercase text-white">
            {(profile?.name ?? 'You').slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{profile?.name ?? 'You'} <span className="font-medium text-muted-foreground">· Student</span></div>
            <div className="truncate text-[11px] text-muted-foreground">
              {phase === 'over'
                ? `Accuracy ${studentAccuracy}%`
                : plies.length === 0
                  ? 'Make your first move'
                  : `${plies.filter((p) => p.color === playerColor).length} moves played`}
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            {(Object.entries(studentCounts) as Array<[MoveLabel, number]>)
              .filter(([l]) => ['inaccuracy', 'mistake', 'blunder'].includes(l))
              .map(([l, n]) => (
                <span key={l} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
                  <LabelBadge label={l} size={14} /> {n}
                </span>
              ))}
          </div>
        </div>

        {phase === 'over' && result && (
          <div className={cn(
            'mt-3 rounded-xl border p-4 text-center',
            result.result === 'win' ? 'border-primary/50 bg-primary/5' : result.result === 'loss' ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-card',
          )}>
            <div className="font-display text-lg font-extrabold">
              {result.result === 'win' ? 'You won!' : result.result === 'loss' ? 'The coach won' : 'Draw'}
              <span className="ml-2 text-sm font-semibold text-muted-foreground">by {result.reason}</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {studentAccuracy}% accuracy · {historyCountsLabel(studentCounts) || 'a clean game'}
              {saved ? ' · saved' : ''}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button onClick={startGame}>Rematch</Button>
              <Button variant="secondary" onClick={() => setPhase('setup')}>Change coach</Button>
              <Button variant="secondary" onClick={() => navigate('review')}>Game review</Button>
            </div>

            {/* coach's recap: the costliest moments, each replayable with the
                better move drawn on the board, and one click to ask why. */}
            <div className="mt-3 rounded-lg border bg-card p-3 text-left">
              <div className="flex items-center gap-2">
                <CharacterFace id={coach.id} label={coach.name} className="h-7 w-7 rounded-full ring-1 ring-primary/50" />
                <div className="text-sm font-extrabold">{coach.name}'s recap</div>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{recapHeadline}</p>
              {worstPlies.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {worstPlies.map(({ p, idx }) => (
                    <li key={idx} className="flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1.5">
                      <span className="w-8 shrink-0 text-center font-mono text-[11px] font-bold text-muted-foreground">
                        {Math.floor(idx / 2) + 1}
                      </span>
                      <LabelBadge label={p.label} size={16} />
                      <span className="shrink-0 font-mono text-[13px] font-bold">
                        {p.san}
                        {p.bestSan ? <span className="font-medium text-muted-foreground"> → {p.bestSan}</span> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {p.cpl != null ? `costs about ${(p.cpl / 100).toFixed(1)} pawns` : ''}
                      </span>
                      <button
                        onClick={() => reviewPly(idx)}
                        className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-primary-foreground transition-transform active:scale-95"
                      >
                        Show
                      </button>
                      <button
                        onClick={() => void askCoach(
                          `Move ${Math.floor(idx / 2) + 1}: I played ${p.san} but ${p.bestSan ?? 'another move'} was better. Teach me the idea behind the better move.`,
                          p.san,
                        )}
                        disabled={chatBusy}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground transition-transform hover:bg-secondary active:scale-95 disabled:opacity-50"
                      >
                        Ask why
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------ coach column ---------------------- */}
      <div className="flex min-w-0 flex-col gap-3">
        {/* coach card (chess.com game review style) */}
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-start gap-2.5">
            <div className="relative shrink-0">
              <CharacterFace id={coach.id} label={coach.name} className="h-10 w-10 rounded-full ring-2 ring-primary/60" />
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-primary px-1 text-[8px] font-extrabold uppercase tracking-wide text-primary-foreground">Coach</span>
            </div>
            <div className="min-w-0 flex-1">
              {cardPly ? (
                cardPly.label ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LabelBadge label={cardPly.label} size={18} />
                      <span className="text-sm font-bold" style={{ color: LABEL_META[cardPly.label].color }}>
                        {cardPly.san} is {LABEL_META[cardPly.label].text.toLowerCase()}
                      </span>
                      <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-bold">
                        {formatEval(cardPly.before)} → {formatEval(cardPly.after)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
                      {cardPly.reason ?? LABEL_META[cardPly.label].meaning}
                      {cardPly.bestSan && !LABEL_META[cardPly.label].good && cardPly.bestSan !== cardPly.san ? (
                        <> <span className="font-semibold text-foreground">{cardPly.bestSan}</span> was the engine&apos;s choice.</>
                      ) : null}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cardPly.bestSan && (
                        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => showLine(cardPlyIdx)}>
                          <CornerDownRight className="mr-1 h-3 w-3" /> Show line
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={chatBusy}
                        onClick={() =>
                          void askCoach(
                            `Why exactly is ${cardPly.san} ${LABEL_META[cardPly.label as MoveLabel].text.toLowerCase()} here? Teach me the idea.`,
                            cardPly.san,
                          )
                        }
                      >
                        <Eye className="mr-1 h-3 w-3" /> Explain more
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking {cardPly.san} with the engine…
                  </div>
                )
              ) : (
                <div className="text-sm text-muted-foreground">Play a move and I will grade it here, with the reason.</div>
              )}
            </div>
          </div>
        </div>

        {/* move list with badges */}
        <div className="max-h-64 overflow-y-auto rounded-xl border bg-card scroll-slim" role="list" aria-label="Move list">
          {moveRows.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">No moves yet</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {moveRows.map((row) => (
                  <tr key={row.n} className="border-b border-border/40 last:border-0">
                    <td className="w-9 bg-secondary/40 px-2 py-1 text-center font-mono text-xs text-muted-foreground">{row.n}.</td>
                    {(['w', 'b'] as const).map((c) => {
                      const cell = row[c]
                      if (!cell) return <td key={c} className="px-2 py-1" />
                      const active = (selectedPly ?? plies.length - 1) === cell.idx
                      return (
                        <td key={c} className="px-1 py-1">
                          <button
                            onClick={() => {
                              setSelectedPly(cell.idx)
                              setArrows([])
                            }}
                            className={cn(
                              'flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors',
                              active ? 'bg-primary/15' : 'hover:bg-secondary/60',
                            )}
                            aria-current={active ? 'true' : undefined}
                          >
                            <LabelBadge label={cell.p.label} />
                            <span className="font-semibold">{cell.p.san}</span>
                            {cell.p.before != null && cell.p.after != null && (
                              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                                {formatEval(cell.p.after)}
                              </span>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* chat */}
        <div className="flex min-h-[280px] flex-1 flex-col rounded-xl border bg-card">
          <div className="border-b border-border/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Ask {coach.name}
          </div>
          <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2 scroll-slim" style={{ maxHeight: 320 }}>
            {chat.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm leading-snug',
                    m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {chatBusy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border/60 p-2"
            onSubmit={(e) => {
              e.preventDefault()
              const q = chatInput.trim()
              if (!q || chatBusy) return
              setChatInput('')
              void askCoach(q)
            }}
          >
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Why wasn't Bg4 good?"
              className="h-9 flex-1"
              aria-label={`Message for ${coach.name}`}
            />
            <Button type="submit" size="sm" className="h-9" disabled={chatBusy || !chatInput.trim()}>
              {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
