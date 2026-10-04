import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newRating, seedForSkill } from '@/lib/rating'
import { bumpActivity, gradeReview, missReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'
import { PUZZLES } from '@/content/puzzles'
import { dayKeyLocal } from '@/lib/day'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const puzzleId = String(body.puzzleId ?? '').slice(0, 60)
  const kindRaw = String(body.kind ?? 'rated')
  const kind = kindRaw === 'daily' || kindRaw === 'review' ? kindRaw : 'rated'
  const solved = Boolean(body.solved)
  const puzzleRating = Math.max(100, Math.min(3000, Number(body.puzzleRating ?? 1000)))
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  const reviewItemId = body.reviewItemId ? String(body.reviewItemId).slice(0, 40) : null

  if (!puzzleId) return NextResponse.json({ error: 'puzzleId required' }, { status: 400 })

  const puzzle = PUZZLES.find((p) => p.id === puzzleId)
  const themes = sanitizeConcepts(puzzle?.themes)

  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  // Review attempts never move the puzzle rating, the streak or XP.
  if (kind === 'review') {
    await db.puzzleAttempt.create({ data: { puzzleId, kind, solved, ratingDelta: null, dayKey } })
    await updateMastery(themes, solved)
    let graded = null
    if (reviewItemId) graded = await gradeReview(reviewItemId, solved)
    else if (!solved) await missReview('puzzle', puzzleId)
    if (solved) await bumpActivity(dayKey, 'puzzlesSolved', 1)
    const updated = await db.profile.findUnique({ where: { id: 'me' } })
    return NextResponse.json({ attempt: { kind, solved }, profile: updated, ratingDelta: 0, xpGain: 0, graded })
  }

  const current = profile.puzzleRating ?? seedForSkill(profile.skillLevel)
  const score = solved ? 1 : 0
  const { rating, delta } = newRating(current, puzzleRating, score, profile.puzzleCount, 32, 64)

  const streak = solved ? profile.puzzleStreak + 1 : 0
  const xpGain = solved ? 10 + Math.min(streak, 10) : 0

  await db.profile.update({
    where: { id: 'me' },
    data: {
      puzzleRating: rating,
      puzzleCount: profile.puzzleCount + 1,
      puzzleStreak: streak,
      bestPuzzleStreak: Math.max(profile.bestPuzzleStreak, streak),
      puzzleSolved: profile.puzzleSolved + (solved ? 1 : 0),
      puzzleFailed: profile.puzzleFailed + (solved ? 0 : 1),
      xp: profile.xp + xpGain,
      dailyDoneDate: kind === 'daily' && solved ? dayKey : profile.dailyDoneDate,
    },
  })

  const attempt = await db.puzzleAttempt.create({
    data: { puzzleId, kind, solved, ratingDelta: delta, dayKey },
  })

  // Skill model + spaced repetition bookkeeping.
  await updateMastery(themes, solved)
  if (solved) {
    await bumpActivity(dayKey, 'puzzlesSolved', 1)
    // If this puzzle was waiting in the review queue, facing it here counts.
    const pending = await db.reviewItem.findUnique({ where: { kind_refId: { kind: 'puzzle', refId: puzzleId } } })
    if (pending && pending.dueAt <= new Date(Date.now() + 36 * 60 * 60 * 1000)) {
      await gradeReview(pending.id, true)
    }
  } else {
    await missReview('puzzle', puzzleId)
  }

  const updated = await db.profile.findUnique({ where: { id: 'me' } })
  return NextResponse.json({ attempt, profile: updated, ratingDelta: delta, xpGain })
}
