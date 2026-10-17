import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

// Opponent blunder-rate tracking. Every analyzed game stores the FULL review
// report (both players) in GameRecord.labelsJson — per-label counts for White
// and Black on the root, plus the five callout areas. This route turns those
// stored reports into a per-opponent view: how often each opponent erred in
// the games you have reports for. Read-only aggregation, nothing invented:
// games without a stored report count toward `games` only.

interface OpponentRow {
  name: string
  games: number
  analyzed: number
  opponentBlundersPerGame: number | null
  opponentMistakesPerGame: number | null
  userWinRate: number | null
  mostRecentAt: string | null
}

interface LabelCounts {
  [label: string]: { w?: number; b?: number } | undefined
}

interface StoredAreas {
  blunders?: { color?: string; label?: string }[]
}

interface StoredReport {
  labels?: LabelCounts // v2 canonical location
  areas?: StoredAreas
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const rows = await db.gameRecord.findMany({
    where: { profileId: pid },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  })

  const byOpponent = new Map<
    string,
    {
      games: number
      analyzed: number
      wins: number
      blunderSum: number
      mistakeSum: number
      mostRecentAt: Date | null
    }
  >()

  const bump = (name: string) => {
    let row = byOpponent.get(name)
    if (!row) {
      row = { games: 0, analyzed: 0, wins: 0, blunderSum: 0, mistakeSum: 0, mostRecentAt: null }
      byOpponent.set(name, row)
    }
    return row
  }

  for (const g of rows) {
    const name = g.botName || 'Unknown opponent'
    const row = bump(name)
    row.games += 1
    if (g.result === 'win') row.wins += 1
    if (g.createdAt && (!row.mostRecentAt || g.createdAt > row.mostRecentAt)) row.mostRecentAt = g.createdAt
    if (!g.labelsJson) continue

    let report: StoredReport | null = null
    try {
      report = JSON.parse(g.labelsJson) as StoredReport
    } catch {
      continue // a broken row stays out of the error averages
    }
    // the report's counts are keyed by BOARD side; the user's GameRecord.color
    // decides which side is theirs and which side is the opponent's
    const mineKey = g.color === 'b' ? 'b' : 'w'
    const oppKey = mineKey === 'w' ? 'b' : 'w'

    // Per-label counts live under `labels` (v2) and on the root (legacy v1
    // layout). Prefer `labels`, fall back to the root; when neither exists,
    // count the stored blunder callouts directly.
    const counts = (report.labels ?? (report as unknown as LabelCounts)) as LabelCounts
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    let blunders = num(counts?.blunder?.[oppKey])
    let mistakes = num(counts?.mistake?.[oppKey])
    if (!report.labels) {
      blunders = (report.areas?.blunders ?? []).filter((c) => c.color !== mineKey && c.label === 'blunder').length
    }

    row.analyzed += 1
    row.blunderSum += blunders
    row.mistakeSum += mistakes
  }

  const opponents: OpponentRow[] = [...byOpponent.entries()]
    .map(([name, r]) => ({
      name,
      games: r.games,
      analyzed: r.analyzed,
      opponentBlundersPerGame: r.analyzed ? Math.round((r.blunderSum / r.analyzed) * 10) / 10 : null,
      opponentMistakesPerGame: r.analyzed ? Math.round((r.mistakeSum / r.analyzed) * 10) / 10 : null,
      userWinRate: r.games ? Math.round((r.wins / r.games) * 100) : null,
      mostRecentAt: r.mostRecentAt ? r.mostRecentAt.toISOString() : null,
    }))
    .sort((a, b) => b.games - a.games || (a.name < b.name ? -1 : 1))
    .slice(0, 20)

  return NextResponse.json({ opponents })
}
