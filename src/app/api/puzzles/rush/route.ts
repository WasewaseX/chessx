import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PUZZLES } from '@/content/puzzles'
import type { Puzzle } from '@/content/schema'
import { bumpActivity } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'

/**
 * GET: Puzzle Rush batch, the whole pool ordered easy to hard with a light
 * shuffle inside same-rating groups so runs do not feel memorized.
 */
export async function GET() {
  const sorted = [...PUZZLES].sort((a, b) => a.rating - b.rating)
  const batch: Puzzle[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && sorted[j].rating === sorted[i].rating) j++
    const group = sorted.slice(i, j)
    for (let k = group.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1))
      ;[group[k], group[r]] = [group[r], group[k]]
    }
    batch.push(...group)
    i = j
  }
  return NextResponse.json({ puzzles: batch, total: batch.length })
}

/** POST: record a finished run, update bests, award capped XP. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'survival' ? 'survival' : 'threeMin'
  const score = Math.max(0, Math.min(200, Number(body.score ?? 0)))
  const total = Math.max(score, Math.min(200, Number(body.total ?? score)))
  const seconds = Math.max(0, Math.min(3600, Number(body.seconds ?? 0)))
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  const previousBest = mode === 'survival' ? profile.rushBestSurvival : profile.rushBest3m
  const isNewBest = score > previousBest

  const run = await db.rushRun.create({
    data: { mode, score, total, seconds, dayKey },
  })

  // Rush rewards solving volume, capped so grinding stays honest.
  const xpGain = Math.min(score * 4, 120)

  await db.profile.update({
    where: { id: 'me' },
    data: {
      xp: profile.xp + xpGain,
      ...(mode === 'survival'
        ? { rushBestSurvival: Math.max(profile.rushBestSurvival, score) }
        : { rushBest3m: Math.max(profile.rushBest3m, score) }),
    },
  })

  await bumpActivity(dayKey, 'puzzlesSolved', score)

  const updated = await db.profile.findUnique({ where: { id: 'me' } })
  return NextResponse.json({ run, profile: updated, xpGain, isNewBest, previousBest })
}
