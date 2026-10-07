import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { bumpActivity, computeStreaks, settleStreaks } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { numOr } from '@/lib/api'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const dayParam = req.nextUrl.searchParams.get('day') ?? undefined
  const today = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : dayKeyLocal()
  // settle the freeze ledger before anyone reads the streak
  await settleStreaks(pid, today)
  const rows = await db.activityDay.findMany({
    where: { profileId: pid },
    orderBy: { dayKey: 'asc' },
  })
  const fresh = await db.profile.findUnique({ where: { id: pid }, select: { streakFreezes: true } })
  const streaks = await computeStreaks(pid, today)
  const todayRow = rows.find((r) => r.dayKey === today) ?? null
  return NextResponse.json({
    days: rows,
    today: todayRow,
    streaks,
    goalMinutes: profile.goalMinutes,
    streakFreezes: fresh?.streakFreezes ?? profile.streakFreezes,
    serverDay: dayKeyLocal(),
  })
}

/** Heartbeat: the client posts one active minute while the player is interacting. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  const minutes = numOr(body.minutes, 1, 1, 5)
  await bumpActivity(pid, dayKey, 'minutes', minutes)
  const rows = await db.activityDay.findMany({
    where: { profileId: pid },
    orderBy: { dayKey: 'asc' },
  })
  const streaks = await computeStreaks(pid, dayKey)
  const todayRow = rows.find((r) => r.dayKey === dayKey) ?? null
  return NextResponse.json({
    today: todayRow,
    streaks,
    goalMinutes: profile.goalMinutes,
    streakFreezes: profile.streakFreezes,
  })
}
