import 'server-only'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'

/**
 * Chess DNA — the chessigma signature report, rebuilt on ChessX's own
 * honest-by-construction rules. Seven domains (0-100), each computed ONLY
 * from data that actually exists:
 *
 *   tactics     — the player's own average centipawn loss, error rate
 *                 (blunders + misses per move) and elite-move share
 *                 (brilliant / great / best) from stored game reports
 *   consistency — stdev of per-game accuracy + clean-game share
 *                 (games without a single blunder)
 *   opening     — average book depth (theoryPlies from the stored report's
 *                 opening theory) + points scored in the most-played openings
 *   aggression  — share of wins finished by checkmate, capture density and
 *                 check rate from the stored PGN, and how short wins are
 *   endgame     — points scored in games that actually reached an endgame
 *                 (detected from the PGN's capture count) + endgame accuracy
 *                 against the player's own baseline
 *   clock       — time management from %clk PGN comments (imported games):
 *                 share of own moves started under serious time trouble and
 *                 flag-fall losses. Honest null when no clock data exists
 *                 (bot games carry none).
 *   conversion  — what happens once the player is UP material: points scored
 *                 in games where the player held a +3 (or better) material
 *                 advantage at any point after the opening. Detected by
 *                 replaying the stored PGN.
 *
 * Every domain carries its own sample size and can be honestly null when the
 * player has not played that kind of chess yet (e.g. no endgames). No filler,
 * no invented numbers — a domain that cannot be measured is a domain the UI
 * will say "not enough data" about.
 *
 * Percentiles compare the player against the local population: every profile
 * with MIN_POP_GAMES analyzed games (cached in module memory). A small
 * deployment shows a small pool — the UI prints the pool size instead of
 * pretending the numbers are global.
 */

// ---------------------------------------------------------------------------
// Tunables — single source of truth for every threshold below
// ---------------------------------------------------------------------------

/** Analyzed games required before the report is shown at all. */
export const MIN_GAMES = 3
/** Endgames required before the endgame domain gets a score. */
export const MIN_ENDGAMES = 2
/** Clock-sampled games required before the clock domain gets a score. */
export const MIN_CLOCK_GAMES = 3
/** Games that reached a winning position required before conversion scores. */
export const MIN_WINNING_GAMES = 2
/** Profiles required in the percentile pool before percentiles are shown. */
export const MIN_POP_PLAYERS = 3
/** Analyzed games per profile that feed the computation (most recent N). */
const MAX_GAMES = 200
/** Games scanned across ALL profiles for the percentile pool (most recent N). */
const MAX_POP_GAMES = 400
/** Module-memory cache TTL for the percentile pool. */
const POP_TTL_MS = 5 * 60_000
/** A ply can never cost more than this in stored summaries (mirrors cplOf). */
const CPL_CAP = 1000
/** Captures (32 - captured) at which a position counts as an endgame. */
const ENDGAME_PIECES = 11
/** Remaining seconds at/below which a move counts as serious time trouble. */
const TIME_TROUBLE_SECONDS = 30
/** Material advantage (in pawn units) that counts as a winning position. */
const WIN_ADVANTAGE = 3
/** Earliest ply at which a material advantage counts (skip pure opening trades). */
const WIN_ADV_MIN_PLY = 8
/** PGN piece values for the material walk (pawn=1 .. queen=9). */
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export type DnaDomainKey =
  | 'tactics'
  | 'consistency'
  | 'opening'
  | 'aggression'
  | 'endgame'
  | 'clock'
  | 'conversion'

export interface DnaDomain {
  key: DnaDomainKey
  label: string
  /** 0-100; null = honestly not measurable yet (see reason). */
  score: number | null
  /** Population percentile 0-100; null when the pool is too small. */
  percentile: number | null
  /** Games / positions this score is actually built from. */
  sample: string
  /** One-line, non-spoiler description of what the number means. */
  note: string
  /**
   * Where this domain trains, even when it is not the weakest one. `arg`
   * is the view argument the router carries in the hash (e.g.
   * #/puzzles/woodpecker), so the target view opens on the right tab.
   */
  drill: { view: 'review' | 'puzzles' | 'tools'; label: string; arg?: string } | null
}

