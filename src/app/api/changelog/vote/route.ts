// Suggestion votes — one vote per profile per suggestion, toggle style.
//
//  POST /api/changelog/vote  { suggestionId }
//         signed-in only (votes are keyed by profile id). Pressing again
//         removes the vote. The denormalized FeatureSuggestion.votes is
//         rewritten from the exact vote-row count after every toggle, so it
//         cannot drift. Returns the fresh { votes, viewerVoted }.
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'

const cleanStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to vote' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`changelog-vote:${pid}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }
  const suggestionId = cleanStr(body.suggestionId, 40)
  if (!suggestionId) return NextResponse.json({ error: 'suggestionId required' }, { status: 400 })

  const suggestion = await db.featureSuggestion.findUnique({
    where: { id: suggestionId },
    select: { id: true },
  })
  if (!suggestion) return NextResponse.json({ error: 'no such suggestion' }, { status: 404 })

  const existing = await db.suggestionVote.findUnique({
    where: { suggestionId_voterKey: { suggestionId, voterKey: pid } },
  })
  if (existing) {
    await db.suggestionVote.delete({ where: { id: existing.id } })
  } else {
    await db.suggestionVote
      .create({ data: { suggestionId, voterKey: pid } })
      // a racing vote created the row first — treat it as the vote landing
      .catch((err) => {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
      })
  }

  // rewrite the tally from the authoritative row count (no drift)
  const votes = await db.suggestionVote.count({ where: { suggestionId } })
  await db.featureSuggestion.update({ where: { id: suggestionId }, data: { votes } })

  return NextResponse.json({ votes, viewerVoted: !existing })
}
