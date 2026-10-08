// Record an attempt on a coach-generated artifact. Feeds the skill model and
// the activity ledger like any other real training event. Honest rule:
// coach drills never move the rated puzzle Elo (they are unbounded practice
// material the student can regenerate), so there is no rating math here.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { bumpActivity, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { publicProfile } from '@/lib/api'

const XP_FIRST_SOLVE = 10

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '').slice(0, 40)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const solved = Boolean(body.solved)
  const dayKey = dayKeyLocal()

  const artifact = await db.coachArtifact.findFirst({ where: { id, profileId: pid } })
  if (!artifact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const firstSolve = solved && artifact.solved !== true
  const updated = await db.coachArtifact.update({
    where: { id: artifact.id },
    data: {
      attempts: { increment: 1 },
      solved: firstSolve || artifact.solved === true ? true : false,
    },
  })

  let themes: string[] = []
  try {
    themes = sanitizeConcepts(JSON.parse(artifact.themes ?? '[]'))
  } catch {
    themes = []
  }
  await updateMastery(pid, themes, solved)
  if (solved) await bumpActivity(pid, dayKey, 'puzzlesSolved', 1)

  let xpGain = 0
  if (firstSolve) {
    xpGain = XP_FIRST_SOLVE
    await db.profile.update({ where: { id: pid }, data: { xp: { increment: xpGain } } })
  }

  const fresh = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({
    artifact: updated,
    xpGain,
    profile: fresh ? publicProfile(fresh) : null,
  })
}
