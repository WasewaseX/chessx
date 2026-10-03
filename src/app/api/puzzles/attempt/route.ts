import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newRating, seedForSkill } from '@/lib/rating'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const puzzleId = String(body.puzzleId ?? '').slice(0, 60)
  const kind = body.kind === 'daily' ? 'daily' : 'rated'
  const solved = Boolean(body.solved)
  const puzzleRating = Math.max(100, Math.min(3000, Number(body.puzzleRating ?? 1000)))
  const dayKey = body.dayKey ? String(body.dayKey).slice(0, 10) : null

  if (!puzzleId) return NextResponse.json({ error: 'puzzleId required' }, { status: 400 })

  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

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

  const updated = await db.profile.findUnique({ where: { id: 'me' } })
  return NextResponse.json({ attempt, profile: updated, ratingDelta: delta, xpGain })
}
