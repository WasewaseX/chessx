// Glicko-1, the rating system chess.com uses. Implemented to spec from
// Glickman's paper (www.glicko.net/glicko/glicko.pdf) so numbers move the
// same way they do on chess.com:
//   - new accounts start at 1000 with RD 350 (provisional)
//   - few games or high RD means huge swings, established means small
//   - playing opponents with high RD moves you less (g() shrinks their weight)
//   - RD shrinks toward a floor of 30 with every game
//   - inactivity inflates RD back toward 350 (~100 idle days from RD 50)
// Bot games are never rated, bots only carry an "estimated" Elo badge.

export const GLICKO_Q = 0.0057565
export const START_RATING = 1000
export const START_RD = 350
export const RD_FLOOR = 30
export const RD_MAX = 350
export const RATING_FLOOR = 100

// c so that RD 50 reaches 350 after 100 idle days: sqrt((350^2 - 50^2)/100)
export const RD_INACTIVITY_C = 34.65

export function gFactor(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * GLICKO_Q * GLICKO_Q * rd * rd) / (Math.PI * Math.PI))
}

export function expectedScore(rating: number, opponentRating: number, opponentRd: number): number {
  const g = gFactor(opponentRd)
  return 1 / (1 + Math.pow(10, (-g * (rating - opponentRating)) / 400))
}

export interface GlickoPlayer {
  rating: number
  rd: number
  score: number // 1 win, 0.5 draw, 0 loss
}

export interface GlickoResult {
  rating: number
  rd: number
  delta: number // rating change, rounded for display
}

/**
 * Apply one rated game. The player and every opponent they faced in this
 * rating period go in; out comes the new rating and RD. Matches Glickman's
 * worked example (1500/200, three games) to a fraction of a point.
 */
export function applyGame(player: { rating: number; rd: number }, opponents: GlickoPlayer[]): GlickoResult {
  if (opponents.length === 0) {
    return { rating: player.rating, rd: Math.max(RD_FLOOR, player.rd), delta: 0 }
  }

  let invD = 0 // 1/d^2 from the paper
  let sum = 0
  for (const opp of opponents) {
    const g = gFactor(opp.rd)
    const e = expectedScore(player.rating, opp.rating, opp.rd)
    invD += GLICKO_Q * GLICKO_Q * g * g * e * (1 - e)
    sum += g * (opp.score - e)
  }
  const denom = 1 / (player.rd * player.rd) + invD
  const newRating = player.rating + (GLICKO_Q / denom) * sum
  const newRd = Math.sqrt(1 / denom)

  const clamped = Math.max(RATING_FLOOR, newRating)
  return {
    rating: clamped,
    rd: Math.max(RD_FLOOR, Math.min(RD_MAX, newRd)),
    delta: Math.round(clamped - player.rating),
  }
}

/** RD inflation after `idleDays` without a rated game. */
export function inflateRd(rd: number, idleDays: number): number {
  if (idleDays <= 0) return Math.min(RD_MAX, rd)
  const grown = Math.sqrt(rd * rd + RD_INACTIVITY_C * RD_INACTIVITY_C * idleDays)
  return Math.min(RD_MAX, grown)
}

/** chess.com hides a rating behind a provisional marker while it settles. */
export function isProvisional(games: number, rd: number): boolean {
  return games < 5 || rd > 110
}

export type TimePool = 'bullet' | 'blitz' | 'rapid'

export function poolForTimeControl(initialSec: number, incSec: number): TimePool {
  const estimated = initialSec + incSec * 40
  if (estimated < 179) return 'bullet'
  if (estimated < 479) return 'blitz'
  return 'rapid'
}

export function poolLabel(pool: TimePool): string {
  return pool.charAt(0).toUpperCase() + pool.slice(1)
}
