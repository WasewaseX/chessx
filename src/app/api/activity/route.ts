import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpActivity, computeStreaks } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'

export async function GET(req: NextRequest) {
  const dayParam = req.nextUrl.searchParams.get('day') ?? undefined
  const rows = await db.activityDay.findMany({ orderBy: { id: 'asc' } })
  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  const streaks = await computeStreaks(dayParam ?? undefined)
  const today = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : dayKeyLocal()
  const todayRow = rows.find((r) => r.id === today) ?? null
  return NextResponse.json({
    days: rows,
    today: todayRow,
    streaks,
    goalMinutes: profile?.goalMinutes ?? 15,
    serverDay: dayKeyLocal(),
  })
}

/** Heartbeat: the client posts one active minute while the player is interacting. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  const minutes = Math.max(1, Math.min(5, Number(body.minutes ?? 1)))
  await bumpActivity(dayKey, 'minutes', minutes)
  const rows = await db.activityDay.findMany({ orderBy: { id: 'asc' } })
  const streaks = await computeStreaks(dayKey)
  const todayRow = rows.find((r) => r.id === dayKey) ?? null
  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  return NextResponse.json({
    today: todayRow,
    streaks,
    goalMinutes: profile?.goalMinutes ?? 15,
  })
}
