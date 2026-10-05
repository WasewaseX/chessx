import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { bumpActivity } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20))
  const games = await db.gameRecord.findMany({
    where: { profileId: pid },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ games })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

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
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  // Bot games are casual and unrated by design: no rating math, the profile
  // only counts how many were played.
  const record = await db.gameRecord.create({
    data: {
      profileId: pid,
      color,
      botLevel,
      botName,
      rated,
      result,
      reason,
      pgn,
      finalFen,
      moveCount,
      ratingDelta: null,
    },
  })

  // XP for playing: modest, win-weighted
  let xpGain = 0
  if (result === 'win') xpGain = 20
  else if (result === 'draw') xpGain = 10
  const data: { botGames: number; xp?: number } = { botGames: profile.botGames + 1 }
  if (xpGain > 0) data.xp = profile.xp + xpGain
  await db.profile.update({ where: { id: pid }, data })

  await bumpActivity(pid, dayKey, 'gamesPlayed', 1)

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({ record, profile: updated, xpGain })
}
