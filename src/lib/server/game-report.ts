// Server-side game-review brain: per-ply evaluation with the app's engine
// core, then chess.com-accurate move classification through the FROZEN
// classifier in src/lib/chess/move-classification.ts. This module never
// invents labels itself: every decision goes through classifyMove(), fed with
// the exact ClassifyInput contract (win%-based tiers, strict Brilliant gate,
// book/forced/checkmate handling).
//
// When the engine is down the module degrades honestly: it returns every ply
// it managed to evaluate plus an `engineAvailable: false` marker so callers
// (and the GUI) can fall back instead of pretending.
import 'server-only'
import { Chess } from 'chess.js'
import { analyze } from '@/lib/server/engine'
import { classifyMove, type MoveLabel, moverPov, winPercentFromPawns } from '@/lib/chess/move-classification'
import {
  cplOf,
  computeReviewAreas,
  computeCallouts,
  type PlyEvalDTO,
  type TheoryInfo,
  type ReviewAreas,
  type Callout,
} from '@/lib/chess/review-types'
import { detectOpening } from '@/lib/chess/openings'

/** The single label set, shared with every GUI surface. */
export type Label = MoveLabel

export interface PlyIn {
  san: string
  color: 'w' | 'b'
  fenBefore: string
}

/** Per-ply output shape is the shared review contract. */
export type PlyEvalOut = PlyEvalDTO

export interface EvalPliesOptions {
  /**
   * SANs of every ply played before this batch (the game so far). Opening
   * theory detection is prefix-based, so a chunked review must send the moves
   * that came before the chunk for book hits and theoryPlies to be correct.
   */
  priorSans?: string[]
  /**
   * Seconds spent per ply, aligned 1:1 with `plies` (parsed client-side from
   * PGN %clk comments). Null entries mean unknown; null/omitted means the
   * game carries no clock data and the clock area stays hidden.
   */
  clockSecs?: (number | null)[] | null
}

export interface EvalPliesResult {
  /** Evaluated plies, in input order. Shorter than the input when the engine stopped early. */
  plies: PlyEvalDTO[]
  /** Opening theory for priorSans + the whole batch (engine-independent). */
  opening: TheoryInfo
  /** Five-area breakdown computed over the evaluated plies. */
  areas: ReviewAreas
  bestMove: Callout | null
  worstMove: Callout | null
  /** false = the engine was unavailable or died mid-batch: `plies` holds everything evaluated so far. */
  engineAvailable: boolean
}

// ---------------------------------------------------------------------------
// Opening book. Prefixes mirror the opening table in src/lib/chess/openings.ts
// (which only exports the name lookup), expressed per move so a single ply can
// be tested against theory. A ply is a book hit while the game still follows
// at least one known line.
// ---------------------------------------------------------------------------
const BOOK_LINES: string[][] = [
  'e4 e5 nf3 nc6 bb5',
  'e4 e5 nf3 nc6 bc4',
  'e4 e5 nf3 nc6 d4',
  'e4 e5 nf3 nf6',
  'e4 e5 nf3 d6',
  'e4 e5 nc3',
  'e4 e5 f4',
  'e4 e5 bc4',
  'e4 e5 d4',
  'e4 c5 nf3 d6',
  'e4 c5 nf3 nc6',
  'e4 c5 nf3 e6',
  'e4 c5',
  'e4 e6',
  'e4 c6',
  'e4 d5',
  'e4 nf6',
  'e4 d6',
  'e4 g6',
  'd4 d5 c4 e6',
  'd4 d5 c4 c6',
  'd4 d5 c4 dxc4',
  'd4 d5 c4',
  'd4 nf6 c4 g6',
  'd4 nf6 c4 e6 nc3 bb4',
  'd4 nf6 c4 b6',
  'd4 nf6 c4',
  'd4 f5',
  'd4 d5 nf3',
  'd4 d5',
  'nf3 d5 g3',
  'nf3 d5 c4',
  'nf3',
  'c4',
  'g3',
  'b3',
  'f4',
  'e4 e5',
  'e4',
  'd4',
].map((line) => line.split(' '))

