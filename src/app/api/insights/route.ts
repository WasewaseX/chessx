import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

// Insights v1: everything here is aggregated from real game reports saved by
// the game review. No seeding, no filler. Games without a report stay out.

const TIME_BUCKETS: { bucket: string; from: number; to: number }[] = [
  { bucket: 'morning', from: 5, to: 12 },
  { bucket: 'afternoon', from: 12, to: 17 },
  { bucket: 'evening', from: 17, to: 22 },
  { bucket: 'night', from: 22, to: 29 }, // 22..24 and 0..5 wrap as 22..29
]

function bucketFor(hour: number): string {
  const h = hour < 5 ? hour + 24 : hour
  for (const b of TIME_BUCKETS) {
    if (h >= b.from && h < b.to) return b.bucket
  }
  return 'night'
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const games = await db.gameRecord.findMany({
    where: { profileId: pid, playerAcc: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  const trend = games.map((g) => ({
    id: g.id,
    botName: g.botName,
    color: g.color,
    result: g.result,
    rated: g.rated,
    opening: g.opening,
    playerAcc: g.playerAcc,
    createdAt: g.createdAt,
  }))

  // move quality totals for the player's own moves only
  const labels: Record<string, number> = {}
  let labelGames = 0
  for (const g of games) {
    if (!g.labelsJson) continue
    try {
      const parsed = JSON.parse(g.labelsJson) as Record<string, { w: number; b: number }>
      const mine = (label: string) => (g.color === 'w' ? parsed[label]?.w ?? 0 : parsed[label]?.b ?? 0)
      for (const label of ['best', 'brilliant', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']) {
        labels[label] = (labels[label] ?? 0) + mine(label)
      }
      labelGames += 1
    } catch {
      /* a broken row stays out of the mix */
    }
  }

  // openings table
  const byOpening = new Map<string, { games: number; wins: number; draws: number; losses: number; accSum: number; accN: number }>()
  for (const g of games) {
    const key = g.opening ?? 'Unknown'
    const row = byOpening.get(key) ?? { games: 0, wins: 0, draws: 0, losses: 0, accSum: 0, accN: 0 }
    row.games += 1
    if (g.result === 'win') row.wins += 1
    else if (g.result === 'draw') row.draws += 1
    else row.losses += 1
    if (g.playerAcc != null) {
      row.accSum += g.playerAcc
      row.accN += 1
    }
    byOpening.set(key, row)
  }
  const openings = [...byOpening.entries()]
    .map(([opening, r]) => ({
      opening,
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      avgAcc: r.accN ? Math.round((r.accSum / r.accN) * 10) / 10 : null,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 10)

  // time of day, from the hour the client recorded at game end (browser clock)
  const buckets = TIME_BUCKETS.map((b) => ({ bucket: b.bucket, games: 0, wins: 0, accSum: 0, accN: 0 }))
  for (const g of games) {
    const hour = g.localHour
    if (hour == null) continue
    const row = buckets.find((b) => b.bucket === bucketFor(hour))
    if (!row) continue
    row.games += 1
    if (g.result === 'win') row.wins += 1
    if (g.playerAcc != null) {
      row.accSum += g.playerAcc
      row.accN += 1
    }
  }
  const timeOfDay = buckets.map((b) => ({
    bucket: b.bucket,
    games: b.games,
    wins: b.wins,
    avgAcc: b.accN ? Math.round((b.accSum / b.accN) * 10) / 10 : null,
  }))

  return NextResponse.json({
    games: trend,
    labels: labelGames > 0 ? labels : null,
    openings,
    timeOfDay,
  })
}
