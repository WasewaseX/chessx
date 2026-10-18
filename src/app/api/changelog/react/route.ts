// Changelog reactions — one emoji per viewer per entry, auth optional.
//
//  POST /api/changelog/react  { entryId, emoji }   emoji ∈ 🎉 ❤️ 🧠 🐸
//
// Identity: the userId when signed in, else sha256(ip + server salt) so the
// database never stores a raw address. Toggle semantics: pressing the same
// emoji again removes the reaction; pressing a different one while a reaction
// exists switches it in place (the (entryId, voterKey) unique allows exactly
// one row). Returns the updated counts plus the viewer's own emoji.
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import {
  REACTION_EMOJIS,
  isReactionEmoji,
  reactionCountsFor,
  reactionVoterKey,
  myReactionsFor,
  emptyReactionCounts,
} from '@/lib/server/whatsnew'

const cleanStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  const voterKey = reactionVoterKey(req, user)

  if (!rateLimit(`changelog-react:${voterKey}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }
  const entryId = cleanStr(body.entryId, 40)
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })
  if (!isReactionEmoji(body.emoji)) {
    return NextResponse.json(
      { error: `emoji must be one of: ${REACTION_EMOJIS.join(' ')}` },
      { status: 400 },
    )
  }
  const emoji = body.emoji

  const entry = await db.changelogEntry.findUnique({ where: { id: entryId }, select: { id: true } })
  if (!entry) return NextResponse.json({ error: 'no such entry' }, { status: 404 })

  const existing = await db.changelogReaction.findUnique({
    where: { entryId_voterKey: { entryId, voterKey } },
  })
  if (existing && existing.emoji === emoji) {
    await db.changelogReaction.delete({ where: { id: existing.id } })
  } else if (existing) {
    await db.changelogReaction.update({ where: { id: existing.id }, data: { emoji } })
  } else {
    await db.changelogReaction
      .create({ data: { entryId, voterKey, emoji } })
      // a racing request created the row first — its toggle already counts
      .catch((err) => {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
      })
  }

  const [counts, mine] = await Promise.all([
    reactionCountsFor([entryId]),
    myReactionsFor([entryId], voterKey),
  ])
  return NextResponse.json({
    reactions: counts.get(entryId) ?? emptyReactionCounts(),
    mine: mine.get(entryId) ?? [],
  })
}