export interface DnaArchetype {
  key: DnaDomainKey
  name: string
  tagline: string
}

export interface DnaReport {
  ready: boolean
  games: number
  archetype: DnaArchetype | null
  domains: DnaDomain[]
  strongest: DnaDomainKey | null
  weakest: DnaDomainKey | null
  /** Where the app should send the player to fix the weakest domain. */
  trainView: { view: 'review' | 'puzzles' | 'tools'; label: string } | null
  /** One honest coaching line for the weakest domain. */
  tip: string | null
  population: number
  computedAt: string
  /**
   * Daily snapshots (oldest first, max 60): each domain's score on past
   * days. Null scores mean the domain was not measurable that day. Written
   * at most once per UTC day, so a heavy UI day does not spam history.
   */
  history: { day: string; games: number; scores: Record<DnaDomainKey, number | null> }[]
}

// ---------------------------------------------------------------------------
// Stored report shape (the subset Chess DNA reads) — same JSON the game
// review persists; everything is optional because v1 rows exist.
// ---------------------------------------------------------------------------

interface SideCounts {
  w?: number
  b?: number
}

interface StoredLabels {
  brilliant?: SideCounts
  great?: SideCounts
  best?: SideCounts
  excellent?: SideCounts
  good?: SideCounts
  book?: SideCounts
  inaccuracy?: SideCounts
  mistake?: SideCounts
  blunder?: SideCounts
  miss?: SideCounts
  [k: string]: SideCounts | undefined
}

interface StoredReport {
  v?: number
  labels?: StoredLabels
  accuracy?: { white?: number | null; black?: number | null; player?: number | null }
  cpls?: {
    white?: { avg?: number; max?: number; n?: number } | null
    black?: { avg?: number; max?: number; n?: number } | null
  }
  opening?: { theoryPlies?: number }
  [k: string]: unknown
}

interface GameRow {
  color: string
  result: string
  reason: string | null
  moveCount: number
  playerAcc: number | null
  pgn: string
  labelsJson: string | null
}
/** One game's measured primitives, after defensive parsing. */
interface GameFacts {
  ok: boolean // false = row skipped entirely (broken JSON / unparseable PGN)
  isPlayerSide: (label: string) => number
  avgCpl: number | null
  acc: number | null
  theoryPlies: number | null
  opening: string | null
  playerMoves: number
  blunders: number
  misses: number
  elite: number // brilliant + great (+ best counted separately below)
  best: number
  captures: number // by the player
  checks: number // by the player
  wonByMate: boolean
  winLength: number | null // plies in a game the player won
  endgameReached: boolean
  endgameFromPly: number | null
  points: number // 1 win, 0.5 draw, 0 loss
  // clock domain (from %clk PGN comments; absent in bot games)
  hasClk: boolean // both sides carry readable clock comments
  clkMoves: number // the player's own moves with a known remaining time
  troubleMoves: number // own moves STARTED with under TIME_TROUBLE_SECONDS
  flaggedLoss: boolean // lost on time
  // conversion domain
  wasWinning: boolean // held >= +WIN_ADVANTAGE material after the opening
}

// ---------------------------------------------------------------------------
// PGN → facts (cheap SAN-text scan; the PGNs were validated at write time)
// ---------------------------------------------------------------------------

