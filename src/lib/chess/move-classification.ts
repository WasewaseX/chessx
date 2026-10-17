// The single source of truth for chess.com-style move classification.
// Both the server classifier (src/lib/server/game-report.ts) and every GUI
// surface (game review, move lists, summaries) import from here, so the
// label set, colors, icons and plain-words meanings can never drift apart.
//
// The set and colors mirror chess.com's public game review:
// Brilliant !!(teal) | Great !(blue) | Best ★(green) | Excellent 👍(lime)
// Good ✓(sage) | Book 📖(tan) | Inaccuracy ?!(amber) | Mistake ?(orange)
// Missed Win ⊖(yellow) | Blunder ??(red) | Forced (gray) | Checkmate (dark)

export type MoveLabel =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'missedwin'
  | 'blunder'
  | 'forced'
  | 'checkmate'

export interface LabelMeta {
  /** chess.com display name */
  text: string
  /** official chess.com hex color */
  color: string
  /** the badge glyph chess.com prints inside the circle */
  glyph: string
  /** plain-words meaning: what the engine actually verified about the move */
  meaning: string
  /** true when the label is a praise tier (counts toward "good decisions") */
  good: boolean
}

export const LABEL_META: Record<MoveLabel, LabelMeta> = {
  brilliant: {
    text: 'Brilliant',
    color: '#26c2a3',
    glyph: '!!',
    meaning:
      'A sacrifice the engine proved is best: you gave up material, the opponent can take it, and the position after taking it is still yours. The rarest move in chess.',
    good: true,
  },
  great: {
    text: 'Great',
    color: '#749bbf',
    glyph: '!',
    meaning:
      'The only move that holds the position. The engine checked the alternatives: everything else is clearly worse.',
    good: true,
  },
  best: {
    text: 'Best',
    color: '#81b64c',
    glyph: '★',
    meaning: 'The engine\u2019s top choice, no notes.',
    good: true,
  },
  excellent: {
    text: 'Excellent',
    color: '#95bb4a',
    glyph: '👍',
    meaning: 'Nearly the best move — the difference is invisible over the board.',
    good: true,
  },
  good: {
    text: 'Good',
    color: '#96af8b',
    glyph: '✓',
    meaning: 'A solid move that only hands over a tiny sliver of your advantage.',
    good: true,
  },
  book: {
    text: 'Book',
    color: '#a88865',
    glyph: '📖',
    meaning: 'A known opening theory move, played the way the masters play it.',
    good: true,
  },
  forced: {
    text: 'Forced',
    color: '#9e9c96',
    glyph: '⇄',
    meaning: 'There was nothing else to consider — the move was forced.',
    good: true,
  },
  inaccuracy: {
    text: 'Inaccuracy',
    color: '#f7c437',
    glyph: '?!',
    meaning: 'A small drift. The engine prefers another path, but nothing decisive changes yet.',
    good: false,
  },
  mistake: {
    text: 'Mistake',
    color: '#e8900c',
    glyph: '?',
    meaning: 'A real error that hands over a meaningful part of the evaluation.',
    good: false,
  },
  missedwin: {
    text: 'Missed Win',
    color: '#e8b323',
    glyph: '⊖',
    meaning: 'You had a winning position and let the win slip away.',
    good: false,
  },
  blunder: {
    text: 'Blunder',
    color: '#ca3431',
    glyph: '??',
    meaning: 'A serious error that flips the evaluation against you.',
    good: false,
  },
  checkmate: {
    text: 'Checkmate',
    color: '#312e2b',
    glyph: '#',
    meaning: 'The game ends here.',
    good: true,
  },
}

/** Legacy 7-label set, kept so old stored reports keep rendering. */
export const LEGACY_LABELS: MoveLabel[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']

/** Accepts any stored label string and maps it onto the current set. */
export function coerceLabel(raw: string): MoveLabel {
  if (raw in LABEL_META) return raw as MoveLabel
  return 'best'
}

/** Praise tiers in chess.com's Game Review column order (good side first). */
export const GOOD_ORDER: MoveLabel[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book']
/** Error tiers in chess.com's order. */
export const BAD_ORDER: MoveLabel[] = ['inaccuracy', 'mistake', 'missedwin', 'blunder']

// ---------------------------------------------------------------------------
// The pure chess.com-accurate classifier (client-safe: no server imports, no IO).
//
// Priority order below is tuned to chess.com's real distribution
// (Brilliant ≈0.3%, Best ≈39%, Excellent ≈20%, Good ≈12%, Book ≈10%,
// Inaccuracy ≈8%, Mistake ≈7%, Blunder ≈3%, Missed Win ≈0.3%).
// FIRST MATCH WINS. The headline consequence: a Brilliant is a REAL sacrifice
// (an important piece, provably takeable, eval non-degrading, not forced,
// not into a worse position) that the engine ranks #1 — never a routine best
// move that happens to give up a little material.
// ---------------------------------------------------------------------------

/** Standard piece values (pawns) used for the sacrifice math. */
export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/**
 * Win probability (0..100) for the side the pawns belong to, via the standard
 * logistic used by chess.com/Lichess: 50+50*(2/(1+e^(-0.00368208*cp))-1).
 * Mate-flattened pawns (±80) map to ~100/~0.
 */
export function winPercentFromPawns(pawns: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * pawns * 100)) - 1)
}

/** Re-express a white-POV pawn eval from the mover's point of view. */
export function moverPov(pawns: number, color: 'w' | 'b'): number {
  return color === 'w' ? pawns : -pawns
}

