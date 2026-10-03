import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { XP_STEP, XP_LESSON_DONE } from '@/lib/rating'

export async function GET() {
  const progress = await db.lessonProgress.findMany()
  return NextResponse.json({ progress })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const lessonId = String(body.lessonId ?? '')
  if (!lessonId) return NextResponse.json({ error: 'lessonId required' }, { status: 400 })

  const stepsDone = Math.max(0, Math.min(999, Number(body.stepsDone ?? 0)))
  const totalSteps = Math.max(1, Math.min(999, Number(body.totalSteps ?? 1)))
  const done = Boolean(body.done)
  const level = Math.max(1, Math.min(5, Number(body.level ?? 1)))

  const existing = await db.lessonProgress.findUnique({ where: { lessonId } })
  const wasDone = existing?.completed ?? false

  let xpGain = 0
  const prevSteps = existing?.stepsDone ?? 0
  if (stepsDone > prevSteps) xpGain += (stepsDone - prevSteps) * XP_STEP
  if (done && !wasDone) xpGain += XP_LESSON_DONE[level - 1]

  const progress = await db.lessonProgress.upsert({
    where: { lessonId },
    update: {
      stepsDone: Math.max(stepsDone, prevSteps),
      totalSteps,
      hintsUsed: (existing?.hintsUsed ?? 0) + (body.hintNow ? 1 : 0),
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
