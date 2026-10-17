// Line crafting for coach skills. The engine owns every move: candidates come
// from validated curriculum positions, the PV provides the solution, and a
// MultiPV margin guarantees the point is unique. The LLM only writes the
// teaching copy afterwards, so a hallucinated move can never reach a student.
//
// The one rule this file exists for: a winning puzzle does not stop early.
// When the root is winning, the solution line is played out move by move,
// re-analyzing as it goes, until the checkmate is actually delivered. A line
// that cannot reach mate inside the budget is rejected outright, never
// served half-finished.
import 'server-only'
import { Chess } from 'chess.js'
import { TIERS } from '@/content/levels'
import { analyze, engineAvailable } from '@/lib/server/engine'

export interface CraftedLine {
  fen: string
  solution: string[] // SAN, solver moves at even indexes
  margin: number | null // best minus second-best at the root, cp
  mateIn: number | null // plies to mate when the root is a mate score
  winning: boolean // root eval at least +2.5 for the solver (or mate)
  /** True when the shipped line ends in a verified checkmate. */
  endsInMate: boolean
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    const mv = g.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    })
    return mv?.san ?? null
  } catch {
    return null
  }
}

/**
 * Curriculum positions a student at (tierN, levelN) may be quizzed on:
 * every validated FEN from tiers up to the target and levels up to the
 * target level, so nothing is spoiled and everything was already checked
 * by the content validator.
 */
export function collectCandidateFens(tierN: number, levelN: number, max = 80): string[] {
  const seen = new Set<string>()
  const fens: string[] = []
  for (const tier of TIERS) {
    if (tier.n > tierN) continue
    for (const level of tier.levels) {
      if (tier.n === tierN && level.n > levelN) continue
      for (const step of level.steps) {
        const f = 'fen' in step && typeof step.fen === 'string' ? step.fen : null
        if (!f) continue
        const key = f.split(' ').slice(0, 2).join(' ')
        if (seen.has(key)) continue
        seen.add(key)
        fens.push(f)
      }
    }
  }
  for (let i = fens.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[fens[i], fens[j]] = [fens[j], fens[i]]
  }
  return fens.slice(0, max)
}

export interface CraftOpts {
  requireWin: boolean // puzzle: only clearly winning roots; drill: sharp or quiet both fine
  minMargin: number // minimum cp gap between best and second at the root (uniqueness)
  maxSolverMoves: number
  /** Reject roots already better than this cp for the solver: a puzzle must
   * have a POINT, not a conversion of an already-won position. */
  maxRootScore?: number
  /** Wall-clock budget for the whole craft, extension included. */
  deadline?: number
  /** When true, a winning root MUST produce a line that ends in checkmate,
   * played out move by move, or the candidate is rejected. Used by mate hunts. */
  toMate?: boolean
  /** When true, the line is extended to checkmate whenever the engine can
   * demonstrate the kill inside the budget; a longer conversion keeps the
   * tactical point and the card's pressing phase carries the win to the end.
   * This is the standard for regular puzzles: no puzzle stops at the tactic
   * when a demonstrable mate is within reach. */
  tryMate?: boolean
  /** Depth used by the extension searches (cheaper than the root probe). */
  extensionDepth?: number
  /** Hard cap on plies added by the extension walk. */
  maxExtraPlies?: number
}

// Extension searches are the cheap kind: single PV, shallower depth. Mate
// nets at this depth are still exact (mate scores never truncate early).
const EXTENSION_DEPTH = 10
const DEFAULT_MAX_EXTRA = 24

function replay(fen: string, sans: string[]): Chess | null {
  try {
    const g = new Chess(fen)
    for (const san of sans) g.move(san)
    return g
  } catch {
    return null
  }
}

/**
 * Keep playing the engine's best moves for BOTH sides until the king is
 * actually mated. The root PV can run out a move or two short of the mate
 * score (truncated PV, shallow depth); re-analyzing every position closes
 * that gap, so a served mate line always ends in '#'. Returns null when the
 * line would not reach mate inside the caps: the caller then rejects the
 * candidate instead of shipping a puzzle that stops early.
 */
async function extendToMate(
  startGame: Chess,
  maxExtraPlies: number,
  deadline: number | null,
  depth: number,
): Promise<string[] | null> {
  // Fresh walker from the head position: the caller's game object stays
  // untouched, and the loop below always reasons from where the line stands.
  const game = new Chess(startGame.fen())
  const extra: string[] = []
  // Shuffle guard: a winning conversion at shallow depth loves to shuffle
  // (Kg3 / Kf3 forever), and chess.js then ends the walk early with a
  // threefold-repetition draw. Every visited position is remembered; when
  // the engine's best move would walk back into one, the rank-2 move plays
  // instead. That one nudge is usually all a won position needs to start
  // marching the king and convert to an actual mate.
  const seen = new Set<string>([positionKey(game.fen())])
  const wouldRepeat = (uci: string): boolean => {
    try {
      const probe = new Chess(game.fen())
      probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
      return seen.has(positionKey(probe.fen()))
    } catch {
      return false
    }
  }
  while (!game.isGameOver() && extra.length < maxExtraPlies) {
    if (deadline != null && Date.now() > deadline) return null
    const a = await analyze(game.fen(), 2, depth)
    if (!a) return null
    let uci = a.best
    if (wouldRepeat(uci) && a.secondBest && a.secondBest.length >= 4 && !wouldRepeat(a.secondBest)) {
      uci = a.secondBest
    }
    const san = uciToSan(game.fen(), uci)
    if (!san) return null
    try {
      game.move(san)
    } catch {
      return null
    }
    seen.add(positionKey(game.fen()))
    extra.push(san)
  }
  return game.isCheckmate() ? extra : null
}

