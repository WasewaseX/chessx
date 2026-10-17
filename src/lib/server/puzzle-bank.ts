// The real-game puzzle bank: selection and dedupe for serving. Every entry
// in MASTER_PUZZLES was mined from a real rated game and passed the strict
// offline engine battery (see scripts/bank/verify-bank.ts). The coach serves
// from this bank FIRST; the live crafter only runs when the bank cannot
// satisfy a request, so slop has no path to a student.
import 'server-only'
import { db } from '@/lib/db'
import { MASTER_PUZZLES, type MasterPuzzle } from '@/content/master-puzzles'

export { MASTER_PUZZLES }

const boardKey = (fen: string): string => fen.split(' ').slice(0, 2).join(' ')

/** Boards this student has already seen served, so a fresh ask never repeats. */
export async function servedBoardsFor(profileId: string): Promise<Set<string>> {
  const rows = await db.coachArtifact.findMany({
    where: { profileId, kind: { in: ['puzzle', 'drill'] } },
    select: { fen: true },
    orderBy: { createdAt: 'desc' },
    take: 150,
  })
  const set = new Set<string>()
  for (const r of rows) {
    if (typeof r.fen === 'string' && r.fen) set.add(boardKey(r.fen))
  }
  return set
}

export interface BankPickOpts {
  /** Target rating band (the student's level rating). */
  rating: number
  /** A ChessX concept the puzzle should carry, when one was requested. */
  theme?: string | null
  requireMate?: boolean
  endgameOnly?: boolean
  /** Boards to skip (already served). */
  exclude?: Set<string>
  /** Explicit root FENs to skip (e.g. the puzzle being replaced). */
  excludeFen?: string | null
}

const solutionPlies = (p: MasterPuzzle): number => p.solution.trim().split(/\s+/).filter(Boolean).length

/**
 * Nearest-to-band picks with a little shuffle for variety. Never null when
 * the bank holds anything remotely fitting; width grows until one exists.
 * Within a fitting pool, deeper lines are preferred: a mate-in-2+ beats a
 * bare mate-in-1 and a four-ply conversion beats a three-ply poke, so the
 * "puzzle stops so fast" complaint never comes from the bank itself.
 */
export function pickMasterPuzzle(opts: BankPickOpts): MasterPuzzle | null {
  const exclude = opts.exclude ?? new Set<string>()
  if (opts.excludeFen) exclude.add(boardKey(opts.excludeFen))
  const fits = (p: MasterPuzzle): boolean => {
    if (opts.requireMate && !p.mateEnd) return false
    if (opts.endgameOnly && !p.themes.includes('endgame')) return false
    if (opts.theme && !p.themes.includes(opts.theme)) return false
    return true
  }
  // widen the rating window until something fits; the bank is verified so a
  // slightly off-band real puzzle always beats a synthetic fallback
  for (const width of [200, 400, 800, 2000]) {
    const pool = MASTER_PUZZLES.filter(
      (p) => fits(p) && !exclude.has(boardKey(p.fen)) && Math.abs(p.rating - opts.rating) <= width,
    )
    if (!pool.length) continue
    // Deep lines first (>= 4 plies: at least two solver moves), then rating
    // distance, then a shuffle inside the top band for variety.
    const deep = pool.filter((p) => solutionPlies(p) >= 4)
    const ordered = (deep.length ? deep : pool)
      .sort((a, b) => Math.abs(a.rating - opts.rating) - Math.abs(b.rating - opts.rating))
      .slice(0, Math.min(6, deep.length ? deep.length : pool.length))
    return ordered[Math.floor(Math.random() * ordered.length)]
  }
  // last resort: anything unused
  const rest = MASTER_PUZZLES.filter((p) => fits(p) && !exclude.has(boardKey(p.fen)))
  if (!rest.length) return null
  return rest[Math.floor(Math.random() * rest.length)]
}

/** How many bank tries a serve loop should make before giving up on a
 * criterion (e.g. a line that will not extend to mate). */
export const BANK_TRIES = 3

/** The bank line as a CraftedLine-shaped object for the shared copy writer. */
export function bankToCrafted(p: MasterPuzzle): {
  fen: string
  solution: string[]
  mateIn: number | null
  winning: boolean
} {
  const solution = p.solution.trim().split(/\s+/).filter(Boolean)
  return {
    fen: p.fen,
    solution,
    mateIn: p.mateEnd ? Math.ceil(solution.length / 2) : null,
    winning: true,
  }
}
