import { NextRequest, NextResponse } from 'next/server'
import type { Profile } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { XP_STEP, XP_LESSON_DONE } from '@/lib/rating'
import { bumpActivity, gradeReview, missReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const progress = await db.lessonProgress.findMany({
    where: { profileId: profile.id },
  })
  return NextResponse.json({ progress })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  const lessonId = String(body.lessonId ?? '')
  if (!lessonId) return NextResponse.json({ error: 'lessonId required' }, { status: 400 })
  const reviewItemId = body.reviewItemId ? String(body.reviewItemId).slice(0, 40) : null

  const stepsDone = Math.max(0, Math.min(999, Number(body.stepsDone ?? 0)))
  const totalSteps = Math.max(1, Math.min(999, Number(body.totalSteps ?? 1)))
  const done = Boolean(body.done)
  const level = Math.max(1, Math.min(5, Number(body.level ?? 1)))
  const concepts = sanitizeConcepts(body.concepts)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  const existing = await db.lessonProgress.findUnique({ where: { profileId_lessonId: { profileId: pid, lessonId } } })
  const wasDone = existing?.completed ?? false

  let xpGain = 0
  const prevSteps = existing?.stepsDone ?? 0
  if (stepsDone > prevSteps) xpGain += (stepsDone - prevSteps) * XP_STEP
  if (done && !wasDone) xpGain += XP_LESSON_DONE[level - 1]

  const hintsTotal = (existing?.hintsUsed ?? 0) + (body.hintNow ? 1 : 0)
  const progress = await db.lessonProgress.upsert({
    where: { profileId_lessonId: { profileId: pid, lessonId } },
    update: {
      stepsDone: Math.max(stepsDone, prevSteps),
      totalSteps,
      hintsUsed: hintsTotal,
      completed: wasDone || done,
      completedAt: wasDone ? existing?.completedAt : done ? new Date() : null,
    },
    create: {
      profileId: pid,
      lessonId,
      stepsDone,
      totalSteps,
      hintsUsed: body.hintNow ? 1 : 0,
      completed: done,
      completedAt: done ? new Date() : null,
    },
  })

  if (stepsDone > prevSteps) {
    await bumpActivity(pid, dayKey, 'lessonSteps', stepsDone - prevSteps)
  }

  // First-time completion: feed the skill model and the review queue.
  if (done && !wasDone && concepts.length > 0) {
    const strong = hintsTotal === 0
    await updateMastery(pid, concepts, true)
    const pending = await db.reviewItem.findUnique({ where: { profileId_kind_refId: { profileId: pid, kind: 'lesson', refId: lessonId } } })
    if (pending) {
      // This completion answers a scheduled review of the lesson.
      await gradeReview(pid, pending.id, strong)
      await updateMastery(pid, pending.concept ? [pending.concept] : [], strong)
    } else if (!strong) {
      // Completed with hints: schedule a revisit so it sticks.
      await missReview(pid, 'lesson', lessonId, concepts[0])
    }
  }

  let updated: Profile | null = null
  if (xpGain > 0) {
    const p = await db.profile.findUnique({ where: { id: pid } })
    if (p) updated = await db.profile.update({ where: { id: pid }, data: { xp: p.xp + xpGain } })
  }

  let payload: Record<string, unknown> = { progress, xpGain }
  const full = updated ?? (await db.profile.findUnique({ where: { id: pid } }))
  if (full) {
    const { aiApiKey, ...safe } = full as Record<string, unknown>
    payload = { ...payload, profile: { ...safe, hasApiKey: Boolean(aiApiKey) } }
  }
  return NextResponse.json(payload)
}
