'use client'
// Eye training — the perception layer under Learn. The science is de Groot's
// (1946): masters do not see 32 pieces, they see square colors, rays, loose
// pieces and whole position chunks. Four drills train exactly that gap,
// measured honestly: a 30-second color-map sprint, an LPDO loose-piece scan,
// ray/defender reading, and a real-versus-scrambled flash recall that lets
// you measure your own chunking. Every position is a real master-game
// position from the puzzle bank; every best is a real best.
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import type { PuzzleStub } from '@/content/schema'
import { fetchPuzzleIndex } from '@/lib/chess/solver'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Palette, ScanEye, ShieldOff, Spline } from 'lucide-react'

type Drill = 'colors' | 'loose' | 'rays' | 'flash'
type Phase = 'idle' | 'running' | 'over'

const COLOR_SECONDS = 30
const LOOSE_ROUNDS = 8
const RAYS_ROUNDS = 8
const FLASH_ROUNDS = 6
const FLASH_MEMORIZE_SECONDS = 5
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'
const FILES = 'abcdefgh'
const RANKS = '12345678'
const ALL_SQUARES = FILES.split('').flatMap((f) => RANKS.split('').map((r) => f + r))

const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
const PIECE_VALUE: Record<string, number> = { q: 5, r: 4, b: 3, n: 2, k: 1, p: 0 }

interface Piece {
  square: string
  color: 'w' | 'b'
  type: string
}

interface LoosePiece {
  square: string
  type: string
  color: 'w' | 'b'
  attackers: string[]
}

interface LooseReport {
  white: LoosePiece[]
  black: LoosePiece[]
}

interface SprintResult {
  score: number
  mistakes: number
  seconds: number
  xpGain: number
  isNewBest: boolean
  previousBest: number
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[r]] = [arr[r], arr[i]]
  }
  return arr
}

function piecesOf(fen: string): Piece[] {
  return new Chess(fen).board().flat().filter(Boolean) as unknown as Piece[]
}

function attackersOf(fen: string, square: string, color: 'w' | 'b'): string[] {
  try {
    return new Chess(fen).attackers(square as Square, color)
  } catch {
    return []
  }
}

/** True when a square is a light square — a1 and every alternate one is dark. */
function isLightSquare(square: string): boolean {
  const file = FILES.indexOf(square[0])
  const rank = Number(square[1]) - 1
  return (file + rank) % 2 === 1
}

/** Undefended AND attacked: the classic LPDO scan, computed exactly. */
function looseReport(fen: string): LooseReport {
  const out: LooseReport = { white: [], black: [] }
  for (const pc of piecesOf(fen)) {
    const enemy = pc.color === 'w' ? 'b' : 'w'
    const attacked = attackersOf(fen, pc.square, enemy)
    if (attacked.length === 0) continue
    const defended = attackersOf(fen, pc.square, pc.color)
    if (defended.length > 0) continue
    out[pc.color === 'w' ? 'white' : 'black'].push({ square: pc.square, type: pc.type, color: pc.color, attackers: attacked })
  }
  return out
}

/** Same pieces, random squares: the anti-chunk control condition. Pawns stay
 * off the edge rows — chess.js (correctly) refuses positions they cannot occur in. */
function scrambleFen(fen: string): string {
  const pcs = piecesOf(fen).map((p) => ({ color: p.color, type: p.type }))
  const pawns = pcs.filter((p) => p.type === 'p')
  const rest = pcs.filter((p) => p.type !== 'p')
  const placed = new Map<string, Piece>()
  // non-pawns may go anywhere; pawns only on ranks 2–7
  const freeSpots = shuffle([...ALL_SQUARES])
  const freeInterior = shuffle(ALL_SQUARES.filter((sq) => !'18'.includes(sq[1])))
  let restIdx = 0
  let pawnIdx = 0
  for (const p of rest) placed.set(freeSpots[restIdx++], { square: freeSpots[restIdx - 1], color: p.color, type: p.type })
  for (const p of pawns) {
    while (pawnIdx < freeInterior.length && placed.has(freeInterior[pawnIdx])) pawnIdx++
    const sq = freeInterior[pawnIdx++]
    placed.set(sq, { square: sq, color: p.color, type: p.type })
  }
  const rows = RANKS.split('')
    .reverse()
    .map((rank) => {
      let row = ''
      let empty = 0
      for (const file of FILES) {
        const pc = placed.get(file + rank)
        if (pc) {
          if (empty > 0) {
            row += String(empty)
            empty = 0
          }
          row += pc.color === 'w' ? pc.type.toUpperCase() : pc.type
        } else empty++
      }
      if (empty > 0) row += String(empty)
      return row
    })
  return `${rows.join('/')} w - - 0 1`
}

