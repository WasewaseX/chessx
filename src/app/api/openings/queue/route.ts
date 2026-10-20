// Opening Review Queue — chessigma's `opening_review_queue`, ported with
// chessx evidence. Chessigma schedules the user's worst openings for re-study
// from their imported games (evidence: re/chessigma/web Supabase table
// strings, report §4). Here the same loop runs on locally reviewed games:
//
//   GET   /api/openings/queue
//       Aggregate every REVIEWED GameRecord (opening != null) per opening:
//       games, average player accuracy, blunder+mistake count from the stored
//       report, plus live drill state (due / mastered) from the Mistake
//       Corrector. Returns the openings ranked worst-first, so the home card
//       can say honestly: "this opening costs you the most".
//       An opening only qualifies once it has >= MIN_GAMES reviewed games —
//       a single bad game is variance, not a repertoire hole.
//
//   POST  /api/openings/queue   { opening }
//       "Practice this opening": harvests that opening's own-game errors
//       into the drill loop (same pipeline as the Mistake Corrector, filtered
//       to the opening) and returns how many drills are ready. The client
//       then deep-links into the Review view with the opening focus set.
//
// Honest by construction: an opening with no reviewed games or no stored
// errors simply does not appear. Nothing here invents weaknesses.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import { harvestDrills } from '@/lib/server/drill-harvest'

const MIN_GAMES = 2

interface StoredCallout {
  color?: unknown
  label?: unknown
}

interface StoredReportLike {
  areas?: {
    blunders?: StoredCallout[]
    tactics?: StoredCallout[]
  } | null
}

/** Count the PLAYER'S OWN mistake/blunder callouts in a stored report. */
function ownErrorCount(labelsJson: string | null, color: string): number {
  if (!labelsJson) return 0
  try {
    const report = JSON.parse(labelsJson) as StoredReportLike
    const pools = [report.areas?.blunders, report.areas?.tactics]
    let n = 0
    for (const pool of pools) {
      if (!Array.isArray(pool)) continue
      for (const c of pool) {
        // callout color is stored as 'w' | 'b' (matches GameRecord.color);
        // undefined tolerates legacy reports that did not tag the side
        if (c && (c.color === color || c.color === undefined)) n += 1
      }
    }
    return n
  } catch {
    return 0
  }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`openings-queue:${pid}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const games = await db.gameRecord.findMany({
    where: { profileId: pid, opening: { not: null }, analyzedAt: { not: null } },
    select: {
      opening: true,
      color: true,
      playerAcc: true,
      labelsJson: true,
      pivotLoss: true,
      result: true,
      analyzedAt: true,
    },
    orderBy: { analyzedAt: 'desc' },
    take: 200,
  })

  // ---- aggregate per opening ---------------------------------------------
  interface Acc {
    games: number
    accSum: number
    errors: number
    losses: number
    wins: number
    draws: number
  }
  const byOpening = new Map<string, Acc>()
  for (const g of games) {
    const key = g.opening as string
    const a = byOpening.get(key) ?? { games: 0, accSum: 0, errors: 0, losses: 0, wins: 0, draws: 0 }
    a.games += 1
    if (typeof g.playerAcc === 'number') a.accSum += g.playerAcc
    a.errors += ownErrorCount(g.labelsJson, g.color)
    if (g.result === 'loss') a.losses += 1
    else if (g.result === 'win') a.wins += 1
    else a.draws += 1
    byOpening.set(key, a)
  }

  // ---- live drill state per opening --------------------------------------
  const drillAgg = await db.drill.groupBy({
    by: ['opening'],
    where: { profileId: pid, opening: { not: null } },
    _count: { _all: true },
    _avg: { evalLossCp: true },
  })
  const masteredAgg = await db.drill.groupBy({
    by: ['opening'],
    where: { profileId: pid, opening: { not: null }, mastered: true },
    _count: { _all: true },
  })
  const masteredByOpening = new Map<string, number>(
    masteredAgg.map((m) => [m.opening as string, m._count._all]),
  )

  const now = new Date()
  const dueCounts = await db.drill.groupBy({
    by: ['opening'],
    where: { profileId: pid, opening: { not: null }, mastered: false, nextDueAt: { lte: now } },
    _count: { _all: true },
  })
  const dueByOpening = new Map<string, number>(
    dueCounts.map((d) => [d.opening as string, d._count._all]),
  )

  const rows = [...byOpening.entries()]
    .filter(([, a]) => a.games >= MIN_GAMES)
    .map(([opening, a]) => {
      const drillRow = drillAgg.find((d) => d.opening === opening)
      return {
        opening,
        games: a.games,
        avgAcc: a.games > 0 ? Math.round((a.accSum / a.games) * 10) / 10 : null,
        ownErrors: a.errors,
        record: `${a.wins}-${a.losses}-${a.draws}`,
        dueDrills: dueByOpening.get(opening) ?? 0,
        totalDrills: drillRow?._count._all ?? 0,
        masteredDrills: masteredByOpening.get(opening) ?? 0,
        avgLossCp: drillRow?._avg.evalLossCp != null ? Math.round(drillRow._avg.evalLossCp) : null,
      }
    })
    // worst first: due practice, then own errors, then accuracy, then games
    .sort((x, y) => {
      if (y.dueDrills !== x.dueDrills) return y.dueDrills - x.dueDrills
      if (y.ownErrors !== x.ownErrors) return y.ownErrors - x.ownErrors
      const xa = x.avgAcc ?? 100
      const ya = y.avgAcc ?? 100
      if (xa !== ya) return xa - ya
      return y.games - x.games
    })

  return NextResponse.json(
    { openings: rows, minGames: MIN_GAMES, generatedAt: now.toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`openings-harvest:${pid}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as { opening?: unknown }
  const opening = typeof body.opening === 'string' ? body.opening.trim().slice(0, 120) : ''
  if (!opening) return NextResponse.json({ error: 'opening is required' }, { status: 400 })

  // Confirm the opening actually belongs to this player's reviewed history —
  // never harvest for an arbitrary string.
  const owned = await db.gameRecord.count({ where: { profileId: pid, opening } })
  if (owned === 0) {
    return NextResponse.json({ error: 'No reviewed games in this opening' }, { status: 404 })
  }

  const created = await harvestDrills(pid, { opening })
  const ready = await db.drill.count({
    where: { profileId: pid, opening, mastered: false, bestSan: { not: '' } },
  })
  return NextResponse.json({ opening, created, ready, games: owned })
}
