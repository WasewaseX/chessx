/**
 * Arena move badges — the chessreps deep-dive P5 port (docs/chessreps-arena-deep-dive.md).
 *
 * Their arena shows a chess.com-style quality badge on every student move:
 * inside the booked repertoire line every move is simply "book"; once the
 * game leaves the line, each student move is classified by the engine and
 * the opponent's reply is HELD until the badge is ready (their
 * annotation_hold_ms = 1500).
 *
 * This is the honest client-side version of that pipeline: two Stockfish
 * evals (before/after, the same win%-drop ladder) fed into the app's one
 * classification source of truth (classifyMove), with the second-best
 * probes left out (great/brilliant degrade gracefully instead of guessing).
 */

import { Chess } from 'chess.js'
import { engine } from '@/lib/chess/engine-client'
import {
  classifyMove, PIECE_VALUES, moverPov, winPercentFromPawns,
  type MoveLabel,
} from '@/lib/chess/move-classification'

export interface BadgeInput {
  fenBefore: string
  san: string
  color: 'w' | 'b'
  ply: number
}

export interface BadgeResult {
  label: MoveLabel
  bestSan: string | null
  wpDrop: number
}

const BADGE_DEPTH = 14

/** Flatten a mate score to the ±80-pawn convention the classifier expects. */
function pawnsFromInfo(cpWhitePov: number, mateForWhite: boolean | null): number {
  if (mateForWhite != null) return mateForWhite ? 80 : -80
  return Math.max(-80, Math.min(80, cpWhitePov / 100))
}

export async function classifyStudentMove(input: BadgeInput): Promise<BadgeResult | null> {
  const { fenBefore, san, color, ply } = input
  try {
    const beforeGame = new Chess(fenBefore)
    const legalMoveCount = beforeGame.moves().length
    const probe = new Chess(fenBefore)

    // Engine on the before-position: best line (single PV — the client
    // engine is one worker; the great/brilliant probes are skipped).
    const turn = beforeGame.turn() as 'w' | 'b'
    const beforeInfo = await engine.eval({ fen: fenBefore, depth: BADGE_DEPTH })
    const beforeMateForWhite = beforeInfo.mate != null ? (turn === 'w' ? beforeInfo.mate > 0 : beforeInfo.mate < 0) : null
    const beforePawns = pawnsFromInfo(
      turn === 'w' ? (beforeInfo.scoreCp ?? 0) : -(beforeInfo.scoreCp ?? 0),
      beforeMateForWhite,
    )
    const bestUci = beforeInfo.pv[0] ?? null
    let bestSan: string | null = null
    if (bestUci) {
      try {
        bestSan = beforeGame.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4, 5) || undefined })?.san ?? null
      } catch {
        bestSan = null
      }
    }
    const strip = (s: string) => s.replace(/[+#]/g, '')
    const isBest = bestSan != null && strip(bestSan) === strip(san)

    // Land the played move.
    let mv: ReturnType<Chess['move']>
    try {
      mv = probe.move(san)
    } catch {
      return null
    }
    if (!mv) return null

    // After-position eval (or the mate / terminal conventions).
    let afterPawns: number
    let mateAfterForWhite: boolean | null = null
    let mateAfterPlies: number | null = null
    let afterPvFirst: string | null = null
    if (probe.isCheckmate()) {
      afterPawns = probe.turn() === 'w' ? -80 : 80
      mateAfterForWhite = probe.turn() === 'b'
      mateAfterPlies = 1
    } else if (probe.isGameOver()) {
      afterPawns = 0
    } else {
    const afterTurn = probe.turn() as 'w' | 'b'
      const afterInfo = await engine.eval({ fen: probe.fen(), depth: BADGE_DEPTH })
      const afterMateForWhite = afterInfo.mate != null ? (afterTurn === 'w' ? afterInfo.mate > 0 : afterInfo.mate < 0) : null
      afterPawns = pawnsFromInfo(
        afterTurn === 'w' ? (afterInfo.scoreCp ?? 0) : -(afterInfo.scoreCp ?? 0),
        afterMateForWhite,
      )
      mateAfterForWhite = afterMateForWhite
      mateAfterPlies = afterInfo.mate != null ? Math.abs(afterInfo.mate) : null
      afterPvFirst = afterInfo.pv[0] ?? null
    }

    // Local sacrifice probes (cheap, chess.js only).
    const canBeTaken = probe.moves({ verbose: true }).some((m) => m.to === mv.to && /[ce]/.test(m.flags))
    let bestReplyTakesOffer = false
    if (canBeTaken && afterPvFirst) {
      try {
        const g2 = new Chess(probe.fen())
        const rm = g2.move({ from: afterPvFirst.slice(0, 2), to: afterPvFirst.slice(2, 4), promotion: afterPvFirst.slice(4, 5) || undefined })
        bestReplyTakesOffer = Boolean(rm?.captured) && rm?.to === mv.to
      } catch {
        bestReplyTakesOffer = false
      }
    }

    const label = classifyMove({
      fenBefore,
      san,
      color,
      before: beforePawns,
      after: afterPawns,
      mateBeforeForWhite: null, // single-PV: mate-before detection is skipped honestly
      mateBeforePlies: null,
      mateAfterForWhite,
      mateAfterPlies,
      bestSan,
      secondBestSan: null,
      secondBestBefore: null,
      legalMoveCount,
      isBest,
      movedPiece: mv.piece,
      capturedPiece: mv.captured ?? null,
      offerCanBeTaken: canBeTaken,
      bestReplyTakesOffer,
      bookHit: false, // arena book moves are force-labeled before this runs
      ply,
    })

    const wpBefore = winPercentFromPawns(moverPov(beforePawns, color))
    const wpAfter = winPercentFromPawns(moverPov(afterPawns, color))
    return { label, bestSan, wpDrop: Math.max(0, wpBefore - wpAfter) }
  } catch {
    return null
  }
}

/** Material netted by a played move (used by the badge tooltip line). */
export function materialNet(movedPiece: string | null, capturedPiece: string | null): number {
  if (!movedPiece) return 0
  return (PIECE_VALUES[movedPiece] ?? 0) - (PIECE_VALUES[capturedPiece ?? ''] ?? 0)
}
