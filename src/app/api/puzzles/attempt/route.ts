import { NextRequest, NextResponse } from 'next/server'
import type { ReviewItem } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { newRating, seedForSkill, clampRating } from '@/lib/rating'
import { bumpActivity, gradeReview, missReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { PUZZLES } from '@/content/puzzles'
import { dayKeyLocal } from '@/lib/day'
import { dailyPuzzleIdFor, publicProfile } from '@/lib/api'

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  const puzzleId = String(body.puzzleId ?? '').slice(0, 60)
  const kindRaw = String(body.kind ?? 'rated')
  const kind = kindRaw === 'daily' || kindRaw === 'review' ? kindRaw : 'rated'
  const solved = Boolean(body.solved)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  const reviewItemId = body.reviewItemId ? String(body.reviewItemId).slice(0, 40) : null

  if (!puzzleId) return NextResponse.json({ error: 'puzzleId required' }, { status: 400 })

  const puzzle = PUZZLES.find((p) => p.id === puzzleId)
  // the Elo opponent is the puzzle's own rating from content; the request
  // body never gets a say in it
  const puzzleRating = puzzle?.rating ?? 1000
  const themes = sanitizeConcepts(puzzle?.themes)

  // Review attempts never move the puzzle rating, the streak or XP.
  if (kind === 'review') {
    await db.puzzleAttempt.create({ data: { profileId: pid, puzzleId, kind, solved, ratingDelta: null, dayKey } })
    await updateMastery(pid, themes, solved)
    let graded: ReviewItem | null = null
    if (reviewItemId) graded = await gradeReview(pid, reviewItemId, solved)
    else if (!solved) await missReview(pid, 'puzzle', puzzleId)
    if (solved) await bumpActivity(pid, dayKey, 'puzzlesSolved', 1)
    const updated = await db.profile.findUnique({ where: { id: pid } })
    return NextResponse.json({ attempt: { kind, solved }, profile: updated ? publicProfile(updated) : null, ratingDelta: 0, xpGain: 0, graded })
  }

  const current = profile.puzzleRating ?? seedForSkill(profile.skillLevel)
  const score = solved ? 1 : 0
  const { rating, delta } = newRating(current, puzzleRating, score, profile.puzzleCount, 32, 64)
  // every rating lives in the 100..3500 band; anything else is corrupt
  const ratingSafe = clampRating(rating)

  const streak = solved ? profile.puzzleStreak + 1 : 0
  const xpGain = solved ? 10 + Math.min(streak, 10) : 0

  // Daily credit only when the attempt really is the puzzle that day owns.
  const dailyDone = kind === 'daily' && solved && puzzleId === dailyPuzzleIdFor(dayKey)

  // Counters move with atomic increments so racing attempts never lose or
  // double-count an event.
  await db.profile.update({
    where: { id: pid },
    data: {
      puzzleRating: ratingSafe,
      puzzleCount: { increment: 1 },
      puzzleStreak: solved ? { increment: 1 } : 0,
      bestPuzzleStreak: Math.max(profile.bestPuzzleStreak, streak),
      ...(solved ? { puzzleSolved: { increment: 1 } } : { puzzleFailed: { increment: 1 } }),
      ...(xpGain > 0 ? { xp: { increment: xpGain } } : {}),
      dailyDoneDate: dailyDone ? dayKey : profile.dailyDoneDate,
    },
  })

  const attempt = await db.puzzleAttempt.create({
    data: { profileId: pid, puzzleId, kind, solved, ratingDelta: delta, dayKey },
  })

  // Skill model + spaced repetition bookkeeping.
  await updateMastery(pid, themes, solved)
  if (solved) {
    await bumpActivity(pid, dayKey, 'puzzlesSolved', 1)
    // If this puzzle was waiting in the review queue, facing it here counts.
    const pending = await db.reviewItem.findUnique({ where: { profileId_kind_refId: { profileId: pid, kind: 'puzzle', refId: puzzleId } } })
    if (pending && pending.dueAt <= new Date(Date.now() + 36 * 60 * 60 * 1000)) {
      await gradeReview(pid, pending.id, true)
    }
  } else {
    await missReview(pid, 'puzzle', puzzleId)
  }

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({ attempt, profile: updated ? publicProfile(updated) : null, ratingDelta: delta, xpGain })
}