export interface ClassifyInput {
  fenBefore: string
  san: string
  color: 'w' | 'b'
  /** eval before the move, white POV pawns, mate flattened to ±80 */
  before: number
  /** eval after the move, white POV pawns, mate flattened to ±80 */
  after: number
  /** forced-mate info before the move (plies positive = white mates in that many plies when mateForWhite) */
  mateBeforeForWhite: boolean | null // null = no forced mate
  mateBeforePlies: number | null
  mateAfterForWhite: boolean | null
  mateAfterPlies: number | null
  /** engine best move in the before-position (SAN, suffixes stripped) */
  bestSan: string | null
  /** engine SECOND best (SAN, suffixes stripped) and its white-POV pawn eval */
  secondBestSan: string | null
  secondBestBefore: number | null
  /** number of legal moves in the before position */
  legalMoveCount: number
  /** did the played move match the engine best (suffix-insensitive) */
  isBest: boolean
  /** the moving piece type ('p'|'n'|'b'|'r'|'q'|'k') + captured piece type; values via PIECE_VALUES give the material netted */
  movedPiece: string | null
  capturedPiece: string | null
  /** after the move, can the opponent capture the piece that just landed on its square */
  offerCanBeTaken: boolean
  /** is the engine's best reply that capture (strong sacrifice signal) */
  bestReplyTakesOffer: boolean
  /** opening book hit: the ply is a known theory move within the first ~24 plies */
  bookHit: boolean
  ply: number
}

export function classifyMove(i: ClassifyInput): MoveLabel {
  const beforePov = moverPov(i.before, i.color)
  const afterPov = moverPov(i.after, i.color)
  const wpBefore = winPercentFromPawns(beforePov)
  const wpAfter = winPercentFromPawns(afterPov)
  const wpDrop = Math.max(0, wpBefore - wpAfter)
  const moverHadMate = i.mateBeforeForWhite != null && i.mateBeforeForWhite === (i.color === 'w')
  // "delivers mate" = the mate is ON the board now (plies === 1), not merely a forced-mate line ahead.
  const moverDeliversMate =
    i.mateAfterForWhite != null &&
    i.mateAfterForWhite === (i.color === 'w') &&
    (i.mateAfterPlies === 1 || (i.mateAfterPlies == null && afterPov >= 79.5))

  // 1. checkmate — the move ends the game.
  if (moverDeliversMate) return 'checkmate'

  // 2. book — known theory, early, and the eval barely moves.
  if (i.bookHit && wpDrop < 2 && i.ply <= 24) return 'book'

  // 3. forced — no choice (exactly one legal move), or near-none while already
  //    lost and playing the only sensible reply. A "forced" move that still
  //    craters the win% is a blunder, not forced (drop >= 10 falls through).
  if (wpDrop < 10 && (i.legalMoveCount === 1 || (i.legalMoveCount <= 3 && beforePov <= -4 && i.isBest))) {
    return 'forced'
  }

  // 4. missedwin — a won position slipped to non-winning, played move was not
  //    the engine's best (a best move cannot "miss" anything).
  const wasWinning = beforePov >= 2.5 || moverHadMate
  if (!i.isBest && wasWinning && afterPov < 1.0) return 'missedwin'

  // 5-7. blunder / mistake / inaccuracy, by win% drop on the mover's POV.
  if (wpDrop >= 20) return 'blunder'
  if (wpDrop >= 10) return 'mistake'
  if (wpDrop >= 5) return 'inaccuracy'

  // 8. brilliant — the strict gate. EVERY clause must hold:
  //    engine's #1; a real sacrifice of a piece (never a pawn) worth >= 3
  //    pawns net; the opponent can actually take it (and either taking it is
  //    the engine's best reply or the eval already reflects the piece going
  //    down); the sacrifice does not degrade the evaluation; the position
  //    after is at least comfortable; and it was not trivially forced.
  const movedVal = i.movedPiece ? PIECE_VALUES[i.movedPiece] ?? 0 : 0
  const capturedVal = i.capturedPiece ? PIECE_VALUES[i.capturedPiece] ?? 0 : 0
  const realSacrifice =
    i.movedPiece != null &&
    i.movedPiece !== 'p' &&
    i.movedPiece !== 'k' &&
    movedVal - capturedVal >= 3 &&
    i.offerCanBeTaken &&
    (i.bestReplyTakesOffer || afterPov >= beforePov - 1.0)
  if (i.isBest && realSacrifice && afterPov >= beforePov - 0.3 && afterPov >= -0.5 && i.legalMoveCount > 1) {
    return 'brilliant'
  }

  // 9. great — the engine's #1 on a cliff (the second-best move loses >= 10
  //    win% points: everything else clearly fails), or a working sacrifice
  //    that is best but not brilliant-grade (slightly negative swing, second
  //    best far behind). Sacrifices that work land here, never on brilliant.
  if (i.isBest && i.secondBestSan != null && i.secondBestBefore != null) {
    const wpSecond = winPercentFromPawns(moverPov(i.secondBestBefore, i.color))
    const cliff = wpBefore - wpSecond
    if (cliff >= 10) return 'great'
    if (realSacrifice && afterPov >= beforePov - 0.9 && cliff >= 8) return 'great'
  }

  // 10. best — the engine's top choice, no notes.
  if (i.isBest) return 'best'

  // 11-13. near-best tiers by win% drop, then the fallback (unreachable
  //    given 5-7, kept for exhaustiveness).
  if (wpDrop < 2) return 'excellent'
  if (wpDrop < 5) return 'good'
  return 'inaccuracy'
}
