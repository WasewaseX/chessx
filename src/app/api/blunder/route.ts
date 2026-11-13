import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import { dayKeyLocal } from '@/lib/day'
import { numOr, publicProfile } from '@/lib/api'

/**
 * Blunder Training API. The whole point is the pre-move blunder check, so
 * this never touches puzzle Elo or the rated attempt ledger: honest bests
 * and small capped XP are the only residue, mirroring the vision sprint.
 *
 *  GET   best scores per drill mode
 *  POST  { mode, score, mistakes, seconds, dayKey? }  record a finished session
 */

const MODES = ['threat', 'blunderCheck', 'safemove'] as const
type Mode = (typeof MODES)[number]

function isMode(v: unknown): v is Mode {
  return MODES.includes(v as Mode)
}

async function bests(profileId: string): Promise<Record<Mode, number>> {
  const rows = await db.blunderRun.findMany({
    where: { profileId },
    orderBy: { score: 'desc' },
    take: 200,
  })
  const best: Record<Mode, number> = { threat: 0, blunderCheck: 0, safemove: 0 }
  for (const r of rows) {
    if (isMode(r.mode) && r.score > best[r.mode]) best[r.mode] = r.score
  }
  return best
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ best: { threat: 0, blunderCheck: 0, safemove: 0 } })
  return NextResponse.json({ best: await bests(profile.id) })
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`blunder-post:${pid}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !isMode(body.mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
  const score = numOr(body.score, 0, 0, 100)
  const mistakes = numOr(body.mistakes, 0, 0, 500)
  const seconds = numOr(body.seconds, 0, 0, 600)
  // surviving rounds are knowledge checks, worth more than a single tap;
  // the cap keeps it training XP, never a farming surface
  const xpGain = Math.min(Math.max(score - mistakes, 0) * 8, 80)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  const previousBest = (await bests(pid))[body.mode]
  await db.blunderRun.create({
    data: { profileId: pid, mode: body.mode, score, mistakes, seconds, dayKey },
  })

  await db.profile.update({
    where: { id: pid },
    data: { xp: { increment: xpGain } },
  })

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({
    profile: updated ? publicProfile(updated) : null,
    xpGain,
    previousBest,
    isNewBest: score > previousBest,
  })
}