/** A piece worth asking about: exactly one of its color+type on the board. */
function uniqueQuestionPiece(fen: string): { color: 'w' | 'b'; type: string } | null {
  const pcs = piecesOf(fen)
  const seen = new Map<string, number>()
  for (const p of pcs) {
    const k = p.color + p.type
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const candidates = pcs.filter((p) => seen.get(p.color + p.type) === 1)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (PIECE_VALUE[b.type] ?? 0) - (PIECE_VALUE[a.type] ?? 0))
  return { color: candidates[0].color, type: candidates[0].type }
}

function pieceLabel(color: 'w' | 'b', type: string): string {
  return `${color === 'w' ? 'white' : 'black'} ${PIECE_NAME[type]}`
}

function pieceImgSrc(color: 'w' | 'b', type: string): string {
  return `/pieces/${color}${type.toUpperCase()}.svg`
}

/** A real position worth studying: midgame-weighted from the real bank. */
function usablePosition(p: PuzzleStub): boolean {
  try {
    const n = piecesOf(p.fen).length
    return n >= 12 && n <= 30 && p.rating >= 900 && p.rating <= 2400
  } catch {
    return false
  }
}

export function EyeTrainingPanel() {
  const { profile, setProfile } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [drill, setDrill] = useState<Drill>('colors')
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [result, setResult] = useState<SprintResult | null>(null)
  const [bests, setBests] = useState<Record<Drill, number> | null>(null)
  const [poolReady, setPoolReady] = useState(false)
  const soundEnabled = profile?.soundEnabled ?? true

  const finishedRef = useRef(false)
  const poolRef = useRef<PuzzleStub[]>([])
  const drillTokenRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const runStartRef = useRef(0)

  /* ---------------------------- shared plumbing ---------------------------- */

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const fetchBests = useCallback(() => {
    fetch('/api/vision/sprint')
      .then((r) => readJson<{ best?: Record<string, number> }>(r))
      .then((d) => {
        if (d?.best)
          setBests({
            colors: d.best.colors ?? 0,
            loose: d.best.loose ?? 0,
            rays: d.best.rays ?? 0,
            flash: d.best.flash ?? 0,
          })
      })
      .catch(() => {
        /* bests are a nicety */
      })
  }, [])

  useEffect(() => {
    fetchBests()
    fetchPuzzleIndex()
      .then((puzzles) => {
        poolRef.current = shuffle(puzzles.filter(usablePosition))
        setPoolReady(true)
      })
      .catch(() => {
        /* drills that need positions simply stay disabled */
      })
  }, [fetchBests])

  const postRun = useCallback(
    async (mode: Drill, score: number, mistakes: number, seconds: number) => {
      try {
        const res = await fetch('/api/vision/sprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, score, mistakes, seconds, dayKey: new Date().toLocaleDateString('sv-SE') }),
        })
        const d = await readJson<{ profile?: ProfileData; xpGain?: number; isNewBest?: boolean; previousBest?: number }>(res)
        if (d.profile) setProfile(d.profile)
        setResult({
          score,
          mistakes,
          seconds,
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        })
        if (d.isNewBest) playSound('win', soundEnabled)
        setBests((b) => (b ? { ...b, [mode]: Math.max(b[mode], score) } : b))
      } catch {
        setResult({ score, mistakes, seconds, xpGain: 0, isNewBest: false, previousBest: 0 })
      }
    },
    [setProfile, soundEnabled],
  )

  const finish = useCallback(
    (score: number, mistakes: number, seconds: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      drillTokenRef.current++
      clearTimers()
      setPhase('over')
      const elapsed = Math.min(600, Math.max(1, Math.round((Date.now() - runStartRef.current) / 1000)))
      void postRun(drill, score, mistakes, seconds > 0 ? seconds : elapsed)
    },
    [clearTimers, drill, postRun],
  )

  const flash = useCallback((marks: FlashMark[], ms = 550) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), ms)
  }, [])

  const startDrill = useCallback(
    (d: Drill) => {
      drillTokenRef.current++
      finishedRef.current = false
      clearTimers()
      setDrill(d)
      setResult(null)
      setFlashes([])
      playSound('click', soundEnabled)
      runStartRef.current = Date.now()
      setPhase('running')
    },
    [clearTimers, soundEnabled],
  )

  /* =============================== COLORS =============================== */

  const [colorTarget, setColorTarget] = useState('e4')
  const [colorAnswer, setColorAnswer] = useState<'light' | 'dark' | null>(null)
  const [colorScore, setColorScore] = useState(0)
  const [colorMistakes, setColorMistakes] = useState(0)
  const [colorTime, setColorTime] = useState(COLOR_SECONDS)
  const colorRefs = useRef({ score: 0, mistakes: 0, time: COLOR_SECONDS })

  const beginColors = useCallback(() => {
    startDrill('colors')
    colorRefs.current = { score: 0, mistakes: 0, time: COLOR_SECONDS }
    setColorScore(0)
    setColorMistakes(0)
    setColorTime(COLOR_SECONDS)
    setColorAnswer(null)
    setColorTarget(ALL_SQUARES[Math.floor(Math.random() * 64)])
  }, [startDrill])

  useEffect(() => {
    if (phase !== 'running' || drill !== 'colors') return
    const iv = setInterval(() => {
      colorRefs.current.time -= 1
      setColorTime(Math.max(0, colorRefs.current.time))
      if (colorRefs.current.time <= 0) {
        clearInterval(iv)
        finish(colorRefs.current.score, colorRefs.current.mistakes, COLOR_SECONDS)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, drill, finish])

  const pickColor = useCallback(
    (pick: 'light' | 'dark') => {
      if (colorAnswer) return
      const correct = (isLightSquare(colorTarget) ? 'light' : 'dark') === pick
      setColorAnswer(pick)
      if (correct) {
        colorRefs.current.score += 1
        setColorScore(colorRefs.current.score)
        playSound('correct', soundEnabled)
        flash([{ square: colorTarget, color: 'green' }])
      } else {
        colorRefs.current.mistakes += 1
        setColorMistakes(colorRefs.current.mistakes)
        playSound('wrong', soundEnabled)
        flash([{ square: colorTarget, color: 'gold' }])
      }
      const token = drillTokenRef.current
      const t = setTimeout(() => {
        if (drillTokenRef.current !== token || finishedRef.current) return
        setColorAnswer(null)
        setColorTarget(ALL_SQUARES[Math.floor(Math.random() * 64)])
      }, 420)
      timersRef.current.push(t)
    },
    [colorAnswer, colorTarget, flash, soundEnabled],
  )

  /* =============================== LOOSE ================================ */

  const [looseRound, setLooseRound] = useState(0)
  const [looseFen, setLooseFen] = useState(EMPTY_FEN)
  const [looseSide, setLooseSide] = useState<'white' | 'black'>('white')
  // null = round not yet primed; [] = genuinely no loose pieces this round
  const [looseTruth, setLooseTruth] = useState<LoosePiece[] | null>(null)
  const [loosePick, setLoosePick] = useState<number | null>(null)
  const [looseScore, setLooseScore] = useState(0)
  const [looseMistakes, setLooseMistakes] = useState(0)
  const looseRefs = useRef({ score: 0, mistakes: 0 })
  const looseDealRef = useRef<PuzzleStub[]>([])

  const beginLoose = useCallback(() => {
    if (poolRef.current.length < LOOSE_ROUNDS) return
    startDrill('loose')
    looseRefs.current = { score: 0, mistakes: 0 }
    looseDealRef.current = poolRef.current.slice(0, LOOSE_ROUNDS)
    setLooseScore(0)
    setLooseMistakes(0)
    setLooseRound(0)
    setLooseFen(looseDealRef.current[0].fen)
    setLoosePick(null)
    setLooseTruth(null) // the priming effect below turns this into round 0's real truth
  }, [startDrill])

  const nextLooseRound = useCallback(
    (round: number) => {
      if (round >= LOOSE_ROUNDS) {
        finish(looseRefs.current.score, looseRefs.current.mistakes, 0)
        return
      }
      const fen = looseDealRef.current[round].fen
      const report = looseReport(fen)
      // ask about the side that actually has loose pieces; prefer the busier side
      const side = report.black.length > report.white.length ? 'black' : 'white'
      setLooseRound(round)
      setLooseFen(fen)
      setLooseSide(side)
      setLooseTruth(report[side])
      setLoosePick(null)
      setFlashes([])
    },
    [finish],
  )

  // first round: prime the question from the deal (null truth = not yet primed)
  const looseTruthSettled = looseTruth !== null
  useEffect(() => {
    if (phase === 'running' && drill === 'loose' && !looseTruthSettled && looseDealRef.current.length > 0) {
      nextLooseRound(0)
    }
  }, [phase, drill, looseTruthSettled, nextLooseRound])

  const answerLoose = useCallback(
    (pick: number) => {
      if (loosePick !== null || looseTruth === null) return
      setLoosePick(pick)
      const truth = looseTruth.length
      const correct = pick === Math.min(truth, 4)
      if (correct) {
        looseRefs.current.score += 1
        setLooseScore(looseRefs.current.score)
        playSound('correct', soundEnabled)
      } else {
        looseRefs.current.mistakes += 1
        setLooseMistakes(looseRefs.current.mistakes)
        playSound('wrong', soundEnabled)
      }
      // reveal: loose pieces gold, the pieces hunting them red
      flash(
        [
          ...looseTruth.map((lp) => ({ square: lp.square, color: 'gold' as const })),
          ...looseTruth.flatMap((lp) => lp.attackers.map((sq) => ({ square: sq, color: 'red' as const }))),
        ],
        1400,
      )
      const token = drillTokenRef.current
      const t = setTimeout(() => {
        if (drillTokenRef.current !== token || finishedRef.current) return
        nextLooseRound(looseRound + 1)
      }, 1700)
      timersRef.current.push(t)
    },
    [loosePick, looseTruth, looseRound, flash, nextLooseRound, soundEnabled],
  )

  const looseOptions = [0, 1, 2, 3, 4]
  const looseAnsweredCorrect = loosePick !== null && looseTruth !== null && loosePick === Math.min(looseTruth.length, 4)

  /* ================================ RAYS ================================ */

  interface RaysRound {
    kind: 'count' | 'defender'
    fen: string
    target: string
    side: 'w' | 'b'
    attackers: string[]
    defender?: Piece
    options: Array<{ color: 'w' | 'b'; type: string } | number>
    answer: number // index into options
  }

  const [raysRound, setRaysRound] = useState(0)
  const [raysQ, setRaysQ] = useState<RaysRound | null>(null)
  const [raysPick, setRaysPick] = useState<number | null>(null)
  const [raysScore, setRaysScore] = useState(0)
  const [raysMistakes, setRaysMistakes] = useState(0)
  const raysRefs = useRef({ score: 0, mistakes: 0 })
  const raysDealRef = useRef<PuzzleStub[]>([])

  const buildRaysRound = useCallback((fen: string): RaysRound | null => {
    const kind: RaysRound['kind'] = Math.random() < 0.55 ? 'count' : 'defender'
    if (kind === 'count') {
      const side: 'w' | 'b' = Math.random() < 0.5 ? 'w' : 'b'
      // candidate targets with 1..4 attackers for that side, empty or enemy-held preferred
      const cands: Array<{ square: string; n: number }> = []
      for (const sq of ALL_SQUARES) {
        const n = attackersOf(fen, sq, side).length
        if (n >= 1 && n <= 4) cands.push({ square: sq, n })
      }
      if (cands.length === 0) return null
      const pick = cands[Math.floor(Math.random() * cands.length)]
      const attackers = attackersOf(fen, pick.square, side)
      const options = [0, 1, 2, 3, 4]
      const answer = Math.min(pick.n, 4)
      return { kind, fen, target: pick.square, side, attackers, options, answer }
    }
    // defender: an occupied square that is actually defended
    const pcs = piecesOf(fen)
    const cands = pcs
      .map((p) => ({ p, defenders: attackersOf(fen, p.square, p.color) }))
      .filter((c) => c.defenders.length > 0)
    if (cands.length === 0) return null
    const pick = cands[Math.floor(Math.random() * cands.length)]
    const defenderSq = pick.defenders[Math.floor(Math.random() * pick.defenders.length)]
    const defender = pcs.find((p) => p.square === defenderSq)
    if (!defender) return null
    // distractors: other real pieces from the position
    const others = shuffle(pcs.filter((p) => !(p.square === defenderSq && p.type === defender.type && p.color === defender.color) && !(p.color === defender.color && p.type === defender.type)))
    const distractors = others.slice(0, 3).map((p) => ({ color: p.color, type: p.type }))
    const options: Array<{ color: 'w' | 'b'; type: string }> = shuffle([{ color: defender.color, type: defender.type }, ...distractors])
    return {
      kind,
      fen,
      target: pick.p.square,
      side: pick.p.color,
      attackers: pick.defenders,
      defender: { square: defenderSq, color: defender.color, type: defender.type },
      options,
      answer: options.findIndex((o) => o.color === defender.color && o.type === defender.type),
    }
  }, [])

  const beginRays = useCallback(() => {
    if (poolRef.current.length < RAYS_ROUNDS) return
    startDrill('rays')
    raysRefs.current = { score: 0, mistakes: 0 }
    raysDealRef.current = poolRef.current.slice(0, RAYS_ROUNDS)
    setRaysScore(0)
    setRaysMistakes(0)
    setRaysRound(0)
    setRaysPick(null)
    // first round: retry a few positions in case one yields no legal question
    let q: RaysRound | null = null
    for (let attempt = 0; attempt < 4 && !q; attempt++) {
      q = buildRaysRound(raysDealRef.current[attempt].fen)
    }
    setRaysQ(q)
  }, [buildRaysRound, startDrill])

  const nextRaysRound = useCallback(
    (round: number) => {
      if (round >= RAYS_ROUNDS) {
        finish(raysRefs.current.score, raysRefs.current.mistakes, 0)
        return
      }
      setRaysRound(round)
      setRaysPick(null)
      // retry a few deals if a position yields no legal question
      let q: RaysRound | null = null
      for (let attempt = 0; attempt < 4 && !q; attempt++) {
        q = buildRaysRound(raysDealRef.current[(round + attempt) % raysDealRef.current.length].fen)
      }
      setRaysQ(q)
    },
    [buildRaysRound, finish],
  )

  const answerRays = useCallback(
    (pick: number) => {
      if (!raysQ || raysPick !== null) return
      setRaysPick(pick)
      const correct = pick === raysQ.answer
      if (correct) {
        raysRefs.current.score += 1
        setRaysScore(raysRefs.current.score)
        playSound('correct', soundEnabled)
      } else {
        raysRefs.current.mistakes += 1
        setRaysMistakes(raysRefs.current.mistakes)
        playSound('wrong', soundEnabled)
      }
      flash([{ square: raysQ.target, color: 'gold' }, ...raysQ.attackers.map((sq) => ({ square: sq, color: 'red' as const }))], 1400)
      const token = drillTokenRef.current
      const t = setTimeout(() => {
        if (drillTokenRef.current !== token || finishedRef.current) return
        nextRaysRound(raysRound + 1)
      }, 1700)
      timersRef.current.push(t)
    },
    [raysQ, raysPick, raysRound, flash, nextRaysRound, soundEnabled],
  )

  /* ================================ FLASH =============================== */

  const [flashRound, setFlashRound] = useState(0)
  const [flashPhase, setFlashPhase] = useState<'memorize' | 'question'>('memorize')
  const [flashFen, setFlashFen] = useState(EMPTY_FEN)
  const [flashAsk, setFlashAsk] = useState<{ color: 'w' | 'b'; type: string; square: string } | null>(null)
  const [flashKind, setFlashKind] = useState<'real' | 'random'>('real')
  const [flashMemLeft, setFlashMemLeft] = useState(FLASH_MEMORIZE_SECONDS)
  const [flashScore, setFlashScore] = useState(0)
  const [flashMistakes, setFlashMistakes] = useState(0)
  const [flashBreakdown, setFlashBreakdown] = useState<{ real: number; random: number }>({ real: 0, random: 0 })
  const flashRefs = useRef({ score: 0, mistakes: 0, realCorrect: 0, randomCorrect: 0 })
  const flashDealRef = useRef<Array<{ kind: 'real' | 'random'; fen: string }>>([])
  const beginFlashRoundRef = useRef<(round: number) => void>(() => {})

  const beginFlash = useCallback(() => {
    if (poolRef.current.length < FLASH_ROUNDS) return
    startDrill('flash')
    flashRefs.current = { score: 0, mistakes: 0, realCorrect: 0, randomCorrect: 0 }
    const reals = poolRef.current.slice(0, FLASH_ROUNDS)
    const deal = reals.map((p) => {
      const kind: 'real' | 'random' = Math.random() < 0.5 ? 'real' : 'random'
      return { kind, fen: kind === 'real' ? p.fen : scrambleFen(p.fen) }
    })
    flashDealRef.current = deal
    setFlashScore(0)
    setFlashMistakes(0)
    setFlashRound(0)
    setFlashFen(EMPTY_FEN) // the priming effect below starts round 0
    setFlashPhase('memorize')
  }, [startDrill])

  const beginFlashRound = useCallback(
    (round: number) => {
      if (round >= FLASH_ROUNDS) {
        setFlashBreakdown({ real: flashRefs.current.realCorrect, random: flashRefs.current.randomCorrect })
        finish(flashRefs.current.score, flashRefs.current.mistakes, 0)
        return
      }
      const token = ++drillTokenRef.current
      const item = flashDealRef.current[round]
      setFlashRound(round)
      setFlashKind(item.kind)
      setFlashFen(item.fen)
      setFlashAsk(null)
      setFlashes([])
      setFlashPhase('memorize')
      setFlashMemLeft(FLASH_MEMORIZE_SECONDS)
      let left = FLASH_MEMORIZE_SECONDS
      const iv = setInterval(() => {
        if (drillTokenRef.current !== token) {
          clearInterval(iv)
          return
        }
        left -= 1
        setFlashMemLeft(Math.max(0, left))
        if (left <= 0) {
          clearInterval(iv)
          try {
            const ask = uniqueQuestionPiece(item.fen)
            const square = ask ? piecesOf(item.fen).find((p) => p.color === ask.color && p.type === ask.type)?.square : undefined
            if (!ask || !square) throw new Error('no unique piece to ask about')
            setFlashAsk({ color: ask.color, type: ask.type, square })
            setFlashFen(EMPTY_FEN)
            setFlashPhase('question')
          } catch {
            // degenerate deal — skip forward honestly instead of wedging
            beginFlashRoundRef.current(round + 1)
          }
        }
      }, 1000)
      timersRef.current.push(iv as unknown as ReturnType<typeof setTimeout>)
    },
    [finish],
  )
  beginFlashRoundRef.current = beginFlashRound

  useEffect(() => {
    if (phase === 'running' && drill === 'flash' && flashDealRef.current.length > 0 && flashRound === 0 && flashPhase === 'memorize' && flashFen === EMPTY_FEN) {
      beginFlashRound(0)
    }
  }, [phase, drill, flashRound, flashPhase, flashFen, beginFlashRound])

  const onFlashTap = useCallback(
    (square: string) => {
      if (flashPhase !== 'question' || !flashAsk) return
      const correct = square === flashAsk.square
      setFlashFen(flashDealRef.current[flashRound].fen)
      flash([{ square: flashAsk.square, color: 'gold' }, ...(correct ? [] : [{ square, color: 'red' as const }])], 1500)
      if (correct) {
        flashRefs.current.score += 1
        if (flashKind === 'real') flashRefs.current.realCorrect += 1
        else flashRefs.current.randomCorrect += 1
        setFlashScore(flashRefs.current.score)
        playSound('correct', soundEnabled)
      } else {
        flashRefs.current.mistakes += 1
        setFlashMistakes(flashRefs.current.mistakes)
        playSound('wrong', soundEnabled)
      }
      const token = drillTokenRef.current
      const t = setTimeout(() => {
        if (drillTokenRef.current !== token || finishedRef.current) return
        beginFlashRound(flashRound + 1)
      }, 1800)
      timersRef.current.push(t)
    },
    [flashPhase, flashAsk, flashRound, flashKind, flash, beginFlashRound, soundEnabled],
  )

  /* =============================== RENDER =============================== */

  if (phase === 'idle') {
    const cards: Array<{ d: Drill; icon: typeof Palette; title: string; hint: string; bestLabel: string; disabled?: boolean }> = [
      {
        d: 'colors',
        icon: Palette,
        title: 'Square colors · 30s',
        hint: 'Name the color of any square on sight. Masters hold a live color map — every diagonal is one color, every knight hop flips it.',
        bestLabel: bests ? (bests.colors > 0 ? `Best: ${bests.colors} squares` : 'No runs yet') : '',
      },
      {
        d: 'loose',
        icon: ShieldOff,
        title: 'Loose pieces · 8 rounds',
        hint: 'Attacked and undefended — the number one tactician scan (LPDO). Count what can be hunted, then watch the hunters light up.',
        bestLabel: bests ? (bests.loose > 0 ? `Best: ${bests.loose} of ${LOOSE_ROUNDS}` : 'No runs yet') : '',
        disabled: !poolReady,
      },
      {
        d: 'rays',
        icon: Spline,
        title: 'Rays & defenders · 8 rounds',
        hint: 'See the lines, not the pieces: how many attackers reach a square, and which piece quietly keeps a friend defended.',
        bestLabel: bests ? (bests.rays > 0 ? `Best: ${bests.rays} of ${RAYS_ROUNDS}` : 'No runs yet') : '',
        disabled: !poolReady,
      },
      {
        d: 'flash',
        icon: ScanEye,
        title: 'Flash chunks · 6 rounds',
        hint: 'A position flashes, then the board goes dark. Real master positions against scrambled ones — measure your own chunking, de Groot style.',
        bestLabel: bests ? (bests.flash > 0 ? `Best: ${bests.flash} of ${FLASH_ROUNDS}` : 'No runs yet') : '',
        disabled: !poolReady,
      },
    ]
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold">Eye training</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Beginners see 32 pieces. Masters see colors, rays, loose pieces and whole chunks. In the classic experiments, masters recalled real
            game positions almost perfectly and random scatter barely better than novices — proof that strong players see patterns, not pieces.
            These four drills train exactly that perception. Every position is a real master-game position from the bank.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {cards.map(({ d, icon: Icon, title, hint, bestLabel, disabled }) => (
              <button
                key={d}
                onClick={() => (d === 'colors' ? beginColors() : d === 'loose' ? beginLoose() : d === 'rays' ? beginRays() : beginFlash())}
                disabled={disabled}
                className={cn(
                  'rounded-xl border border-border p-5 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="flex items-center gap-2 font-display text-base font-bold">
                  <Icon className="h-4 w-4 text-primary" /> {title}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                <div className="mt-3 text-xs font-semibold text-muted-foreground">{disabled ? 'Loading positions…' : bestLabel}</div>
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Coordinates sprints and the piece hunt live in Puzzles · Vision — these drills build what those sprints assume you already see.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'over' && result) {
    const of = drill === 'colors' ? null : drill === 'loose' ? LOOSE_ROUNDS : drill === 'rays' ? RAYS_ROUNDS : FLASH_ROUNDS
    const Icon = drill === 'colors' ? Palette : drill === 'loose' ? ShieldOff : drill === 'rays' ? Spline : ScanEye
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl bg-card p-6 text-center shadow-sm">
          <Icon className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[var(--gold)]' : 'text-primary')} />
          <div className="mt-3 font-display text-4xl font-extrabold tabular-nums">{result.score}</div>
          <div className="text-sm text-muted-foreground">
            {of ? `of ${of} · ${result.mistakes} ${result.mistakes === 1 ? 'miss' : 'misses'}` : `squares named in ${COLOR_SECONDS}s · ${result.mistakes} ${result.mistakes === 1 ? 'miss' : 'misses'}`}
          </div>
          {drill === 'flash' && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-left text-sm">
              <div className="font-semibold">Your chunking, measured</div>
              <div className="mt-1 text-muted-foreground">
                Real master positions: <span className="font-bold text-foreground">{flashBreakdown.real} of 3</span> recalled · scrambled:{' '}
                <span className="font-bold text-foreground">{flashBreakdown.random} of 3</span>. Masters score near-perfect on real
                positions because 6–8 pieces chunk into one pattern — and collapse on scrambles. That gap is exactly what you are training.
              </div>
            </div>
          )}
          {drill === 'loose' && (
            <div className="mt-4 text-sm text-muted-foreground">Loose pieces drop off — every blunder starts with an undefended piece nobody scanned.</div>
          )}
          {drill === 'rays' && (
            <div className="mt-4 text-sm text-muted-foreground">Strong players read lines through the whole board, not piece by piece.</div>
          )}
          {result.isNewBest ? (
            <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-bold">New personal best.</div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Best: {result.previousBest}</div>
          )}
          {result.xpGain > 0 && <div className="mt-2 text-sm font-semibold">+{result.xpGain} XP</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Button
              className="btn-hero"
              onClick={() => (drill === 'colors' ? beginColors() : drill === 'loose' ? beginLoose() : drill === 'rays' ? beginRays() : beginFlash())}
            >
              Go again
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              Other drills
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /* ------------------------------ running views ----------------------------- */

  if (drill === 'colors') {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={EMPTY_FEN}
            orientation="w"
            interactive={false}
            showCoords={false}
            showLegal={false}
            flashes={flashes}
            theme={profile?.theme ?? 'green'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Square colors · sprint</div>
            <p className="mt-2 text-sm font-semibold" aria-live="polite">
              What color is
            </p>
            <div className="mt-1 font-display text-5xl font-extrabold tracking-wide">{colorTarget}</div>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-mono font-display text-3xl font-extrabold tabular-nums">0:{String(colorTime).padStart(2, '0')}</span>
              <span className="text-sm text-muted-foreground">
                {colorScore} named · {colorMistakes} missed
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(colorTime / COLOR_SECONDS) * 100}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant={colorAnswer === 'light' ? 'default' : 'outline'}
                className={cn('min-h-14 text-base font-bold', colorAnswer === 'light' && 'pointer-events-none')}
                onClick={() => pickColor('light')}
                disabled={Boolean(colorAnswer)}
              >
                Light
              </Button>
              <Button
                size="lg"
                variant={colorAnswer === 'dark' ? 'default' : 'outline'}
                className={cn('min-h-14 text-base font-bold', colorAnswer === 'dark' && 'pointer-events-none')}
                onClick={() => pickColor('dark')}
                disabled={Boolean(colorAnswer)}
              >
                Dark
              </Button>
            </div>
            <Button variant="outline" className="mt-2 w-full" onClick={() => finish(colorRefs.current.score, colorRefs.current.mistakes, COLOR_SECONDS)}>
              End run
            </Button>
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            The board only appears to show the answer. Build the map in your head: a1 is dark, every diagonal is one color, d5 and f3 are both
            light. Wrong picks stay on screen until you see the square.
          </div>
        </div>
      </div>
    )
  }

  if (drill === 'loose') {
    const sideLabel = looseSide === 'white' ? 'White' : 'Black'
    const truthList = looseTruth ?? []
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={looseFen}
            orientation={looseSide === 'white' ? 'w' : 'b'}
            interactive={false}
            showCoords
            showLegal={false}
            flashes={flashes}
            theme={profile?.theme ?? 'green'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Loose pieces · round {looseRound + 1} of {LOOSE_ROUNDS}
            </div>
            <p className="mt-2 text-sm font-semibold" aria-live="polite">
              How many {sideLabel.toLowerCase()} pieces are attacked right now and defended by nobody?
            </p>
            <div className="mt-1 text-sm text-muted-foreground">
              {looseScore} correct · {looseMistakes} missed
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {looseOptions.map((n) => (
                <button
                  key={n}
                  onClick={() => answerLoose(n)}
                  disabled={loosePick !== null || looseTruth === null}
                  className={cn(
                    'min-h-11 rounded-lg border border-border text-base font-bold transition active:scale-95',
                    loosePick !== null && n === Math.min(truthList.length, 4) && 'border-primary bg-primary/10',
                    loosePick === n && !looseAnsweredCorrect && 'border-destructive bg-destructive/10',
                  )}
                  aria-label={`${n} loose pieces`}
                >
                  {n === 4 ? '4+' : n}
                </button>
              ))}
            </div>
            {loosePick !== null && (
              <div className="mt-3 text-sm" aria-live="polite">
                {truthList.length === 0 ? (
                  <span className="text-primary">Nothing loose for {sideLabel} here — a clean position.</span>
                ) : (
                  <ul className="space-y-1 text-muted-foreground">
                    {truthList.map((lp) => {
                      const g = new Chess(looseFen)
                      const hunters = lp.attackers
                        .map((sq) => ({ sq, pc: g.get(sq as Square) }))
                        .filter((x) => x.pc)
                        .map((x) => `${pieceLabel(x.pc!.color, x.pc!.type)} on ${x.sq}`)
                        .join(', ')
                      return (
                        <li key={lp.square}>
                          <span className="font-semibold text-foreground">
                            {pieceLabel(lp.color, lp.type)} on {lp.square}
                          </span>{' '}
                          — hunted by {hunters}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            LPDO — loose pieces drop off. Every tactic starts here: a piece the enemy can capture and you cannot recapture. Gold marks the loose,
            red marks the hunters.
          </div>
        </div>
      </div>
    )
  }

  if (drill === 'rays' && raysQ) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={raysQ.fen}
            orientation={raysQ.side === 'w' ? 'w' : 'b'}
            interactive={false}
            showCoords
            showLegal={false}
            flashes={flashes}
            theme={profile?.theme ?? 'green'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rays &amp; defenders · round {raysRound + 1} of {RAYS_ROUNDS}
            </div>
            {raysQ.kind === 'count' ? (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  How many {raysQ.side === 'w' ? 'white' : 'black'} pieces attack {raysQ.target}?
                </p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {(raysQ.options as number[]).map((n, i) => (
                    <button
                      key={i}
                      onClick={() => answerRays(i)}
                      disabled={raysPick !== null}
                      className={cn(
                        'min-h-11 rounded-lg border border-border text-base font-bold transition active:scale-95',
                        raysPick !== null && i === raysQ.answer && 'border-primary bg-primary/10',
                        raysPick === i && i !== raysQ.answer && 'border-destructive bg-destructive/10',
                      )}
                      aria-label={`${n} attackers`}
                    >
                      {n === 4 ? '4+' : n}
                    </button>
                  ))}
                </div>
                {raysPick !== null && (
                  <div className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                    {raysQ.attackers.map((sq) => {
                      const pc = new Chess(raysQ.fen).get(sq as Square)
                      return pc ? `${pieceLabel(pc.color, pc.type)} on ${sq}` : sq
                    }).join(' · ') || 'No attacker reaches it.'}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  What defends the {pieceLabel(raysQ.side, piecesOf(raysQ.fen).find((p) => p.square === raysQ.target)?.type ?? 'p')} on {raysQ.target}?
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(raysQ.options as Array<{ color: 'w' | 'b'; type: string }>).map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => answerRays(i)}
                      disabled={raysPick !== null}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border p-2 transition active:scale-95',
                        raysPick !== null && i === raysQ.answer && 'border-primary bg-primary/10',
                        raysPick === i && i !== raysQ.answer && 'border-destructive bg-destructive/10',
                      )}
                    >
                      <img src={pieceImgSrc(opt.color, opt.type)} alt="" className="h-7 w-7" draggable={false} />
                      <span className="text-xs font-semibold text-muted-foreground">{pieceLabel(opt.color, opt.type)}</span>
                    </button>
                  ))}
                </div>
                {raysPick !== null && raysQ.defender && (
                  <div className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                    The {pieceLabel(raysQ.defender.color, raysQ.defender.type)} on {raysQ.defender.square} keeps {raysQ.target} defended.
                  </div>
                )}
              </>
            )}
            <div className="mt-3 text-sm text-muted-foreground">
              {raysScore} correct · {raysMistakes} missed
            </div>
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            Gold marks the square in question, red marks the pieces doing the work. Counting rays is how masters see forks, skewers and
            discovered attacks before they exist.
          </div>
        </div>
      </div>
    )
  }

  if (drill === 'flash') {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={flashFen}
            orientation="w"
            interactive={flashPhase === 'question'}
            showCoords={flashPhase === 'question'}
            showLegal={false}
            flashes={flashes}
            onSquareTap={onFlashTap}
            theme={profile?.theme ?? 'green'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Flash chunks · round {flashRound + 1} of {FLASH_ROUNDS} · {flashKind === 'real' ? 'real master game' : 'scrambled'}
            </div>
            {flashPhase === 'memorize' ? (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  Memorize the position
                </p>
                <div className="mt-1 font-mono font-display text-5xl font-extrabold tabular-nums">{flashMemLeft}</div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(flashMemLeft / FLASH_MEMORIZE_SECONDS) * 100}%` }} />
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  Where did the {flashAsk ? pieceLabel(flashAsk.color, flashAsk.type) : ''} stand?
                </p>
                <div className="mt-2 text-sm text-muted-foreground">
                  Tap the square · {flashScore} found · {flashMistakes} missed
                </div>
              </>
            )}
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            {flashKind === 'real'
              ? 'This is a real position from a real master game — your chunks should help here.'
              : 'Same pieces, random squares — no chunks exist. Notice how much harder this feels.'}
          </div>
        </div>
      </div>
    )
  }

  return null
}