/** Theory stops being counted past here, matching the classifier's book gate. */
const BOOK_MAX_PLIES = 24

const normalizeSan = (san: string): string => san.replace(/[+#]/g, '').toLowerCase()

/**
 * True when the move at `ply` (1-based) keeps the game inside at least one
 * known opening line. `sans` holds the normalized SANs of the game so far,
 * indexed from ply 1.
 */
function isBookMove(sans: string[], ply: number): boolean {
  if (ply < 1 || ply > BOOK_MAX_PLIES || ply > sans.length) return false
  for (const line of BOOK_LINES) {
    if (line.length < ply) continue
    let matches = true
    for (let i = 0; i < ply; i++) {
      if (sans[i] !== line[i]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

/**
 * Where the player left opening theory, from a full-game SAN list. Pure and
 * engine-independent, so both the review pipeline and the report route can
 * recompute it server-side instead of trusting the client.
 */
export function computeTheory(sansRaw: string[]): TheoryInfo {
  const sans = sansRaw.map(normalizeSan)
  let theoryPlies = 0
  for (let ply = 1; ply <= sans.length; ply++) {
    if (!isBookMove(sans, ply)) break
    theoryPlies = ply
  }
  const detected = detectOpening(sansRaw)
  const openingName = detected === 'Irregular opening' ? '' : detected
  const firstDeviationSan = theoryPlies < sansRaw.length ? sansRaw[theoryPlies] ?? null : null
  return { openingName, theoryPlies, firstDeviationSan }
}

/** Win probability for the side the centipawns belong to (the standard logistic). */
export function winPercent(cp: number): number {
  return winPercentFromPawns(cp / 100)
}

interface PosEval {
  /** white POV centipawns, null when a forced mate is on the board */
  cp: number | null
  /** mate distance in PLIES, always positive; null when no forced mate */
  matePlies: number | null
  /** true when WHITE is the one delivering the mate */
  mateForWhite: boolean
  /** white POV pawns for display; mate flattens to ±80 */
  pawns: number
  /** win probability for white, 0..100 */
  whiteWp: number
}

const PIECE_VALS: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

const MATE_BASE = 100000

function evalFromScore(scoreStmPov: number, turn: 'w' | 'b'): PosEval {
  const whitePovScore = turn === 'w' ? scoreStmPov : -scoreStmPov
  if (Math.abs(scoreStmPov) >= 90000) {
    const mateForWhite = whitePovScore > 0
    // recover the plies-to-mate out of parseScore's mapping: 100000 - plies*100
    const plies = Math.max(1, Math.round((MATE_BASE - Math.abs(whitePovScore)) / 100))
    return { cp: null, matePlies: plies, mateForWhite, pawns: mateForWhite ? 80 : -80, whiteWp: mateForWhite ? 100 : 0 }
  }
  return {
    cp: whitePovScore,
    matePlies: null,
    mateForWhite: false,
    pawns: Math.max(-80, Math.min(80, Math.round((whitePovScore / 100) * 100) / 100)),
    whiteWp: winPercent(whitePovScore),
  }
}

function sanOfUci(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })?.san ?? null
  } catch {
    return null
  }
}

const stripSuffix = (san: string) => san.replace(/[+#]/g, '')

/**
 * Evaluate a batch of plies with the engine core and classify every move with
 * the frozen chess.com-accurate classifier. Returns the plies evaluated so
 * far plus the report extras; an empty `plies` array with
 * `engineAvailable: false` means the engine was never available, so the
 * caller can degrade honestly to a client-side path.
 */
export async function evalPlies(plies: PlyIn[], depth: number, opts: EvalPliesOptions = {}): Promise<EvalPliesResult> {
  const priorSans = (opts.priorSans ?? []).map(normalizeSan).slice(0, 1024)
  const clockSecs = opts.clockSecs ?? null
  const out: PlyEvalDTO[] = []

  // normalized SANs for the whole game prefix this batch covers; book hits
  // are prefix tests, so the batch must line up behind priorSans
  const allSans = [...priorSans, ...plies.map((p) => normalizeSan(p.san))]

  for (let i = 0; i < plies.length; i++) {
    const p = plies[i]
    const plyNumber = priorSans.length + i + 1 // 1-based position in the whole game
    const fenBefore = p.fenBefore
    const probe = new Chess(fenBefore)
    const turn = probe.turn() as 'w' | 'b'
    const legalMoveCount = probe.moves().length
    const bookHit = isBookMove(allSans, plyNumber)

    // position before the move: MultiPV 2 for the best move, the uniqueness
    // margin (great/cliff detection) and the second-best eval
    const before = await analyze(fenBefore, 2, depth)
    if (!before) break // engine down or search stalled: stop, return what we have

    const beforeEval = evalFromScore(before.bestScore, turn)

    // position after the move
    let mv: ReturnType<Chess['move']> | null = null
    try {
      mv = probe.move(p.san)
    } catch {
      mv = null
    }
    if (!mv) break // malformed input; stop here

    const lastMove = mv
    let afterEval: PosEval
    let afterPv: string[] = []
    if (probe.isCheckmate()) {
      // the move DELIVERS mate: the mated side is to move, one ply deep —
      // exactly the mateAfterForWhite/mateAfterPlies convention classifyMove expects
      afterEval = { cp: null, matePlies: 1, mateForWhite: probe.turn() === 'b', pawns: probe.turn() === 'w' ? -80 : 80, whiteWp: probe.turn() === 'w' ? 0 : 100 }
    } else if (probe.isGameOver()) {
      afterEval = { cp: 0, matePlies: null, mateForWhite: false, pawns: 0, whiteWp: 50 }
    } else {
      const after = await analyze(probe.fen(), 1, depth)
      if (!after) break
      afterEval = evalFromScore(after.bestScore, probe.turn() as 'w' | 'b')
      afterPv = after.pv
    }

    const bestUci = before.pv[0] ?? before.best ?? null
    const bestSan = bestUci ? sanOfUci(fenBefore, bestUci) : null
    const isBest = bestSan != null && stripSuffix(bestSan) === stripSuffix(p.san)

    // engine's second choice and its white-POV pawn eval after it lands —
    // the inputs for the "great" uniqueness cliff
    const secondBestSanRaw = before.secondBest ? sanOfUci(fenBefore, before.secondBest) : null
    const secondBestBefore = before.secondScore != null ? evalFromScore(before.secondScore, turn).pawns : null

    // sacrifice probes: the move gives up an important piece AND the opponent
    // can actually take the piece AND the engine's best reply is that capture
    const canBeTaken = probe.moves({ verbose: true }).some((m) => m.to === lastMove.to && /[ce]/.test(m.flags))
    let bestReplyTakesOffer = false
    if (canBeTaken && afterPv.length > 0) {
      try {
        const g2 = new Chess(probe.fen())
        const rm = g2.move({ from: afterPv[0].slice(0, 2), to: afterPv[0].slice(2, 4), promotion: afterPv[0].slice(4, 5) || undefined })
        bestReplyTakesOffer = Boolean(rm?.captured) && rm?.to === lastMove.to
      } catch {
        bestReplyTakesOffer = false
      }
    }

    const label = classifyMove({
      fenBefore,
      san: p.san,
      color: p.color,
      before: beforeEval.pawns,
      after: afterEval.pawns,
      mateBeforeForWhite: beforeEval.matePlies != null ? beforeEval.mateForWhite : null,
      mateBeforePlies: beforeEval.matePlies,
      mateAfterForWhite: afterEval.matePlies != null ? afterEval.mateForWhite : null,
      mateAfterPlies: afterEval.matePlies,
      bestSan: bestSan ? stripSuffix(bestSan) : null,
      secondBestSan: secondBestSanRaw ? stripSuffix(secondBestSanRaw) : null,
      secondBestBefore,
      legalMoveCount,
      isBest,
      movedPiece: lastMove.piece,
      capturedPiece: lastMove.captured ?? null,
      offerCanBeTaken: canBeTaken,
      bestReplyTakesOffer,
      bookHit,
      ply: plyNumber,
    })

    // uniqueness margin (mover-POV win% gap to the second-best move), for the coach line
    let cliffWp: number | null = null
    if (secondBestBefore != null) {
      cliffWp = winPercentFromPawns(moverPov(beforeEval.pawns, p.color)) - winPercentFromPawns(moverPov(secondBestBefore, p.color))
    }

    const reason = buildReason({
      label,
      color: p.color,
      bestSan,
      beforeEval,
      afterEval,
      afterFen: probe.fen(),
      afterPv,
      moveWasCapture: Boolean(lastMove.captured),
      cliffWp,
      san: lastMove.san,
      movedPiece: lastMove.piece,
      capturedPiece: lastMove.captured ?? null,
      toSquare: lastMove.to,
    })

    out.push({
      san: p.san,
      color: p.color,
      before: beforeEval.pawns,
      after: afterEval.pawns,
      bestUci,
      bestSan,
      label,
      ...(reason ? { reason } : {}),
      cpl: cplOf(beforeEval.pawns, afterEval.pawns, p.color),
      timeSpentSec: clockSecs ? clockSecs[i] ?? null : null,
    })
  }

  const engineAvailable = plies.length > 0 && out.length === plies.length
  const theory = computeTheory([...(opts.priorSans ?? []), ...plies.map((p) => p.san)])
  const evaluatedClock = clockSecs ? clockSecs.slice(0, out.length).map((s) => s ?? null) : null
  const callouts = computeCallouts(out)
  return {
    plies: out,
    opening: theory,
    areas: computeReviewAreas(out, theory, evaluatedClock),
    bestMove: callouts.bestMove,
    worstMove: callouts.worstMove,
    engineAvailable,
  }
}

function buildReason(ctx: {
  label: MoveLabel
  color: 'w' | 'b'
  bestSan: string | null
  beforeEval: PosEval
  afterEval: PosEval
  afterFen: string
  afterPv: string[]
  moveWasCapture: boolean
  cliffWp: number | null
  /** the played move, full SAN (with +/# suffixes) */
  san?: string
  /** piece that moved + destination square, from the replayed move object */
  movedPiece?: string | null
  capturedPiece?: string | null
  toSquare?: string | null
}): string | undefined {
  const PIECE_NAMES_LC: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
  const isCheckMove = ctx.san?.endsWith('+') === true
  const isCastle = ctx.san?.startsWith('O-O') === true

  if (ctx.label === 'brilliant') {
    return 'A real sacrifice: the piece can be taken, but the engine confirms the position stays yours.'
  }
  if (ctx.label === 'great') {
    const cliff = ctx.cliffWp != null ? Math.round(ctx.cliffWp) : null
    return cliff != null && cliff >= 10
      ? `The only move that holds the position — the runner-up loses about ${cliff}% of the winning chances.`
      : 'The only move that holds the position.'
  }
  // Positive tiers get move-specific "why" text so the coach never repeats one
  // generic sentence for two different moves. Everything stated is verified:
  // capture/check/castle/development/center come from the replayed move, and
  // "the engine's top choice" only appears because the label guarantees it.
  if (ctx.label === 'best') {
    if (ctx.capturedPiece) {
      const name = PIECE_NAMES_LC[ctx.capturedPiece] ?? 'piece'
      return `Takes the ${name} on ${ctx.toSquare} — the engine's top choice.`
    }
    if (isCastle) return 'Castles — the king tucks away and the rook joins the game. The engine’s top choice.'
    if (isCheckMove) return 'Checks the king and keeps the initiative — the engine’s top choice.'
    if (ctx.movedPiece === 'n' || ctx.movedPiece === 'b') {
      return `Develops the ${PIECE_NAMES_LC[ctx.movedPiece]} — the engine's top choice.`
    }
    if (ctx.movedPiece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(ctx.toSquare ?? '')) {
      return 'Claims space in the center — the engine’s top choice.'
    }
    return 'The engine’s top choice here.'
  }
  if (ctx.label === 'excellent') {
    if (ctx.bestSan) {
      return `Nearly the engine's best — ${ctx.bestSan} was a hair sharper, but the difference is invisible over the board.`
    }
    return undefined
  }
  if (ctx.label === 'good') {
    if (ctx.bestSan) {
      return `Playable, but ${ctx.bestSan} kept more of the advantage — the move the coach would play.`
    }
    if (ctx.capturedPiece) {
      const name = PIECE_NAMES_LC[ctx.capturedPiece] ?? 'piece'
      return `Collects the ${name} on ${ctx.toSquare}. A fine move.`
    }
    return undefined
  }
  if (ctx.label !== 'blunder' && ctx.label !== 'mistake' && ctx.label !== 'inaccuracy' && ctx.label !== 'missedwin') {
    return undefined
  }

  const moverHadMate = ctx.beforeEval.matePlies != null && ctx.beforeEval.mateForWhite === (ctx.color === 'w')
  const moverGetsMated = ctx.afterEval.matePlies != null && ctx.afterEval.mateForWhite !== (ctx.color === 'w')

  // had a forced mate and let it slip
  if (moverHadMate && !moverGetsMated && ctx.bestSan) {
    const moves = Math.max(1, Math.ceil((ctx.beforeEval.matePlies ?? 1) / 2))
    return `You had a forced mate in ${moves} — ${ctx.bestSan} starts it.`
  }

  // walked into a forced mate
  if (moverGetsMated) {
    const moves = Math.max(1, Math.ceil((ctx.afterEval.matePlies ?? 1) / 2))
    return ctx.bestSan
      ? `This allows a forced mate in ${moves}. ${ctx.bestSan} was the way to keep fighting.`
      : `This allows a forced mate in ${moves}.`
  }

  // hung material: the engine's best reply is a capture of a real piece and
  // the reviewed move did not capture anything itself
  if (!ctx.moveWasCapture && ctx.afterPv.length > 0) {
    const replySan = sanOfUci(ctx.afterFen, ctx.afterPv[0])
    if (replySan) {
      try {
        const g = new Chess(ctx.afterFen)
        const rm = g.move(replySan)
        const capVal = rm?.captured ? PIECE_VALS[rm.captured] ?? 0 : 0
        if (rm?.captured && capVal >= 3) {
          const name = PIECE_NAMES[rm.captured]
          return `This leaves the ${name} hanging — ${replySan} simply takes it.`
        }
      } catch {
        /* reply conversion failed, fall through to the generic text */
      }
    }
  }

  if (ctx.label === 'missedwin') {
    return ctx.bestSan
      ? `A winning position was on the board — ${ctx.bestSan} presses the advantage home.`
      : 'A winning position was on the board, and the win slipped away.'
  }

  const drop = Math.max(0, (ctx.color === 'w' ? ctx.beforeEval.pawns : -ctx.beforeEval.pawns) - (ctx.color === 'w' ? ctx.afterEval.pawns : -ctx.afterEval.pawns))
  if (ctx.bestSan) {
    if (ctx.label === 'inaccuracy') return `A small drift, about ${drop.toFixed(1)} pawns. ${ctx.bestSan} keeps more of the edge.`
    return `Costs about ${drop.toFixed(1)} pawns. ${ctx.bestSan} was the engine's choice.`
  }
  return `Costs about ${drop.toFixed(1)} pawns.`
}