function factsOf(row: GameRow): GameFacts {
  const empty: GameFacts = {
    ok: false,
    isPlayerSide: () => 0,
    avgCpl: null,
    acc: row.playerAcc ?? null,
    theoryPlies: null,
    opening: null,
    playerMoves: 0,
    blunders: 0,
    misses: 0,
    elite: 0,
    best: 0,
    captures: 0,
    checks: 0,
    wonByMate: false,
    winLength: null,
    endgameReached: false,
    endgameFromPly: null,
    points: row.result === 'win' ? 1 : row.result === 'draw' ? 0.5 : 0,
    hasClk: false,
    clkMoves: 0,
    troubleMoves: 0,
    flaggedLoss: row.result === 'loss' && row.reason === 'timeout',
    wasWinning: false,
  }

  const color = row.color === 'b' ? 'b' : 'w'
  let report: StoredReport | null = null
  if (row.labelsJson) {
    try {
      const parsed = JSON.parse(row.labelsJson) as StoredReport
      if (parsed && typeof parsed === 'object') report = parsed
    } catch {
      /* broken row: fall back to PGN-only facts below */
    }
  }

  // per-side label counts: v2 keeps them under .labels, v1 on the root
  const labelSource: StoredLabels | undefined = report?.labels ?? (report as unknown as StoredLabels | undefined)
  const mine = (label: string): number => {
    const c = labelSource?.[label]
    if (!c) return 0
    return color === 'w' ? (c.w ?? 0) : (c.b ?? 0)
  }

  const sideCpl = report?.cpls ? (color === 'w' ? report.cpls.white : report.cpls.black) : null
  const avgCpl =
    sideCpl && typeof sideCpl.avg === 'number' && sideCpl.avg >= 0 && sideCpl.avg <= CPL_CAP
      ? sideCpl.avg
      : null
  const acc =
    report?.accuracy && typeof report.accuracy.player === 'number'
      ? report.accuracy.player
      : (row.playerAcc ?? null)
  const theoryPlies =
    report?.opening && typeof report.opening.theoryPlies === 'number' && report.opening.theoryPlies >= 0
      ? report.opening.theoryPlies
      : null
  const opening =
    report?.opening && typeof (report.opening as { openingName?: unknown }).openingName === 'string'
      ? ((report.opening as { openingName: string }).openingName || null)
      : null

  // PGN replay → SAN list (validated when stored, but never trust storage)
  let sans: string[] = []
  try {
    const chess = new Chess()
    chess.loadPgn(row.pgn, { strict: false })
    sans = chess.history()
  } catch {
    return { ...empty, avgCpl, acc, theoryPlies, opening }
  }
  if (sans.length === 0) return { ...empty, avgCpl, acc, theoryPlies, opening }

  // The player's own SANs are every other ply, offset by color.
  const offset = color === 'w' ? 0 : 1
  const mineSans: string[] = []
  for (let i = offset; i < sans.length; i += 2) mineSans.push(sans[i])

  // --- clock facts: %clk comments (lichess + chess.com both emit them) -----
  // One comment per ply in move order, white first. Both sides must be
  // present for the alternation assumption to hold, so require an even
  // sample; otherwise the game simply does not count for the clock domain.
  const clkAll: number[] = []
  const clkRe = /%clk\s*(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/g
  let cm: RegExpExecArray | null
  while ((cm = clkRe.exec(row.pgn)) != null) {
    const h = Number(cm[1])
    const m = Number(cm[2])
    const s = Number(cm[3])
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) clkAll.push(h * 3600 + m * 60 + s)
  }
  let hasClk = false
  let clkMoves = 0
  let troubleMoves = 0
  if (clkAll.length >= 8 && clkAll.length % 2 === 0) {
    const offsetClk = color === 'w' ? 0 : 1
    const mineClk: number[] = []
    for (let i = offsetClk; i < clkAll.length; i += 2) mineClk.push(clkAll[i])
    if (mineClk.length >= 4) {
      hasClk = true
      clkMoves = mineClk.length
      // mineClk[i] is the time LEFT after the player's (i+1)-th move; the
      // time available FOR that move was mineClk[i-1] (or the start, which
      // we cannot know reliably, so the first move is never 'trouble').
      for (let i = 1; i < mineClk.length; i++) {
        if (mineClk[i - 1] <= TIME_TROUBLE_SECONDS) troubleMoves += 1
      }
    }
  }

  // --- conversion facts: material walk over a second replay ----------------
  // chess.js move() reports captured piece types and promotions, so the
  // material balance can be tracked incrementally in O(plies) with no
  // board() scans. A game "was winning" when the player held >= +3 material
  // at any point from WIN_ADV_MIN_PLY on.
  let wasWinning = false
  try {
    const replay = new Chess()
    let myMat = 0
    let opMat = 0
    for (let i = 0; i < sans.length; i++) {
      const mv = replay.move(sans[i])
      if (!mv) break
      const mine = i % 2 === offset
      if (mv.captured) {
        const v = PIECE_VALUE[mv.captured] ?? 0
        if (mine) myMat += v
        else opMat += v
      }
      if (mv.promotion) {
        const v = (PIECE_VALUE[mv.promotion] ?? 0) - 1 // pawn left the board
        if (mine) myMat += v
        else opMat += v
      }
      if (!wasWinning && i >= WIN_ADV_MIN_PLY && myMat - opMat >= WIN_ADVANTAGE) wasWinning = true
    }
  } catch {
    /* conversion stays false for this row — conservative by construction */
  }

  let captures = 0
  let checks = 0
  for (const san of mineSans) {
    if (san.includes('x')) captures += 1
    if (san.endsWith('#')) checks += 1
    else if (san.endsWith('+')) checks += 1
  }

  // Endgame detection from SAN text only (no per-ply board() — O(1) per ply):
  // a capture removes one piece, a promotion adds one (rare at this level, and
  // the bias is conservative — it delays, never fakes, an endgame).
  let endgameFromPly: number | null = null
  let pieces = 32
  for (let ply = 0; ply < sans.length; ply++) {
    const san = sans[ply]
    if (san.includes('x')) pieces -= 1
    if (san.includes('=') && /[QRBN]/.test(san[san.length - 1] ?? '')) pieces += 1
    if (pieces <= ENDGAME_PIECES) {
      endgameFromPly = ply
      break
    }
  }

  return {
    ok: true,
    isPlayerSide: mine,
    avgCpl,
    acc,
    theoryPlies,
    opening,
    playerMoves: mineSans.length,
    blunders: mine('blunder'),
    misses: mine('miss'),
    elite: mine('brilliant') + mine('great'),
    best: mine('best') + mine('excellent'),
    captures,
    checks,
    wonByMate: row.result === 'win' && row.reason === 'checkmate',
    winLength: row.result === 'win' ? sans.length : null,
    endgameReached: endgameFromPly != null,
    endgameFromPly,
    points: row.result === 'win' ? 1 : row.result === 'draw' ? 0.5 : 0,
    hasClk,
    clkMoves,
    troubleMoves,
    flaggedLoss: row.result === 'loss' && row.reason === 'timeout',
    wasWinning,
  }
}

