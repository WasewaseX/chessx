// Mistake Corrector harvest: turns the user's own analyzed-game errors into
// drill rows. The Game review pipeline persists a report in
// GameRecord.labelsJson whose per-ply data is the Callout lists (blunders,
// tactics, conversion, clock flags + the single worst move) — each callout
// carries ply/san/color/label/headline/detail but NOT the position or the
// best move as fields, so the harvest:
//   1. rebuilds the position-before FEN by replaying the stored PGN with
//      chess.js up to the callout's ply (deterministic, no engine needed),
//   2. extracts the engine's best SAN from the callout's plain-English
//      detail/headline (the report pipeline always phrases it as
//      "The engine preferred X." / "X was the way in." / ...) and validates
//      it by playing it in the rebuilt position,
//   3. falls back to the server engine (depth 12, movetime 3s) for the rare
//      error whose best move is not recoverable from stored text, persisted
//      lazily a few drills per request so a GET never stalls.
// Only the USER'S errors become drills: the stored callout lists cover both
// sides, so every candidate is checked against GameRecord.color.
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { coerceLabel, type MoveLabel } from '@/lib/chess/move-classification'
import { analyze } from '@/lib/server/engine'

/** The error labels that become drills (matches the frozen 12-label contract). */
const DRILL_LABELS = new Set<MoveLabel>(['mistake', 'blunder', 'missedwin'])

const MAX_GAMES = 15 // most recent analyzed games per harvest
const MAX_DRILLS = 40 // most costly errors across those games

/** Error plies whose best move could not be recovered from stored text; the
 * engine resolves a few of these per GET request (bounded by a time budget). */
const ENGINE_RESOLVE_BUDGET_MS = 9_000
const ENGINE_RESOLVE_PER_REQUEST = 3

interface StoredCallout {
  ply?: unknown
  san?: unknown
  color?: unknown
  label?: unknown
  headline?: unknown
  detail?: unknown
}

interface StoredReportLike {
  areas?: {
    blunders?: StoredCallout[]
    tactics?: StoredCallout[]
    conversion?: StoredCallout[]
    clock?: { flags?: StoredCallout[] } | null
  } | null
  worstMove?: StoredCallout | null
}

interface PlyInfo {
  fenBefore: string
  san: string
  color: 'w' | 'b'
}

interface Candidate {
  gameRecordId: string
  plyNumber: number
  fen: string
  userSan: string
  bestSan: string // '' when unknown (engine resolves later)
  bestUci: string | null
  evalLossCp: number
  opening: string | null
  opponent: string | null
  note: string | null
  loss: number // sort key (same value as evalLossCp)
}

// ---------------------------------------------------------------------------
// Stored-report parsing (defensive: labelsJson was written by an older
// pipeline once and must never break the queue)
// ---------------------------------------------------------------------------

function calloutOf(raw: unknown): StoredCallout | null {
  if (typeof raw !== 'object' || raw === null) return null
  return raw as StoredCallout
}

function collectCallouts(report: StoredReportLike): StoredCallout[] {
  const out: StoredCallout[] = []
  const push = (c: StoredCallout | null) => {
    if (c) out.push(c)
  }
  const areas = report.areas
  if (areas) {
    for (const list of [areas.blunders, areas.tactics, areas.conversion]) {
      if (Array.isArray(list)) for (const raw of list) push(calloutOf(raw))
    }
    if (areas.clock && Array.isArray(areas.clock.flags)) {
      for (const raw of areas.clock.flags) push(calloutOf(raw))
    }
  }
  push(calloutOf(report.worstMove))
  return out
}

function str(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null
}

/**
 * Estimate the centipawn cost of an error from the win%-drop phrasing the
 * report pipeline uses ("threw away 34% winning chances", "got looser
 * (67% → 52%)"), mapped through the same logistic the classifier uses
 * (a drop centered at the 50% point of the S-curve). Exact pivot losses
 * override this estimate; labels without any number in their text fall back
 * to a per-label constant.
 */
