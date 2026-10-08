// Line crafting for coach skills. The engine owns every move: candidates come
// from validated curriculum positions, the PV provides the solution, and a
// MultiPV margin guarantees the point is unique. The LLM only writes the
// teaching copy afterwards, so a hallucinated move can never reach a student.
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
}

/**
 * Build one engine-verified candidate line from a position. Returns null
 * when the position is unsuitable (already decided, in check for puzzles,
 * no unique point, engine unavailable). Exactly one analyze call per probe.
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
  // A real puzzle point: the best move must stand clearly above the rest.
  if (pre.secondScore != null && !mateIn && pre.bestScore - pre.secondScore < opts.minMargin) return null

  // Walk the PV, alternating solver and opponent, capping solver moves.
  const walk = new Chess(fen)
  const solution: string[] = []
  const maxPlies = opts.maxSolverMoves * 2 - 1 // end on a solver move when possible
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

  return {
    fen,
    solution,
    margin: pre.secondScore != null ? pre.bestScore - pre.secondScore : null,
    mateIn,
    winning,
  }
}