// ---------------------------------------------------------------------------
// 0-100 mapping helpers — every curve is documented at its call site
// ---------------------------------------------------------------------------

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

/** avgCpl 12 → ~97, 40 → ~74, 80 → ~44, 150 → ~0 (linear around a 12 anchor). */
function cplScore(avgCpl: number): number {
  return clamp(100 - (avgCpl - 12) * 0.7)
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

// ---------------------------------------------------------------------------
// Per-profile computation
// ---------------------------------------------------------------------------

export interface ProfileDna {
  tactics: number | null
  consistency: number | null
  opening: number | null
  aggression: number | null
  endgame: number | null
  clock: number | null
  conversion: number | null
  games: number
  endgames: number
  clockGames: number
  winningGames: number
}

export function computeDnaFromRows(rows: GameRow[]): ProfileDna {
  const facts = rows.map(factsOf).filter((f) => f.ok)
  const games = facts.length
  const out: ProfileDna = {
    tactics: null,
    consistency: null,
    opening: null,
    aggression: null,
    endgame: null,
    clock: null,
    conversion: null,
    games,
    endgames: facts.filter((f) => f.endgameReached).length,
    clockGames: facts.filter((f) => f.hasClk).length,
    winningGames: facts.filter((f) => f.wasWinning).length,
  }
  if (games < MIN_GAMES) return out

  // --- tactics: cpl (55) + error rate (30) + elite share (15) --------------
  const cpls = facts.map((f) => f.avgCpl).filter((v): v is number => v != null)
  const moves = facts.reduce((n, f) => n + f.playerMoves, 0)
  const errors = facts.reduce((n, f) => n + f.blunders + f.misses, 0)
  const elite = facts.reduce((n, f) => n + f.elite + f.best, 0)
  if (cpls.length >= MIN_GAMES && moves > 0) {
    const meanCpl = cpls.reduce((a, b) => a + b, 0) / cpls.length
    const errorRate = errors / moves // blunders+misses per move
    // 0.10 errors/move ≈ a blunder every 10 moves → ~0; 0.01 → ~86
    const errorScore = clamp(100 - (errorRate - 0.01) * 950)
    const eliteShare = elite / moves // best+excellent+brilliant+great per move
    // 0.55 ≈ what a strong club player accumulates → ~100
    const eliteScore = clamp(eliteShare * 180)
    out.tactics = Math.round(clamp(0.55 * cplScore(meanCpl) + 0.3 * errorScore + 0.15 * eliteScore))
  }

  // --- consistency: accuracy stdev (60) + clean-game share (40) ------------
  const accs = facts.map((f) => f.acc).filter((v): v is number => v != null)
  if (accs.length >= MIN_GAMES) {
    const sd = stdev(accs)
    const cleanShare = facts.filter((f) => f.blunders === 0).length / games
    // stdev 2.5 → ~93, 8 → ~64, 15 → ~19
    const sdScore = sd != null ? clamp(100 - (sd - 2.5) * 6.2) : 60
    out.consistency = Math.round(clamp(0.6 * sdScore + 0.4 * (cleanShare * 100)))
  }

  // --- opening: book depth (50) + points in most-played openings (50) ------
  const theories = facts.map((f) => f.theoryPlies).filter((v): v is number => v != null)
  if (theories.length >= MIN_GAMES) {
    const avgTheory = theories.reduce((a, b) => a + b, 0) / theories.length
    // 8 book plies ≈ solid repertoire → 100; 0 → 25 (never zero: some credit
    // for reaching a playable position)
    const depthScore = clamp(25 + (avgTheory / 8) * 75)
    const byOpening = new Map<string, { pts: number; n: number }>()
    for (const f of facts) {
      if (!f.opening) continue
      const row = byOpening.get(f.opening) ?? { pts: 0, n: 0 }
      row.pts += f.points
      row.n += 1
      byOpening.set(f.opening, row)
    }
    const reps = [...byOpening.values()].filter((r) => r.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3)
    const openScore =
      reps.length > 0 ? clamp((reps.reduce((n, r) => n + r.pts / r.n, 0) / reps.length) * 100) : null
    out.opening = Math.round(clamp(openScore != null ? 0.5 * depthScore + 0.5 * openScore : depthScore))
  }

  // --- aggression: mate finishes (35) + capture density (30) + short wins (20) + check rate (15)
  const wins = facts.filter((f) => f.points === 1)
  const mateShare = wins.length > 0 ? wins.filter((f) => f.wonByMate).length / wins.length : 0
  const capMoves = facts.reduce((n, f) => n + f.playerMoves, 0)
  const capCount = facts.reduce((n, f) => n + f.captures, 0)
  const checkCount = facts.reduce((n, f) => n + f.checks, 0)
  if (capMoves > 0) {
    // capture density: 0.30 captures/move ≈ very sharp → 100; 0.12 ≈ quiet → ~35
    const capScore = clamp((capCount / capMoves / 0.3) * 100)
    // check rate: 0.10 checks/move is a lot of king-hunting → 100
    const checkScore = clamp((checkCount / capMoves / 0.1) * 100)
    const winLens = wins.map((f) => f.winLength).filter((v): v is number => v != null)
    // wins in under 35 plies → 100; 90 plies → ~20
    const lenScore = winLens.length > 0 ? clamp(100 - (avg(winLens) - 35) * 1.4) : 50
    out.aggression = Math.round(
      clamp(0.35 * (mateShare * 100) + 0.3 * capScore + 0.2 * lenScore + 0.15 * checkScore),
    )
  }

  // --- endgame: points in real endgames (60) + accuracy delta (40) ---------
  const endgames = facts.filter((f) => f.endgameReached)
  if (endgames.length >= MIN_ENDGAMES) {
    const pts = endgames.reduce((n, f) => n + f.points, 0) / endgames.length
    // 100% points → 100; 50% → 50; 0% → 0
    const convScore = clamp(pts * 100)
    const egAccs = endgames.map((f) => f.acc).filter((v): v is number => v != null)
    const allAccs = accs
    let accScore = 50
    if (egAccs.length >= MIN_ENDGAMES && allAccs.length >= MIN_GAMES) {
      const delta = avg(egAccs) - avg(allAccs) // +5 points ≈ much better in endgames
      accScore = clamp(50 + delta * 6)
    }
    out.endgame = Math.round(clamp(0.6 * convScore + 0.4 * accScore))
  }

  // --- clock: no time trouble (65) + no flag falls (35) --------------------
  const clockGames = facts.filter((f) => f.hasClk)
  if (clockGames.length >= MIN_CLOCK_GAMES) {
    const clkMoves = clockGames.reduce((n, f) => n + f.clkMoves, 0)
    const trouble = clockGames.reduce((n, f) => n + f.troubleMoves, 0)
    if (clkMoves > 0) {
      const troubleShare = trouble / clkMoves
      // 0% of moves started under 30s → 100; 10% → ~78; 30% → ~34
      const troubleScore = clamp(100 - troubleShare * 220)
      const flags = clockGames.filter((f) => f.flaggedLoss).length
      // never flagging → 100; flagging 10% of clock games → ~75; 40% → 0
      const flagScore = clamp(100 - (flags / clockGames.length) * 250)
      out.clock = Math.round(clamp(0.65 * troubleScore + 0.35 * flagScore))
    }
  }

  // --- conversion: points once actually up material ------------------------
  const winning = facts.filter((f) => f.wasWinning)
  if (winning.length >= MIN_WINNING_GAMES) {
    const pts = winning.reduce((n, f) => n + f.points, 0) / winning.length
    // 100% of +3-or-better games converted → 100; half → 50
    out.conversion = Math.round(clamp(pts * 100))
  }

  return out
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ---------------------------------------------------------------------------
// Percentile pool (module memory, 5-min TTL)
// ---------------------------------------------------------------------------

interface PopEntry {
  scores: { [K in DnaDomainKey]: number | null }
}

let popCache: { at: number; players: PopEntry[] } | null = null

async function percentilePool(): Promise<PopEntry[]> {
  if (popCache && Date.now() - popCache.at < POP_TTL_MS) return popCache.players

  const rows = await db.gameRecord.findMany({
    where: { labelsJson: { not: null } },
    select: {
      profileId: true,
      color: true,
      result: true,
      reason: true,
      moveCount: true,
      playerAcc: true,
      pgn: true,
      labelsJson: true,
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_POP_GAMES,
  })

  const byProfile = new Map<string, GameRow[]>()
  for (const r of rows) {
    const list = byProfile.get(r.profileId) ?? []
    list.push(r as unknown as GameRow)
    byProfile.set(r.profileId, list)
  }

  const players: PopEntry[] = []
  for (const list of byProfile.values()) {
    if (list.length < MIN_GAMES) continue
    const dna = computeDnaFromRows(list)
    if (dna.games < MIN_GAMES) continue
    players.push({
      scores: {
        tactics: dna.tactics,
        consistency: dna.consistency,
        opening: dna.opening,
        aggression: dna.aggression,
        endgame: dna.endgame,
        clock: dna.clock,
        conversion: dna.conversion,
      },
    })
  }
  popCache = { at: Date.now(), players }
  return players
}

function percentileOf(score: number, pool: number[]): number | null {
  if (pool.length < MIN_POP_PLAYERS) return null
  const below = pool.filter((v) => v < score).length
  // round to keep the UI stable against tiny pool jitter
  return Math.round((below / pool.length) * 100)
}

// ---------------------------------------------------------------------------
// Public entry: build the full report for one profile
// ---------------------------------------------------------------------------

const DOMAIN_META: { key: DnaDomainKey; label: string; note: string; sample: (p: ProfileDna) => string }[] = [
  {
    key: 'tactics',
    label: 'Tactics',
    note: 'Calculation quality: centipawn loss, error rate and elite moves across your games.',
    sample: (p) => `${p.games} analyzed ${p.games === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'consistency',
    label: 'Consistency',
    note: 'How steady your accuracy stays from game to game, and how often you play without blunders.',
    sample: (p) => `${p.games} analyzed ${p.games === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'opening',
    label: 'Opening',
    note: 'Book depth plus your score in the openings you actually repeat.',
    sample: (p) => `${p.games} analyzed ${p.games === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'aggression',
    label: 'Aggression',
    note: 'King hunting: checkmate finishes, capture density, checks per move and how fast your wins come.',
    sample: (p) => `${p.games} analyzed ${p.games === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'endgame',
    label: 'Endgame',
    note: 'Points converted in games that reached an endgame, and your accuracy there against your own baseline.',
    sample: (p) => `${p.endgames} endgame ${p.endgames === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'clock',
    label: 'Clock',
    note: 'Time management in your clock-recorded games: moves started under serious time trouble and flag falls.',
    sample: (p) => `${p.clockGames} clock-recorded ${p.clockGames === 1 ? 'game' : 'games'}`,
  },
  {
    key: 'conversion',
    label: 'Conversion',
    note: 'Points you actually score once you are up material by a rook or more. The winning-position scoreboard.',
    sample: (p) => `${p.winningGames} winning ${p.winningGames === 1 ? 'game' : 'games'}`,
  },
]

const ARCHETYPES: { key: DnaDomainKey; name: string; tagline: string }[] = [
  { key: 'tactics', name: 'The Tactician', tagline: 'You live for the kill shot.' },
  { key: 'consistency', name: 'The Wall', tagline: 'Rarely brilliant, rarely beaten.' },
  { key: 'opening', name: 'The Scholar', tagline: 'You win it in the notes, before move ten.' },
  { key: 'aggression', name: 'The Attacker', tagline: 'Kings fall around you.' },
  { key: 'endgame', name: 'The Technician', tagline: 'You grind wins out of nothing.' },
  { key: 'clock', name: 'The Clockkeeper', tagline: 'Your flag never falls.' },
  { key: 'conversion', name: 'The Closer', tagline: 'When you are up, the point is yours.' },
]

// Per-domain training destinations — every measured domain row links to the
// exact spot where that work lives (the weakest domain additionally gets the
// hero CTA + coaching tip from WEAKNESS_FIX below).
const DOMAIN_DRILLS: Record<DnaDomainKey, { view: 'review' | 'puzzles' | 'tools'; label: string; arg?: string }> = {
  tactics: { view: 'review', label: 'Fix your misses' },
  consistency: { view: 'puzzles', label: 'Drill Woodpecker', arg: 'woodpecker' },
  opening: { view: 'tools', label: 'Train your openings', arg: 'trainer' },
  aggression: { view: 'review', label: 'Study attacking play' },
  endgame: { view: 'review', label: 'Convert endgames' },
  clock: { view: 'review', label: 'Replay your time trouble' },
  conversion: { view: 'review', label: 'Study your blown wins' },
}

const WEAKNESS_FIX: { key: DnaDomainKey; view: 'review' | 'puzzles' | 'tools'; label: string; tip: string }[] = [
  {
    key: 'tactics',
    view: 'review',
    label: 'Fix your misses',
    tip: 'Your centipawn loss is the leak. Rebuild your biggest misses as drills and replay them until they are automatic.',
  },
  {
    key: 'consistency',
    view: 'puzzles',
    label: 'Drill Woodpecker sets',
    tip: 'Your accuracy swings between games. Short daily Woodpecker cycles flatten the bad days.',
  },
  {
    key: 'opening',
    view: 'tools',
    label: 'Train your openings',
    tip: 'You leave book early and score worse in your own openings. Train the first ten moves of the ones you play most.',
  },
  {
    key: 'aggression',
    view: 'review',
    label: 'Study attacking play',
    tip: 'Your wins grind rather than crash through. Review your winning games and look for the earlier attacking chance.',
  },
  {
    key: 'endgame',
    view: 'review',
    label: 'Convert endgames',
    tip: 'When the board empties, points slip. Review the endgames you drew or lost and find where the conversion broke.',
  },
  {
    key: 'clock',
    view: 'review',
    label: 'Replay your time trouble',
    tip: 'You keep reaching for moves with seconds left. Review the games where the clock squeezed you and spend opening moves on thought, not reflex.',
  },
  {
    key: 'conversion',
    view: 'review',
    label: 'Study your blown wins',
    tip: 'You reach winning positions and let them slip. Review the wins you drew or lost and find the first move where the advantage leaked.',
  },
]

const HISTORY_MAX = 60

export async function buildDnaReport(profileId: string): Promise<DnaReport> {
  const rows = (await db.gameRecord.findMany({
    where: { profileId, labelsJson: { not: null } },
    select: { color: true, result: true, reason: true, moveCount: true, playerAcc: true, pgn: true, labelsJson: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_GAMES,
  })) as unknown as GameRow[]

  const dna = computeDnaFromRows(rows)
  const pool = await percentilePool()

  const scores: { [K in DnaDomainKey]: number | null } = {
    tactics: dna.tactics,
    consistency: dna.consistency,
    opening: dna.opening,
    aggression: dna.aggression,
    endgame: dna.endgame,
    clock: dna.clock,
    conversion: dna.conversion,
  }

  const domains: DnaDomain[] = DOMAIN_META.map((meta) => {
    const score = scores[meta.key]
    let percentile: number | null = null
    if (score != null) {
      const values = pool.map((p) => p.scores[meta.key]).filter((v): v is number => v != null)
      percentile = percentileOf(score, values)
    }
    return {
      key: meta.key,
      label: meta.label,
      score,
      percentile,
      sample: meta.sample(dna),
      note: meta.note,
      drill: DOMAIN_DRILLS[meta.key],
    }
  })

  const measured = domains.filter((d) => d.score != null) as (DnaDomain & { score: number })[]
  const strongest = measured.length ? measured.reduce((a, b) => (b.score > a.score ? b : a)).key : null
  const weakest = measured.length ? measured.reduce((a, b) => (b.score < a.score ? b : a)).key : null
  const archetype = strongest ? (ARCHETYPES.find((a) => a.key === strongest) ?? null) : null
  const fix = weakest ? (WEAKNESS_FIX.find((f) => f.key === weakest) ?? null) : null

  // --- daily snapshot + history -------------------------------------------
  // At most one row per UTC day: today's row is written only when it does
  // not exist yet (so repeated reads never rewrite history), then up to the
  // last 60 days are read back as the trend the UI plots.
  const dayKey = new Date().toISOString().slice(0, 10)
  try {
    await db.dnaSnapshot.upsert({
      where: { profileId_dayKey: { profileId, dayKey } },
      create: { profileId, dayKey, games: dna.games, domainsJson: JSON.stringify(scores) },
      update: {},
    })
  } catch (e) {
    // History must never take the report down with it.
    console.error('[dna] snapshot write failed', e)
  }
  let history: DnaReport['history'] = []
  try {
    const snaps = await db.dnaSnapshot.findMany({
      where: { profileId },
      orderBy: { dayKey: 'desc' },
      take: HISTORY_MAX,
      select: { dayKey: true, games: true, domainsJson: true },
    })
    history = snaps
      .map((s) => {
        try {
          const parsed = JSON.parse(s.domainsJson) as Partial<Record<DnaDomainKey, number | null>>
          return {
            day: s.dayKey,
            games: s.games,
            scores: {
              tactics: parsed.tactics ?? null,
              consistency: parsed.consistency ?? null,
              opening: parsed.opening ?? null,
              aggression: parsed.aggression ?? null,
              endgame: parsed.endgame ?? null,
              clock: parsed.clock ?? null,
              conversion: parsed.conversion ?? null,
            },
          }
        } catch {
          return null
        }
      })
      .filter((h): h is NonNullable<typeof h> => h != null)
      .reverse() // oldest first, so the UI plots left → right
  } catch (e) {
    console.error('[dna] history read failed', e)
  }

  return {
    ready: dna.games >= MIN_GAMES,
    games: dna.games,
    archetype: archetype ? { key: archetype.key, name: archetype.name, tagline: archetype.tagline } : null,
    domains,
    strongest,
    weakest,
    trainView: fix ? { view: fix.view, label: fix.label } : null,
    tip: fix ? fix.tip : null,
    population: pool.length,
    computedAt: new Date().toISOString(),
    history,
  }
}
