import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { resolveDaily } from '@/lib/server/daily-pick'

// The pick is resolved once here (live Lichess daily -> curated rotation)
// and remembered per day by src/lib/server/daily-pick.ts, so the attempt
// route validates daily completions against the very same id — before this
// resolver existed the two routes disagreed and a solved daily could never
// register as done.

function daysSinceEpoch(dayKey: string): number {
  const d = new Date(dayKey + 'T00:00:00Z')
  return Math.floor(d.getTime() / 86400000)
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const dayKey = req.nextUrl.searchParams.get('day') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return NextResponse.json({ error: 'bad day param' }, { status: 400 })
  }
  const full = await resolveDaily(dayKey)
  // Spoiler-safe payload: position, rating, nothing else. The solution, the
  // title, the themes and the source cross the wire only after the solve,
  // through /api/puzzles/move (scriptDone) or /api/puzzles/reveal.
  const puzzle = full ? { id: full.id, fen: full.fen, rating: full.rating } : null
  return NextResponse.json({
    puzzle,
    dayKey,
    seriesNumber: daysSinceEpoch(dayKey),
    completed: profile.dailyDoneDate === dayKey,
  })
}