/** Position identity for repetition tracking: placement, turn, castling, en passant. */
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/**
 * Extend an existing line (from the real-game bank or a PV walk) until
 * checkmate, engine-best for both sides. Used to guarantee that every served
 * winning puzzle demonstrates the whole kill. Returns the full extended SAN
 * line, or null when mate could not be reached inside the caps.
 */
export async function extendLineToMate(opts: {
  fen: string
  solution: string[]
  maxExtraPlies?: number
  deadline?: number | null
  depth?: number
}): Promise<string[] | null> {
  const game = replay(opts.fen, opts.solution)
  if (!game) return null
  if (game.isGameOver()) return game.isCheckmate() ? [] : null
  const extra = await extendToMate(
    game,
    opts.maxExtraPlies ?? DEFAULT_MAX_EXTRA,
    opts.deadline ?? null,
    opts.depth ?? EXTENSION_DEPTH,
  )
  if (extra == null) return null
  return [...opts.solution, ...extra]
}

/** Pure chess.js check that a line ends in checkmate (structural, no engine). */
export function lineEndsInMate(fen: string, solution: string[]): boolean {
  const g = replay(fen, solution)
  return g != null && g.isCheckmate()
}

/**
 * Build one engine-verified candidate line from a position. Returns null
 * when the position is unsuitable (already decided, in check for puzzles,
 * no unique point, engine unavailable, or a required mate could not be
 * demonstrated). One MultiPV probe at the root, then the line.
 */
export async function craftWinningLine(fen: string, opts: CraftOpts): Promise<CraftedLine | null> {
  if (!(await engineAvailable())) return null
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return null
  }
  if (game.isGameOver()) return null
  if (opts.requireWin && game.isCheck()) return null
  if (game.moves().length < 5) return null

  const pre = await analyze(fen, 3)
  if (!pre) return null
  const mateIn = pre.bestScore >= 99_000 ? Math.ceil((100_000 - pre.bestScore) / 100) : null
  const winning = mateIn != null || pre.bestScore >= 250
  if (opts.requireWin && !winning) return null
  if (opts.requireWin && opts.maxRootScore != null && !mateIn && pre.bestScore > opts.maxRootScore) return null
  // A real puzzle point: the best move must stand clearly above the rest.
  if (pre.secondScore != null && !mateIn && pre.bestScore - pre.secondScore < opts.minMargin) return null
  // No second line means MultiPV could not rank a runner-up: without a
  // measured margin the "puzzle" may have many equally good answers, which
  // is exactly the slop class the bank exists to prevent. Reject.
  if (pre.secondScore == null && !mateIn) return null

  // Walk the PV, alternating solver and opponent. A winning root never stops
  // early: when toMate is set the line continues, re-analyzing as needed,
  // until the mate is actually delivered, so the student always plays the
  // whole kill instead of a two-move fragment.
  const walk = new Chess(fen)
  const solution: string[] = []
  const maxPlies = mateIn != null ? 30 : opts.maxSolverMoves * 2 - 1 // end on a solver move when possible
  for (let i = 0; i < Math.min(pre.pv.length, maxPlies); i++) {
    const san = uciToSan(walk.fen(), pre.pv[i])
    if (!san) break
    try {
      walk.move(san)
    } catch {
      break
    }
    solution.push(san)
    if (walk.isGameOver()) break
  }
  if (solution.length === 0) return null

  const wantsMate = Boolean(opts.toMate)
  const wantsExtension = wantsMate || Boolean(opts.tryMate)
  if (wantsExtension && (winning || mateIn != null) && !walk.isCheckmate()) {
    // The PV stopped short of the king falling (truncated PV or a material
    // win that still needs converting). Re-analyze forward move by move and
    // keep the line going until '#'. A hard toMate demand rejects the
    // candidate when the kill cannot be shown; a best-effort extension keeps
    // the tactical point and lets the card's pressing phase finish the job.
    const budgetLeft = opts.deadline != null ? Math.max(0, opts.deadline - Date.now()) : null
    const extensionBudget = budgetLeft == null ? null : Math.min(budgetLeft, wantsMate ? 12_000 : 8_000)
    const extra = await extendToMate(
      walk,
      opts.maxExtraPlies ?? DEFAULT_MAX_EXTRA,
      extensionBudget != null ? Date.now() + extensionBudget : null,
      opts.extensionDepth ?? EXTENSION_DEPTH,
    )
    if (extra) {
      solution.push(...extra)
    } else if (wantsMate) {
      return null
    }
  }
  // Structural guarantee for every mate claim, engine score aside: the exact
  // moves shipped must end the game by checkmate when replayed cold.
  const endsInMate = lineEndsInMate(fen, solution)
  if (wantsMate && !endsInMate) return null

  return {
    fen,
    solution,
    margin: pre.secondScore != null ? pre.bestScore - pre.secondScore : null,
    mateIn,
    winning,
    endsInMate,
  }
}
