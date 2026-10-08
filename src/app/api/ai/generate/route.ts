// The tutor's skill endpoint: generates one piece of training material
// (puzzle, drill or quiz), validates it, stores it and returns it.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getAiConfig } from '@/lib/ai'
import { SkillError, checkRateLimit, runSkill, SKILL_IDS, type SkillId } from '@/lib/server/coach-skills'
import { dayKeyLocal } from '@/lib/day'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const body = await req.json().catch(() => ({}))
  const skill = String(body.skill ?? '')
  if (!SKILL_IDS.includes(skill as SkillId)) {
    return NextResponse.json({ error: 'Unknown skill.' }, { status: 400 })
  }

  const limited = checkRateLimit(profile.id, dayKeyLocal())
  if (limited) return NextResponse.json({ error: limited }, { status: 429 })

  const cfg = await getAiConfig(profile.id)
  try {
    const artifact = await runSkill({
      skill: skill as SkillId,
      cfg,
      profileId: profile.id,
      skillLevel: profile.skillLevel,
      tier: body.tier,
      level: body.level,
      theme: body.theme,
      fen: body.fen,
    })
    return NextResponse.json({ artifact })
  } catch (e) {
    if (e instanceof SkillError) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
