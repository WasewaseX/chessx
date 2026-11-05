// Shared move-quality math — the single source of truth used by BOTH the
// server review brain and the client UI. Ported from En Croissant's
// `src/utils/score.ts` (GPL-3.0, reverse-engineered at source level; see
// research/en-croissant and the worklog).
//
// Key ideas copied from En Croissant:
//  - Move quality is measured in WIN PERCENTAGE drop, not raw centipawns.
//    Win% behaves sensibly across opening/middlegame/endgame, and a forced
//    mate is just cp = ±1000 after clamping.
//  - Per-move accuracy uses the Lichess logistic formula, and the game
//    accuracy is the HARMONIC MEAN of per-move accuracies — one terrible
//    move hurts the game score far more than the arithmetic mean would.
// This file must stay dependency-free and free of `server-only` so both
// runtimes can import it.

/** Logistic win probability for the side the centipawns belong to (0..100). */
export function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** En Croissant per-move accuracy: Lichess formula, clamped to 0..100. */
export function perMoveAccuracy(wpBefore: number, wpAfter: number): number {
  const drop = Math.max(0, wpBefore - wpAfter)
  const a = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669 + 1
  return Math.max(0, Math.min(100, a))
}

/** Harmonic mean (En Croissant `misc.ts`); punishes single awful moves. */
export function harmonicMean(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, v) => acc + 1 / Math.max(1, v), 0)
  return values.length / sum
}

/** White-POV pawns (mate flattened to ±80) → win% for white. */
export function winPercentWhite(pawnsWhitePov: number): number {
  const cp = Math.max(-1000, Math.min(1000, pawnsWhitePov * 100))
  return winPercent(cp)
}

/**
 * Win%-drop thresholds, En Croissant `getAnnotation`:
 *   >20 → blunder, >10 → mistake, >5 → inaccuracy, otherwise fine.
 * Returns null when the move holds up.
 */
export function labelFromWpDrop(dropWp: number): 'blunder' | 'mistake' | 'inaccuracy' | null {
  if (dropWp > 20) return 'blunder'
  if (dropWp > 10) return 'mistake'
  if (dropWp > 5) return 'inaccuracy'
  return null
}

/** Human label used across the review UI (subset kept for colors/dots). */
export type QualityLabel = 'inaccuracy' | 'mistake' | 'blunder'
