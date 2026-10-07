import { NextRequest, NextResponse } from 'next/server'
import type { Profile } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { XP_STEP, XP_LESSON_DONE } from '@/lib/rating'
import { bumpActivity, gradeReview, missReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { findLevel } from '@/content/levels'
import { numOr, publicProfile } from '@/lib/api'

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

  // Lesson facts come from content, never from the request: unknown lessons
  // are rejected and the step count is bounded by the real lesson length.
  const lesson = findLevel(lessonId)
  if (!lesson) return NextResponse.json({ error: 'unknown lessonId' }, { status: 400 })
  const totalSteps = lesson.level.steps.length
  const stepsDone = numOr(body.stepsDone, 0, 0, totalSteps)
  const done = Boolean(body.done)
  // the completion XP tier follows the lesson's own tier, bounded by the XP table
  const level = Math.min(XP_LESSON_DONE.length, Math.max(1, lesson.tier.n))
  const concepts = sanitizeConcepts(body.concepts)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  const existing = await db.lessonProgress.findUnique({ where: { profileId_lessonId: { profileId: pid, lessonId } } })
  const prevSteps = existing?.stepsDone ?? 0

  // Make sure the row exists, then move it with guarded atomic writes so
  // concurrent requests can never double-grant or lose progress.
  await db.lessonProgress.upsert({
    where: { profileId_lessonId: { profileId: pid, lessonId } },
    update: {},
    create: { profileId: pid, lessonId, totalSteps },
  })

  // Steps form a ratchet: step XP is earned only by the request whose write
  // actually advances the stored value.
  let stepXp = 0
  if (stepsDone > prevSteps) {
    const bumped = await db.lessonProgress.updateMany({
      where: { profileId: pid, lessonId, stepsDone: { lt: stepsDone } },
      data: { stepsDone, totalSteps },
    })
    if (bumped.count === 1) stepXp = (stepsDone - prevSteps) * XP_STEP
  }

  if (body.hintNow) {
    await db.lessonProgress.updateMany({
      where: { profileId: pid, lessonId },
      data: { hintsUsed: { increment: 1 } },
    })
  }

  // First-time completion flips the flag atomically, so exactly one racing
  // request wins the completion bonus.
  let firstDone = false
  if (done) {
    const flipped = await db.lessonProgress.updateMany({
      where: { profileId: pid, lessonId, completed: false },
      data: { completed: true, completedAt: new Date() },
    })
    firstDone = flipped.count === 1
  }

  const progress = await db.lessonProgress.findUnique({ where: { profileId_lessonId: { profileId: pid, lessonId } } })

  if (stepsDone > prevSteps) {
    await bumpActivity(pid, dayKey, 'lessonSteps', stepsDone - prevSteps)
  }

  // First-time completion: feed the skill model and the review queue.
  if (firstDone && concepts.length > 0) {
    const hintsTotal = (existing?.hintsUsed ?? 0) + (body.hintNow ? 1 : 0)
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

  const xpGain = stepXp + (firstDone ? XP_LESSON_DONE[level - 1] : 0)
  let updated: Profile | null = null
  if (xpGain > 0) {
    updated = await db.profile.update({ where: { id: pid }, data: { xp: { increment: xpGain } } })
  }

  let payload: Record<string, unknown> = { progress, xpGain }
  const full = updated ?? (await db.profile.findUnique({ where: { id: pid } }))
  if (full) {
    payload = { ...payload, profile: publicProfile(full) }
  }
  return NextResponse.json(payload)
}