function cplFromWpDrop(dropPct: number): number {
  const d = Math.max(1, Math.min(99, dropPct))
  const cp = (pct: number) => -Math.log(Math.max(0.01, 100 / Math.max(1, pct) - 1)) / 0.00368208
  return Math.round(Math.max(10, Math.min(1500, cp(50 + d / 2) - cp(50 - d / 2))))
}

const LABEL_FALLBACK_CP: Partial<Record<MoveLabel, number>> = { blunder: 250, missedwin: 180, mistake: 120 }

function estimateLoss(callout: StoredCallout | null, label: MoveLabel, isPivot: boolean, pivotLoss: number | null): number {
  if (isPivot && pivotLoss != null) return Math.max(10, Math.min(3000, Math.round(pivotLoss)))
  const text = callout ? `${str(callout.headline) ?? ''} ${str(callout.detail) ?? ''}` : ''
  const threw = /threw away (\d+)% winning chances/.exec(text)
  if (threw) return cplFromWpDrop(Number(threw[1]))
  const looser = /got looser \((\d+)% → (\d+)%\)/.exec(text)
  if (looser) return cplFromWpDrop(Math.max(0, Number(looser[1]) - Number(looser[2])))
  return LABEL_FALLBACK_CP[label] ?? 120
}

/**
 * Recover the engine's best SAN for an error from the callout text. The
 * report pipeline embeds it in fixed phrases; every extraction is validated
 * against the rebuilt position before it is trusted.
 */
