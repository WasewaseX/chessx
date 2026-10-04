import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { XP_STEP, XP_LESSON_DONE } from '@/lib/rating'
import { bumpActivity, gradeReview, missReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'

export async function GET() {
  const progress = await db.lessonProgress.findMany()
  return NextResponse.json({ progress })
}

export async function POST(req: NextRequest) {
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

  const existing = await db.lessonProgress.findUnique({ where: { lessonId } })
  const wasDone = existing?.completed ?? false

  let xpGain = 0
  const prevSteps = existing?.stepsDone ?? 0
  if (stepsDone > prevSteps) xpGain += (stepsDone - prevSteps) * XP_STEP
  if (done && !wasDone) xpGain += XP_LESSON_DONE[level - 1]

  const hintsTotal = (existing?.hintsUsed ?? 0) + (body.hintNow ? 1 : 0)
  const progress = await db.lessonProgress.upsert({
    where: { lessonId },
    update: {
      stepsDone: Math.max(stepsDone, prevSteps),
      totalSteps,
      hintsUsed: hintsTotal,
      completed: wasDone || done,
      completedAt: wasDone ? existing?.completedAt : done ? new Date() : null,
    },
    create: {
      lessonId,
      stepsDone,
      totalSteps,
      hintsUsed: body.hintNow ? 1 : 0,
      completed: done,
      completedAt: done ? new Date() : null,
    },
  })

  if (stepsDone > prevSteps) {
    await bumpActivity(dayKey, 'lessonSteps', stepsDone - prevSteps)
  }

  // First-time completion: feed the skill model and the review queue.
  if (done && !wasDone && concepts.length > 0) {
    const strong = hintsTotal === 0
    await updateMastery(concepts, true)
    const pending = await db.reviewItem.findUnique({ where: { kind_refId: { kind: 'lesson', refId: lessonId } } })
    if (pending) {
      // This completion answers a scheduled review of the lesson.
      await gradeReview(pending.id, strong)
      await updateMastery(pending.concept ? [pending.concept] : [], strong)
    } else if (!strong) {
      // Completed with hints: schedule a revisit so it sticks.
      await missReview('lesson', lessonId, concepts[0])
    }
  }

  let updated = null
  if (xpGain > 0) {
    const p = await db.profile.findUnique({ where: { id: 'me' } })
    if (p) updated = await db.profile.update({ where: { id: 'me' }, data: { xp: p.xp + xpGain } })
  }

  let payload: Record<string, unknown> = { progress, xpGain }
  const full = updated ?? (await db.profile.findUnique({ where: { id: 'me' } }))
  if (full) {
    const { aiApiKey, ...safe } = full as Record<string, unknown>
    payload = { ...payload, profile: { ...safe, hasApiKey: Boolean(aiApiKey) } }
  }
  return NextResponse.json(payload)
}
