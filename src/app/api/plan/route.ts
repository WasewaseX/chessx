// Today's Plan API — the morning-built 15-slot daily training plan derived
// from the player's own data (see src/lib/server/daily-plan.ts).
//
//  GET  /api/plan?day=yyyy-mm-dd
//         the plan for that day (defaults to the server's dayKey, the same
//         convention /api/activity uses). Slot composition is cached for 60s;
//         the done flags are always recomputed fresh.
//  POST /api/plan  { action: 'refresh', dayKey? }
//         cache-bypass rebuild, used by the plan card's Refresh button.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import { dayKeyLocal } from '@/lib/day'
import { buildPlan } from '@/lib/server/daily-plan'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The client's local day when it sends one, else the server's convention. */
function dayKeyFrom(value: unknown): string {
  const s = typeof value === 'string' ? value : ''
  return DAY_RE.test(s) ? s : dayKeyLocal()
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`plan-get:${pid}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const dayKey = dayKeyFrom(req.nextUrl.searchParams.get('day'))
  try {
    return NextResponse.json(await buildPlan(pid, dayKey))
  } catch (err) {
    console.error('[plan] build failed', err)
    return NextResponse.json({ error: 'Could not build the plan' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`plan-post:${pid}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null || body.action !== 'refresh') {
    return NextResponse.json({ error: "body { action: 'refresh' } required" }, { status: 400 })
  }

  const dayKey = dayKeyFrom(body.dayKey)
  try {
    return NextResponse.json(await buildPlan(pid, dayKey, { refresh: true }))
  } catch (err) {
    console.error('[plan] rebuild failed', err)
    return NextResponse.json({ error: 'Could not rebuild the plan' }, { status: 500 })
  }
}
