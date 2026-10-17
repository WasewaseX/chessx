// The shared game-review contract. The server report (game-report.ts,
// /api/analysis/evals) and the review GUI (analysis-view.tsx) both import
// from here, so shapes and computation can never drift apart — the same rule
// that move-classification.ts applies to labels.
//
// Everything here is pure: no IO, no server-only imports, safe on the client.
import type { MoveLabel } from './move-classification'
import { moverPov, winPercentFromPawns } from './move-classification'

/** One evaluated half-move, exactly as the server returns it and the GUI renders it. */
export interface PlyEvalDTO {
  san: string
  color: 'w' | 'b'
  /** eval before the move, white POV pawns, mate flattened to ±80 */
  before: number
  /** eval after the move, white POV pawns */
  after: number
  bestUci: string | null
  bestSan: string | null
  label: MoveLabel
  /** plain-English reason for the moves that need one (coach voice) */
  reason?: string
  /**
   * centipawn loss against the engine's best, from the mover's point of view.
   * 0 for the engine's top choice; grows with every inferior alternative.
   */
  cpl?: number
  /**
   * seconds spent on this move, parsed from PGN %clk comments. Absent/null
   * when the game carries no clock data — the clock area then stays hidden.
   */
  timeSpentSec?: number | null
}

/** Where the player left opening theory. */
export interface TheoryInfo {
  /** human opening name, empty string when nothing matched */
  openingName: string
  /** consecutive known-theory plies counted from move 1 */
  theoryPlies: number
  /** SAN of the first out-of-theory move (null when the whole game is book) */
  firstDeviationSan: string | null
}

/** A highlighted moment the report points at ("your best move", "the worst moment"). */
export interface Callout {
  ply: number // 1-based half-move index into the plies array
  san: string
  color: 'w' | 'b'
  label: MoveLabel
  /** one short headline, coach tone: "This allows a forced mate in 1." */
  headline: string
  /** one supporting sentence: what to do instead / what made it good. */
  detail: string
}

/** The clock area: only present when the PGN actually carries %clk data. */
export interface ClockArea {
  trouble: boolean
  /** average seconds per move across the game (null when unknown) */
  avgSec: number | null
  /** moves played in hard time trouble (< 10s on the clock) */
  flags: Callout[]
}

/** Chessigma-style five-area breakdown of one game. */
export interface ReviewAreas {
  blunders: Callout[]
  /** working tactics the player found AND tactics that were missed */
  tactics: Callout[]
  /** null when the PGN has no clock comments */
  clock: ClockArea | null
  /** wins that slipped or were nearly slipped: conversion quality */
  conversion: Callout[]
  openings: TheoryInfo
}

export interface ReviewReport {
  plies: PlyEvalDTO[]
  accuracyWhite: number
  accuracyBlack: number
  bestMove: Callout | null
  worstMove: Callout | null
  areas: ReviewAreas
}

// ---------------------------------------------------------------------------
// Pure computation helpers — used by BOTH the server report builder and the
// client-side fallback path, so a local review and a deep review agree.
// ---------------------------------------------------------------------------

/**
 * Centipawn loss for one ply, from the mover's POV (0 when eval improved).
 *
 * Two honesty guards keep shallow-depth artifacts from destroying the
 * average (a depth-10 search can misjudge a queen sac by an entire mate
 * score, and mate itself is flattened to a huge sentinel):
 * - plies at the mate ceiling (|eval| ≥ 70 pawns; no real search eval gets
 *   near that without being "mate in N") are DECIDED BY FORCE — the mover
 *   neither gains nor loses accuracy credit there;
 * - a single move can never cost more than 1000cp (a 10-pawn swing), the
 *   same per-move ceiling chess.com's win% model applies.
 */
export function cplOf(before: number, after: number, color: 'w' | 'b'): number {
  const MATE_CEILING = 70
  if (Math.abs(before) >= MATE_CEILING || Math.abs(after) >= MATE_CEILING) return 0
  const lossPawns = Math.max(0, moverPov(before, color) - moverPov(after, color))
  return Math.min(1000, Math.round(lossPawns * 100))
}

/**
 * Chess.com-style accuracy for a list of plies (one side's colors only).
 * The 103.1668/exp model operates on WIN-PERCENT loss, not raw centipawns —
 * feeding centipawns straight in makes the curve 10x too steep (every real
 * game collapses to the 10% floor). Each move's CPL is therefore mapped
 * through the same logistic win% curve the rest of the app uses, then the
 * average win% loss feeds the published formula:
 * 0 loss -> 100%, 100 CPL (~15% win lost) -> ~51%, 300 CPL -> ~20%.
 */
export function accuracyOfCpl(cpls: number[]): number {
  if (cpls.length === 0) return 100
  const winLoss = cpls.map((c) => Math.max(0, winPercentFromPawns(0) - winPercentFromPawns(-Math.min(2000, c) / 100)))
  const avg = winLoss.reduce((a, b) => a + b, 0) / winLoss.length
  const pct = 103.1668 * Math.exp(-0.04354 * avg) - 3.1669
  return Math.max(10, Math.min(100, Math.round(pct * 10) / 10))
}

