// Game report persistence, server side. The review GUI sends the enriched
// plies it got from /api/analysis/evals (PlyEvalDTO shape) plus optional clock
// data parsed from the PGN's %clk comments; this route NEVER trusts client
// aggregates — accuracy, label counts, cpls, opening theory and the five
// review areas are all recomputed here from the raw per-ply numbers using the
// same frozen helpers the GUI renders with, then stored compactly in
// GameRecord.labelsJson for Insights.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { detectOpening } from '@/lib/chess/openings'
import { LABEL_META, type MoveLabel } from '@/lib/chess/move-classification'
import {
  accuracyOfCpl,
  cplOf,
  computeReviewAreas,
  computeCallouts,
  type Callout,
  type PlyEvalDTO,
  type ReviewAreas,
  type TheoryInfo,
} from '@/lib/chess/review-types'
import { computeTheory } from '@/lib/server/game-report'

const MAX_PLIES = 1000
const MAX_CLOCK_SEC = 14 * 24 * 3600

type LabelCounts = { [L in MoveLabel]: { w: number; b: number } }
interface CplSummary {
  /** average centipawn loss for this side */
  avg: number
  /** worst single-ply loss */
  max: number
  /** plies counted */
  n: number
}

/**
 * Stored report payload. The per-label counts also sit directly on the root
 * (legacy v1 layout) so existing readers of labelsJson — Insights, the coach,
 * the agent planner — keep working on new rows unchanged; the v2 fields are
 * strictly additive.
 */
type StoredReport = LabelCounts & {
  v: 2
  labels: LabelCounts
  accuracy: { white: number | null; black: number | null; player: number | null }
  cpls: { white: CplSummary | null; black: CplSummary | null }
  areas: ReviewAreas
  bestMove: Callout | null
  worstMove: Callout | null
  opening: TheoryInfo
  savedAt: string
}

interface CleanPly extends PlyEvalDTO {
  /** index of this ply in the raw client array, for clock alignment */
  origIdx: number
}

const isMoveLabel = (v: unknown): v is MoveLabel => typeof v === 'string' && v in LABEL_META

const finiteNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => null)
  const gameId = typeof body?.gameId === 'string' ? body.gameId : null
  const rawPlies: unknown[] = Array.isArray(body?.plies) ? body.plies : []
  if (!gameId || rawPlies.length === 0) {
    return NextResponse.json({ error: 'gameId and plies required' }, { status: 400 })
  }

  // only the owner of the game may generate its report
  const game = await db.gameRecord.findFirst({ where: { id: gameId, profileId: pid } })
  if (!game) return NextResponse.json({ error: 'no such game' }, { status: 404 })

  // clock seconds, parsed client-side from PGN %clk comments; aligned with the
  // raw ply array by original index so dropped plies cannot shift the mapping
  const rawClock: unknown[] = Array.isArray(body?.clockSecs) ? body.clockSecs : []
  const clockByOrigIdx = new Map<number, number>()
  rawClock.slice(0, MAX_PLIES).forEach((v, idx) => {
    const sec = finiteNumber(v)
    if (sec != null && sec >= 0 && sec <= MAX_CLOCK_SEC) clockByOrigIdx.set(idx, Math.round(sec))
  })

  // keep only verifiable plies: real SAN, known label, sane numbers. cpl is
  // always recomputed here — the client's copy is never trusted.
  const clean: CleanPly[] = []
  rawPlies.slice(0, MAX_PLIES).forEach((raw, origIdx) => {
    if (typeof raw !== 'object' || raw === null) return
    const p = raw as Record<string, unknown>
    const san = typeof p.san === 'string' ? p.san.trim() : ''
    const color = p.color === 'w' || p.color === 'b' ? p.color : null
    const before = finiteNumber(p.before)
    const after = finiteNumber(p.after)
    if (!san || san === '...' || !color || before == null || after == null || !isMoveLabel(p.label)) return
    const bestSan = typeof p.bestSan === 'string' && p.bestSan.length > 0 && p.bestSan.length <= 16 ? p.bestSan : null
    const spent = clockByOrigIdx.get(origIdx) ?? null
    clean.push({
      san,
      color,
      before: Math.max(-80, Math.min(80, before)),
      after: Math.max(-80, Math.min(80, after)),
      bestUci: null,
      bestSan,
      label: p.label,
      cpl: cplOf(before, after, color),
      timeSpentSec: spent,
      origIdx,
    })
  })
  if (clean.length === 0) {
    return NextResponse.json({ error: 'no usable plies' }, { status: 400 })
  }

  // accuracy per side from recomputed cpls, same frozen math the on-screen
  // report renders — screen and Insights can never disagree
  const cplsFor = (color: 'w' | 'b') => clean.filter((p) => p.color === color).map((p) => p.cpl ?? 0)
  const whiteCpls = cplsFor('w')
  const blackCpls = cplsFor('b')
  const whiteAcc = whiteCpls.length ? accuracyOfCpl(whiteCpls) : null
  const blackAcc = blackCpls.length ? accuracyOfCpl(blackCpls) : null
  const playerColor: 'w' | 'b' = game.color === 'b' ? 'b' : 'w'
  const playerAcc = playerColor === 'w' ? whiteAcc : blackAcc

  const cplSummary = (cpls: number[]): CplSummary | null =>
    cpls.length
      ? { avg: Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length), max: Math.max(...cpls), n: cpls.length }
      : null

  // per-side label counts across the full frozen 12-label set
  const counts = Object.fromEntries(
    (Object.keys(LABEL_META) as MoveLabel[]).map((l) => [l, { w: 0, b: 0 }]),
  ) as LabelCounts
  for (const p of clean) counts[p.label][p.color] += 1

  // opening theory is recomputed from the SAN sequence, never taken from the client
  const sans = clean.map((p) => p.san)
  const theory = computeTheory(sans)
  const opening = detectOpening(sans)

  const clockSecs = clean.map((p) => p.timeSpentSec ?? null)
  const areas = computeReviewAreas(clean, theory, clockSecs.some((s) => s != null) ? clockSecs : null)
  const { bestMove, worstMove } = computeCallouts(clean)

  // The pivotal moment: the player's biggest verified eval drop among blunders
  // and mistakes, kept with the FEN right before the move so the coach can
  // rebuild the exact miss as a drill. The FEN is rebuilt from a server-side
  // SAN replay, never trusted from the client. Stored in CENTIPAWNS (readers
  // divide by 100).
  let pivotFen: string | null = null
  let pivotSan: string | null = null
  let pivotPly: number | null = null
  let pivotLoss: number | null = null
  let worstLoss = 0
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i]
    if (p.label !== 'blunder' && p.label !== 'mistake') continue
    const loss = p.cpl ?? 0
    if (loss > worstLoss) {
      worstLoss = loss
      pivotSan = p.san
      pivotPly = i
      pivotLoss = loss
    }
  }
  if (pivotPly != null) {
    try {
      const replay = new Chess()
      for (let i = 0; i < pivotPly; i++) replay.move(clean[i].san)
      pivotFen = replay.fen()
    } catch {
      pivotFen = null
    }
  }

  // player's local hour at game end (the browser is the clock in this app)
  const localHour = Number.isInteger(body?.localHour) ? Math.max(0, Math.min(23, Number(body.localHour))) : null

  const report: StoredReport = {
    ...counts, // legacy v1 layout on the root: pre-v2 readers keep working
    v: 2,
    labels: counts,
    accuracy: { white: whiteAcc, black: blackAcc, player: playerAcc },
    cpls: { white: cplSummary(whiteCpls), black: cplSummary(blackCpls) },
    areas,
    bestMove,
    worstMove,
    opening: theory,
    savedAt: new Date().toISOString(),
  }

  const updated = await db.gameRecord.update({
    where: { id: game.id },
    data: {
      opening,
      whiteAcc,
      blackAcc,
      playerAcc,
      labelsJson: JSON.stringify(report),
      ...(pivotFen ? { pivotFen, pivotSan, pivotPly, pivotLoss } : {}),
      localHour,
      analyzedAt: new Date(),
    },
  })

  return NextResponse.json({
    report: {
      gameId: updated.id,
      opening,
      openingInfo: theory,
      whiteAcc,
      blackAcc,
      playerAcc,
      labels: counts,
      areas,
      bestMove,
      worstMove,
    },
  })
}
