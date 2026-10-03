import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newRating, seedForSkill } from '@/lib/rating'

export async function GET(req: NextRequest) {
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20))
  const games = await db.gameRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ games })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const color = body.color === 'b' ? 'b' : 'w'
  const botLevel = Math.max(1, Math.min(10, Number(body.botLevel ?? 1)))
  const botName = String(body.botName ?? 'Bot').slice(0, 40)
  const rated = Boolean(body.rated)
  const result = ['win', 'loss', 'draw'].includes(body.result) ? body.result : 'draw'
  const reason = String(body.reason ?? 'checkmate').slice(0, 30)
  const pgn = String(body.pgn ?? '').slice(0, 20000)
  const finalFen = String(body.finalFen ?? '').slice(0, 100)
  const moveCount = Math.max(0, Math.min(1000, Number(body.moveCount ?? 0)))

  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  let ratingDelta: number | null = null
  if (rated) {
    const oppRating = Math.round(100 + botLevel * 210) // bot ladder strength anchor
    const current = profile.ladderRating ?? seedForSkill(profile.skillLevel)
    const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
    const { rating, delta } = newRating(current, oppRating, score, profile.ladderCount, 24, 48)
    ratingDelta = delta
    await db.profile.update({
      where: { id: 'me' },
      data: { ladderRating: rating, ladderCount: profile.ladderCount + 1 },
    })
  }

  // XP for playing: modest, win-weighted
  let xpGain = 0
  if (result === 'win') xpGain = 20
  else if (result === 'draw') xpGain = 10
  if (xpGain > 0) {
    await db.profile.update({ where: { id: 'me' }, data: { xp: profile.xp + xpGain } })
  }

  const record = await db.gameRecord.create({
    data: {
      color,
      botLevel,
      botName,
      rated,
      result,
      reason,
      pgn,
      finalFen,
      moveCount,
      ratingDelta,
    },
  })

  const updated = await db.profile.findUnique({ where: { id: 'me' } })
  return NextResponse.json({ record, profile: updated, xpGain })
}
