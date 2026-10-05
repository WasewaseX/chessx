import { NextRequest, NextResponse } from 'next/server'
import { PUZZLES } from '@/content/puzzles'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

// Deterministic daily puzzle: same position for everyone on a given day,
// rotating through the whole pool before repeating.
function dayIndex(dayKey: string): number {
  let h = 0
  for (let i = 0; i < dayKey.length; i++) {
    h = (h * 31 + dayKey.charCodeAt(i)) >>> 0
  }
  return h % PUZZLES.length
}

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
  const idx = dayIndex(dayKey)
  const puzzle = PUZZLES[idx]
  return NextResponse.json({
    puzzle,
    dayKey,
    seriesNumber: daysSinceEpoch(dayKey),
    completed: profile.dailyDoneDate === dayKey,
  })
}
