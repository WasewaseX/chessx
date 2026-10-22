import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit } from '@/lib/auth'

/**
 * The account's Elo journey: the post-game rating after every finished
 * RATED online game, oldest first. Pure projection of OnlineGame rows —
 * no invented points, no backfilling. Bot and puzzle ratings are excluded
 * on purpose: this chart moves only when real rated games move it.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  if (!rateLimit(`rating-hist:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const games = await db.onlineGame.findMany({
    where: {
      OR: [{ whiteId: user.id }, { blackId: user.id }],
      rated: true,
      result: { not: '*' },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      whiteId: true,
      blackId: true,
      whiteRating: true,
      blackRating: true,
      createdAt: true,
    },
  })

  const points = games
    .filter((g) => (g.whiteId === user.id ? g.whiteRating != null : g.blackRating != null))
    .reverse() // oldest first so the chart reads left → right
    .map((g) => ({
      at: g.createdAt.toISOString(),
      rating: (g.whiteId === user.id ? g.whiteRating : g.blackRating) as number,
    }))

  return NextResponse.json(
    {
      points,
      current: points.length ? points[points.length - 1].rating : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