const BEST_SAN_PATTERNS: RegExp[] = [
  /^The engine preferred ([A-Za-z0-9][A-Za-z0-9+#=-]{0,10})\./,
  /^([A-Za-z0-9][A-Za-z0-9+#=-]{0,10}) was the way in\./,
  /^([A-Za-z0-9][A-Za-z0-9+#=-]{0,10}) was the move to find\./,
  /^([A-Za-z0-9][A-Za-z0-9+#=-]{0,10}) keeps the clamp on\./,
  /— ([A-Za-z0-9][A-Za-z0-9+#=-]{0,10}) starts it\./,
  /— ([A-Za-z0-9][A-Za-z0-9+#=-]{0,10}) was the way to keep fighting\./,
]

function extractBestSan(callout: StoredCallout): string | null {
  for (const text of [str(callout.detail), str(callout.headline)]) {
    if (!text) continue
    for (const re of BEST_SAN_PATTERNS) {
      const m = re.exec(text)
      if (m) return m[1].replace(/[!?+#]+$/, '')
    }
  }
  return null
}

/** Play `san` in `fen`; returns { san, uci } when legal, else null. */
function tryMove(fen: string, san: string): { san: string; uci: string } | null {
  try {
    const g = new Chess(fen)
    const mv = g.move(san)
    if (!mv) return null
    return { san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}` }
  } catch {
    return null
  }
}

/** Rebuild the SAN list and per-ply position-before FENs from a stored PGN. */
function replayPgn(pgn: string): PlyInfo[] | null {
  try {
    const loader = new Chess()
    loader.loadPgn(pgn)
    const sans = loader.history()
    const fenHeader = /\[FEN "([^"]+)"\]/.exec(pgn)?.[1]
    const replay = new Chess(fenHeader && fenHeader.trim() ? fenHeader.trim() : undefined)
    const plies: PlyInfo[] = []
    for (const san of sans) {
      const fenBefore = replay.fen()
      const mv = replay.move(san)
      if (!mv) return null
      plies.push({ fenBefore, san: mv.san, color: mv.color })
    }
    return plies
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

/**
 * Scan the profile's most recent analyzed games and create-or-update drill
 * rows for the user's own Mistakes / Blunders / Missed Wins, capped at the
 * MAX_DRILLS most costly errors across the MAX_GAMES most recent games.
 * Existing rows are only refreshed with metadata — scheduling, mastery and
 * attempt counters are never touched by a re-harvest.
 */
export async function harvestDrills(
  profileId: string,
  opts?: { opening?: string },
): Promise<number> {
  const games = await db.gameRecord.findMany({
    where: {
      profileId,
      labelsJson: { not: null },
      // Opening Review Queue: restrict the harvest to one opening's games so
      // "practice this opening" produces drills that actually belong to it.
      ...(opts?.opening ? { opening: opts.opening } : {}),
    },
    orderBy: [{ analyzedAt: 'desc' }, { createdAt: 'desc' }],
    take: MAX_GAMES,
  })
  if (games.length === 0) return 0

  const candidates: Candidate[] = []

  for (const game of games) {
    let report: StoredReportLike | null = null
    try {
      const parsed = JSON.parse(game.labelsJson ?? '{}') as StoredReportLike
      if (typeof parsed === 'object' && parsed !== null) report = parsed
    } catch {
      continue
    }
    if (!report) continue

    const playerColor: 'w' | 'b' = game.color === 'b' ? 'b' : 'w'
    const plies = replayPgn(game.pgn)
    const pivotPly = typeof game.pivotPly === 'number' ? game.pivotPly : null
    const pivotLoss = typeof game.pivotLoss === 'number' ? game.pivotLoss : null

    // candidate errors for this game, deduped by ply (callout lists overlap)
    const seenPlys = new Set<number>()
    const perGame: Array<{ ply: number; callout: StoredCallout | null; label: MoveLabel; isPivot: boolean }> = []
    for (const c of collectCallouts(report)) {
      const label = coerceLabel(typeof c.label === 'string' ? c.label : '')
      if (!DRILL_LABELS.has(label)) continue
      const ply = typeof c.ply === 'number' && Number.isInteger(c.ply) ? c.ply - 1 : null // callout ply is 1-based
      if (ply == null || ply < 0 || seenPlys.has(ply)) continue
      const san = str(c.san, 12)
      const color = c.color === 'w' || c.color === 'b' ? c.color : null
      if (!san || (color && color !== playerColor)) continue
      seenPlys.add(ply)
      perGame.push({ ply, callout: c, label, isPivot: pivotPly === ply })
    }
    // the pivot (single worst moment) may carry no callout of its own
    if (pivotPly != null && pivotPly >= 0 && !seenPlys.has(pivotPly)) {
      const parityColor: 'w' | 'b' = pivotPly % 2 === 0 ? 'w' : 'b' // exact for standard starts; replay verifies below
      if (!plies || (plies[pivotPly]?.color ?? parityColor) === playerColor) {
        perGame.push({ ply: pivotPly, callout: null, label: 'blunder', isPivot: true })
      }
    }

    for (const { ply, callout, label, isPivot } of perGame) {
      // position before the error: replayed PGN first, stored pivot FEN as the
      // honest fallback for the pivot ply when the PGN will not replay
      let fen: string | null = plies?.[ply]?.fenBefore ?? null
      let userSan: string | null = plies?.[ply]?.san ?? null
      if (isPivot && game.pivotFen && (plies == null || ply === pivotPly)) {
        if (!fen) fen = game.pivotFen
        if (!userSan) userSan = game.pivotSan
      }
      if (!fen || !userSan) continue
      if (plies && plies[ply] && plies[ply].san !== userSan) continue // misaligned report, never trust it
      if (plies == null && isPivot && game.pivotSan) userSan = game.pivotSan

      // userSan must be legal in the rebuilt position (guards corrupt rows)
      const played = tryMove(fen, userSan)
      if (!played) continue

      // best move: stored text first, engine later for the leftovers
      let bestSan = callout ? extractBestSan(callout) : null
      let bestUci: string | null = null
      if (bestSan) {
        const verified = tryMove(fen, bestSan)
        if (verified) {
          bestSan = verified.san
          bestUci = verified.uci
        } else {
          bestSan = null
        }
      }
      if (bestSan && bestSan === played.san) continue // not actually an error, skip

      candidates.push({
        gameRecordId: game.id,
        plyNumber: ply,
        fen,
        userSan: played.san,
        bestSan: bestSan ?? '',
        bestUci,
        evalLossCp: estimateLoss(callout, label, isPivot, pivotLoss),
        opening: str(game.opening, 80),
        opponent: str(game.botName, 60),
        note: callout ? [str(callout.headline), str(callout.detail)].filter(Boolean).join(' ').slice(0, 300) || null : null,
        loss: estimateLoss(callout, label, isPivot, pivotLoss),
      })
    }
  }

  candidates.sort((a, b) => b.loss - a.loss)
  const picked = candidates.slice(0, MAX_DRILLS)
  let created = 0

  for (const c of picked) {
    const existing = await db.drill.findFirst({
      where: { profileId, gameRecordId: c.gameRecordId, plyNumber: c.plyNumber },
    })
    if (existing) {
      await db.drill.update({
        where: { id: existing.id },
        data: {
          // metadata refresh only: never reset scheduling, mastery or counters
          evalLossCp: c.evalLossCp,
          opening: c.opening,
          opponent: c.opponent,
          note: c.note ?? existing.note,
          ...(existing.bestSan === '' && c.bestSan ? { bestSan: c.bestSan, bestUci: c.bestUci } : {}),
        },
      })
      continue
    }
    await db.drill.create({
      data: {
        profileId,
        gameRecordId: c.gameRecordId,
        fen: c.fen,
        userSan: c.userSan,
        bestSan: c.bestSan,
        bestUci: c.bestUci,
        evalLossCp: c.evalLossCp,
        plyNumber: c.plyNumber,
        opening: c.opening,
        opponent: c.opponent,
        note: c.note,
      },
    })
    created += 1
  }
  return created
}

/**
 * Resolve pending drills (bestSan still "") with the server engine, a few per
 * request, inside a time budget — a cold GET pays at most one boot plus a
 * handful of 3s searches, and the rest resume on the next request. Drills
 * without a resolved best move stay out of the served queue.
 */
export async function resolvePendingDrills(profileId: string): Promise<number> {
  const pending = await db.drill.findMany({
    where: { profileId, bestSan: '' },
    orderBy: { nextDueAt: 'asc' },
    take: ENGINE_RESOLVE_PER_REQUEST,
  })
  if (pending.length === 0) return 0

  const t0 = Date.now()
  let resolved = 0
  for (const drill of pending) {
    if (Date.now() - t0 > ENGINE_RESOLVE_BUDGET_MS) break
    // a drill whose position is already decided can never be answered
    try {
      const g = new Chess(drill.fen)
      if (g.isGameOver()) {
        await db.drill.delete({ where: { id: drill.id } }).catch(() => {})
        continue
      }
    } catch {
      await db.drill.delete({ where: { id: drill.id } }).catch(() => {})
      continue
    }
    const analysis = await analyze(drill.fen, 1, 12, { movetimeMs: 3000, timeoutMs: 12_000 })
    if (!analysis || !analysis.best) break // engine unavailable: retry on the next request
    try {
      const g = new Chess(drill.fen)
      const mv = g.move({
        from: analysis.best.slice(0, 2),
        to: analysis.best.slice(2, 4),
        promotion: analysis.best.slice(4, 5) || undefined,
      })
      if (!mv) break
      await db.drill.update({
        where: { id: drill.id },
        data: { bestSan: mv.san, bestUci: `${mv.from}${mv.to}${mv.promotion ?? ''}` },
      })
      resolved += 1
    } catch {
      // engine suggested something illegal for this FEN: drop the broken row
      await db.drill.delete({ where: { id: drill.id } }).catch(() => {})
    }
  }
  return resolved
}
