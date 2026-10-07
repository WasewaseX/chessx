import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { dayKeyLocal } from '@/lib/day'
import { numOr, publicProfile } from '@/lib/api'

/**
 * Coordinates sprint (vision training). The whole point is board vision, so
 * this never touches puzzle Elo or the rated attempt ledger: honest bests
 * and small capped XP are the only residue.
 */

const MODES = ['white', 'black', 'both'] as const
type Mode = (typeof MODES)[number]

function isMode(v: unknown): v is Mode {
  return MODES.includes(v as Mode)
}

async function bests(profileId: string) {
  const rows = await db.visionRun.findMany({
    where: { profileId },
    orderBy: { score: 'desc' },
    take: 200,
  })
  const best: Record<Mode, number> = { white: 0, black: 0, both: 0 }
  for (const r of rows) {
    if (isMode(r.mode) && r.score > best[r.mode]) best[r.mode] = r.score
  }
  return best
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ best: { white: 0, black: 0, both: 0 } })
  return NextResponse.json({ best: await bests(profile.id) })
}

/** POST: record a finished sprint, update bests, award small capped XP. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  if (!isMode(body.mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
  const score = numOr(body.score, 0, 0, 200)
  const mistakes = numOr(body.mistakes, 0, 0, 500)
  const seconds = numOr(body.seconds, 0, 0, 600)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  const previousBest = (await bests(pid))[body.mode]
  await db.visionRun.create({
    data: { profileId: pid, mode: body.mode, score, mistakes, seconds, dayKey },
  })

  // Finding squares is training, not solving: the XP stays token.
  const xpGain = Math.min(score * 2, 60)
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
