// Retro-audit for stored coach artifacts.
//
// The generation pipeline gained strict truth checks over time (piece-honest
// titles, mate claims verified by replay, the early-stop ban). Artifacts that
// were stored BEFORE those checks exist still sit in the database, and they
// are exactly the sloppy cards a student can paste as evidence: a title that
// names a piece no solver move touches, a "mate" headline over a line that
// does not mate, a two-move fragment that stops at the tactic, an illegal
// line, a quiz with no answerable question.
//
// This module is the delivery-side guarantee: an artifact that cannot survive
// a cold replay and a mechanical truth scan never reaches the student. The
// artifacts API audits every row it is about to serve and retires the stale
// ones on the spot, so the shelf self-heals the moment it is read.
import 'server-only'
import { Chess } from 'chess.js'
import type { ArtifactView } from '@/lib/coach-artifacts'

export interface AuditVerdict {
  ok: boolean
  /** Why the artifact was retired (student-safe, English, one line). */
  reason?: string
}

function replay(fen: string, sans: string[]): Chess | null {
  try {
    const g = new Chess(fen)
    for (const san of sans) {
      const mv = g.move(san)
      if (!mv) return null
    }
    return g
  } catch {
    return null
  }
}

/**
 * The solver's pieces in the verified line: pieces the solver moved (or
 * promoted to) plus pieces the solver captured. A title may honestly name
 * any of those; anything else is a fabricated headline.
 */
function solverPieces(fen: string, sans: string[]): Set<string> | null {
  const g = replay(fen, sans)
  if (!g) return null
  // Replay again from scratch, tracking ply parity (solver = even indexes).
  const probe = new Chess(fen)
  const letters = new Set<string>()
  for (let i = 0; i < sans.length; i++) {
    const mv = probe.move(sans[i])
    if (!mv) return null
    if (i % 2 === 0) {
      letters.add(mv.piece.toUpperCase())
      if (mv.promotion) letters.add(mv.promotion.toUpperCase())
      if (mv.captured) letters.add(mv.captured.toUpperCase())
    }
  }
  return letters
}

/** True when the line contains at least one genuine fork by a solver move. */
function lineHasFork(fen: string, sans: string[]): boolean {
  const probe = replay(fen, sans)
  if (!probe) return false
  const g = new Chess(fen)
  for (let i = 0; i < sans.length; i++) {
    const mv = g.move(sans[i])
    if (!mv) return false
    if (i % 2 !== 0) continue
    let targets = 0
    for (const row of ['1', '2', '3', '4', '5', '6', '7', '8'] as const) {
      for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
        const sq = `${file}${row}` as never
        const pc = g.get(sq)
        if (!pc || pc.color === mv.color || pc.type === 'p') continue
        if (g.attackers(sq, mv.color).includes(mv.to as never)) targets++
      }
    }
    if (targets >= 2) return true
  }
  return false
}

/** True when a solver move leaves a piece on a square the defender later captures. */
function lineHasSacrifice(fen: string, sans: string[]): boolean {
  const g = replay(fen, sans)
  if (!g) return false
  const probe = new Chess(fen)
  const solverDests = new Set<string>()
  for (let i = 0; i < sans.length; i++) {
    const mv = probe.move(sans[i])
    if (!mv) return false
    if (i % 2 === 0) solverDests.add(mv.to)
    else if (mv.captured && solverDests.has(mv.to)) return true
  }
  return false
}

const PIECE_WORDS: [RegExp, string, string][] = [
  [/knight/, 'N', 'knight'],
  [/bishop/, 'B', 'bishop'],
  [/rook/, 'R', 'rook'],
  [/queen/, 'Q', 'queen'],
  [/pawn/, 'P', 'pawn'],
]

/**
 * Mechanical title scan for STORED artifacts. Stricter than the generation
 * path: "match" in a headline is a typo class ("Forces Match" for "Forces
 * Mate"), so any board-material title containing it is retired outright.
 * Fork and sacrifice claims are checked separately, against the FEN.
 */
function titleViolation(title: string, pieces: Set<string> | null, endsInMate: boolean): string | null {
  const t = title.toLowerCase()
  if (/\bmatch\b/.test(t)) return 'title says "match" where a mate claim was meant'
  if (pieces) {
    for (const [re, letter, word] of PIECE_WORDS) {
      if (re.test(t) && !pieces.has(letter)) return `title names a ${word} the solver never moves or captures`
    }
    if (/wins the king|takes the king/.test(t)) return 'title claims capturing a king, which never happens'
  }
  if (/\bmat(e|ed|ing|es)\b|\bcheckmate\b/.test(t) && !endsInMate) return 'title claims a mate but the stored line does not end in one'
  return null
}

/** Fork and sacrifice claims are positional: they need the real FEN. */
function claimViolation(fen: string, title: string, sans: string[]): string | null {
  const t = title.toLowerCase()
  if (/\bfork/.test(t)) {
    const probe = replay(fen, sans)
    if (!probe) return null // illegal line is reported separately
    if (!lineHasFork(fen, sans)) return 'title claims a fork the stored line does not contain'
  }
  if (/\bsacrific/.test(t)) {
    const probe = replay(fen, sans)
    if (!probe) return null
    if (!lineHasSacrifice(fen, sans)) return 'title claims a sacrifice the stored line does not contain'
  }
  return null
}

/** Audit one materialized artifact the way a student would meet it. */
export function auditArtifact(a: ArtifactView): AuditVerdict {
  // Universal floor: a card with no real headline is slop.
  if (!a.title || !a.title.trim()) return { ok: false, reason: 'stored card has an empty title' }

  if (a.kind === 'quiz') {
    const options = a.options ?? []
    if (!a.question) return { ok: false, reason: 'stored quiz has no question' }
    if (options.length < 3) return { ok: false, reason: 'stored quiz has fewer than three options' }
    if (options.filter((o) => o.correct).length !== 1) return { ok: false, reason: 'stored quiz does not have exactly one correct option' }
    if (a.rating == null) return { ok: false, reason: 'stored quiz carries no rating' }
    return { ok: true }
  }

  if (a.kind === 'line') {
    // Walkthroughs were replay-verified at generation; only structural sanity here.
    const steps = a.steps ?? []
    if (!steps.length && !a.solution.length) return { ok: false, reason: 'stored walkthrough has no moves' }
    return { ok: true }
  }

  // Puzzle / drill: the full cold replay plus the truth scan.
  if (!a.fen) return { ok: false, reason: 'stored board material has no position' }
  if (!a.solution.length) return { ok: false, reason: 'stored board material has no solution line' }
  const g = replay(a.fen, a.solution)
  if (!g) return { ok: false, reason: 'stored solution no longer replays legally from its position' }
  const endsInMate = g.isCheckmate()
  // The early-stop ban: a win that neither mates nor carries at least two
  // solver moves is the exact fragment class the pipeline now rejects. Old
  // fragments ("c3+ Kb4 cxb2") retire here.
  if (!endsInMate && a.solution.length < 4) {
    return { ok: false, reason: 'stored line stops at the tactic without a mate (early-stop fragment)' }
  }
  const pieces = solverPieces(a.fen, a.solution)
  if (!pieces) return { ok: false, reason: 'stored solution no longer replays legally from its position' }
  const violation = titleViolation(a.title, pieces, endsInMate) ?? claimViolation(a.fen, a.title, a.solution)
  if (violation) return { ok: false, reason: violation }
  if (a.rating == null) return { ok: false, reason: 'stored material carries no rating' }
  return { ok: true }
}
