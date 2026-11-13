// The blunder scan: one exact definition of "does this move lose material or
// get mated right now", shared by the Blunder Training drills and the content
// validator so the drills grade exactly the way the content was checked.
//
// The scan is the pre-move blunder check from the coaching doctrine,
// formalized: after the candidate move, look at the opponent's single best
// reply and compare material against the position before the move.
//
//   damage(fen, san) = balance(before) - min over replies of balance(after)
//
// where the replies include mate-in-one (scored catastrophic) and every
// capture. Depth-two exchanges are covered because the reply itself is a
// capture: queen-for-pawn-then-recapture, quiet hangs and even trades all
// come out exact. Anything at damage >= 2 (a piece for a pawn or worse) is
// a blunder; hanging a lone pawn is annoying, not a blunder.
import { Chess } from 'chess.js'

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 20 }

/** Material balance from White's point of view (kings excluded). */
export function materialBalance(fen: string): number {
  let bal = 0
  let g: Chess
  try {
    g = new Chess(fen)
  } catch {
    return 0
  }
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue
      bal += sq.color === 'w' ? PIECE_VALUE[sq.type] : -PIECE_VALUE[sq.type]
    }
  }
  return bal
}

const SAFE_FEN = (fen: string): Chess | null => {
  try {
    return new Chess(fen)
  } catch {
    return null
  }
}

const playSafe = (g: Chess, san: string): boolean => {
  try {
    g.move(san)
    return true
  } catch {
    return false
  }
}

/**
 * How much material (in pawn units) the candidate move throws away to the
 * opponent's single best reply, compared with standing pat. 0 when the move
 * is safe, 10000 when the opponent gets mate in one. The candidate is
 * expected to be legal; illegal input counts as no damage (callers check
 * legality themselves first).
 */
export function blunderDamage(fen: string, san: string): number {
  const before = SAFE_FEN(fen)
  if (!before) return 0
  const baseBal = materialBalance(fen)
  const moverSign = before.turn() === 'w' ? 1 : -1
  const g = SAFE_FEN(fen)
  if (!g || !playSafe(g, san)) return 0
  // the candidate ended the game: nothing can hurt anymore
  if (g.isCheckmate() || g.isGameOver()) return 0
  // opponent mates in one: catastrophic
  for (const reply of g.moves()) {
    const probe = SAFE_FEN(g.fen())
    if (!probe || !playSafe(probe, reply)) continue
    if (probe.isCheckmate()) return 10000
  }
  // the opponent minimizes the mover's balance with one reply
  let minBal = Number.POSITIVE_INFINITY
  for (const reply of g.moves({ verbose: true })) {
    const probe = SAFE_FEN(g.fen())
    if (!probe || !playSafe(probe, reply.san)) continue
    minBal = Math.min(minBal, materialBalance(probe.fen()))
  }
  if (!Number.isFinite(minBal)) return 0
  // convert the White-POV drop into the mover's own loss
  return Math.max(0, moverSign * (baseBal - minBal))
}

/** The two-second blunder check: true when the move survives the immediate scan. */
export function isSafeMove(fen: string, san: string): boolean {
  return blunderDamage(fen, san) < 2
}

/** The opponent's most damaging immediate answer after `san`, as SAN (null when nothing hurts). */
export function punishMove(fen: string, san: string): string | null {
  const g = SAFE_FEN(fen)
  if (!g || !playSafe(g, san)) return null
  const baseBal = materialBalance(fen)
  // after the candidate it is the opponent's turn, so the mover's own sign is flipped
  const moverSign = g.turn() === 'w' ? -1 : 1
  let worst: string | null = null
  let worstHarm = 0
  for (const reply of g.moves({ verbose: true })) {
    const probe = SAFE_FEN(g.fen())
    if (!probe || !playSafe(probe, reply.san)) continue
    if (probe.isCheckmate()) return reply.san
    const harm = moverSign * (baseBal - materialBalance(probe.fen()))
    if (harm > worstHarm) {
      worstHarm = harm
      worst = reply.san
    }
  }
  return worstHarm >= 2 ? worst : null
}

/**
 * A "shot": the move either mates or nets a minor piece or more of material
 * on the spot (value after the move minus value before, from the mover's
 * side). Used to grade Threat Scan rounds — the user must find the one
 * threat the position holds, so the curated positions guarantee uniqueness.
 */
export function isWinningShot(fen: string, san: string): boolean {
  const g = SAFE_FEN(fen)
  if (!g || !playSafe(g, san)) return false
  if (g.isCheckmate()) return true
  const baseBal = materialBalance(fen)
  const sign = new Chess(fen).turn() === 'w' ? 1 : -1
  return (materialBalance(g.fen()) - baseBal) * sign >= 3
}