const WIN_P = 62 // win% that counts as "winning" for conversion tracking
const LOSE_P = 38

/** Build the five areas from evaluated plies. `clockSecs` aligns 1:1 with plies or is null. */
export function computeReviewAreas(
  plies: PlyEvalDTO[],
  opening: TheoryInfo,
  clockSecs: (number | null)[] | null,
): ReviewAreas {
  const blunders: Callout[] = []
  const tactics: Callout[] = []
  const conversion: Callout[] = []
  const clockFlags: Callout[] = []

  plies.forEach((e, i) => {
    const wpBefore = winPercentFromPawns(moverPov(e.before, e.color))
    const wpAfter = winPercentFromPawns(moverPov(e.after, e.color))
    const base = { ply: i + 1, san: e.san, color: e.color, label: e.label }

    if (e.label === 'blunder') {
      blunders.push({
        ...base,
        headline: e.reason ? firstSentence(e.reason) : `${moveName(e)} threw away ${Math.round(wpBefore - wpAfter)}% winning chances.`,
        detail: e.bestSan ? `The engine preferred ${e.bestSan}.` : 'Scan every check, capture and threat before committing.',
      })
    }
    // tactics: found = the played move WAS a working sacrifice/mate; missed = a tactic existed and was not played
    if (e.label === 'brilliant' || (e.label === 'best' && (e.san.includes('#') || e.san.includes('+'))) ) {
      tactics.push({
        ...base,
        headline: `${moveName(e)} worked — ${e.san.includes('#') ? 'mate delivered' : 'the forcing sequence lands'}.`,
        detail: e.reason ? firstSentence(e.reason) : 'Calculating forcing moves first is what finds these.',
      })
    } else if (e.label === 'missedwin' && e.bestSan) {
      tactics.push({
        ...base,
        headline: `A win was on the board and slipped away.`,
        detail: `${e.bestSan} was the way in. When you smell blood, look for checks first.`,
      })
    }
    // conversion: had a winning position and let it decay (not all the way to blunder)
    if (wpBefore >= WIN_P && wpAfter < wpBefore - 8 && e.label !== 'blunder' && e.label !== 'checkmate') {
      conversion.push({
        ...base,
        headline: `A winning position got looser (${Math.round(wpBefore)}% → ${Math.round(wpAfter)}%).`,
        detail: e.bestSan ? `${e.bestSan} keeps the clamp on.` : 'Trade when ahead; simplify into a won endgame.',
      })
    }
    // clock trouble: under 10s left when moving
    const spent = clockSecs ? clockSecs[i] : null
    if (spent != null && spent < 10) {
      clockFlags.push({
        ...base,
        headline: `Played in under 10 seconds.`,
        detail: 'Budget your clock: pre-move routine openings, think on the middlegame forks.',
      })
    }
  })

  let clock: ClockArea | null = null
  if (clockSecs && clockSecs.some((s) => s != null)) {
    const secs = clockSecs.filter((s): s is number => s != null)
    clock = {
      trouble: clockFlags.length > 0,
      avgSec: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
      flags: clockFlags.slice(0, 4),
    }
  }

  return { blunders, tactics, clock, conversion, openings: opening }
}

/** Pick the single best and the single worst move of the game. */
export function computeCallouts(plies: PlyEvalDTO[]): { bestMove: Callout | null; worstMove: Callout | null } {
  let bestMove: Callout | null = null
  let worstMove: Callout | null = null
  let bestScore = -1
  let worstScore = -1

  plies.forEach((e, i) => {
    const wpBefore = winPercentFromPawns(moverPov(e.before, e.color))
    const wpAfter = winPercentFromPawns(moverPov(e.after, e.color))
    const gain = wpAfter - wpBefore
    const drop = Math.max(0, wpBefore - wpAfter)
    const base = { ply: i + 1, san: e.san, color: e.color, label: e.label }
    const praise = e.label === 'brilliant' ? 25 : e.label === 'great' ? 15 : e.label === 'best' ? 4 : 0
    const score = gain + praise
    if (score > bestScore && (gain > 0 || e.label === 'brilliant' || e.label === 'great' || e.label === 'best')) {
      bestScore = score
      bestMove = {
        ...base,
        headline: `${moveName(e)} was your best moment.`,
        detail: e.reason ? firstSentence(e.reason) : e.bestSan ? 'The engine agreed instantly.' : 'Exactly the move the position wanted.',
      }
    }
    if (drop > worstScore) {
      worstScore = drop
      worstMove = {
        ...base,
        headline: `${moveName(e)} was the turning point.`,
        detail: e.bestSan ? `${e.bestSan} was the move to find.` : 'This is where the evaluation turned.',
      }
    }
  })

  // a trivial best (every move lost) is still honest to show; a game with no
  // drop at all (perfect play) shows no worst move.
  if (worstScore <= 0) worstMove = null
  return { bestMove, worstMove }
}

function moveName(e: { color: 'w' | 'b' }): string {
  return e.color === 'w' ? 'White' : 'Black'
}

function firstSentence(s: string): string {
  const m = s.match(/^(.+?[.!]) /)
  return m ? m[1] : s
}
