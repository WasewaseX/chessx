import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { bumpActivity } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { expectedScore, seedForSkill } from '@/lib/rating'

// Chess.com's estimated Elo for bot play: standard Elo (K=32) against each
// bot's fixed rating, seeded from the self-assessed level, floored at 100.
const BOT_ELO_K = 32

function nextBotElo(current: number, gamesPlayed: number, seed: number, botRating: number, score: number) {
  const base = gamesPlayed > 0 ? current : seed
  const exp = expectedScore(base, botRating)
  const delta = Math.round(BOT_ELO_K * (score - exp))
  return { rating: Math.max(100, base + delta), delta }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20))
  const [botGames, onlineGames] = await Promise.all([
    db.gameRecord.findMany({ where: { profileId: pid }, orderBy: { createdAt: 'desc' }, take: limit }),
    // finished rated/casual online games this account played in
    db.onlineGame.findMany({
      where: { OR: [{ whiteId: user.id }, { blackId: user.id }], result: { not: '*' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ])

  // one shape for both sources, from the player's perspective
  const botRows = botGames.map((g) => ({
    id: g.id,
    kind: 'bot',
    pool: null,
    color: g.color,
    opponent: g.botName,
    rated: g.rated,
    result: g.result,
    reason: g.reason,
    ratingDelta: g.ratingDelta,
    pgn: g.pgn,
    createdAt: g.createdAt,
  }))
  const onlineRows = onlineGames.map((g) => {
    const iAmWhite = g.whiteId === user.id
    const myScore =
      g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === iAmWhite ? 'win' : 'loss'
    return {
      id: g.id,
      kind: 'online',
      pool: g.pool,
      initialSec: g.initialSec,
      incSec: g.incSec,
      color: iAmWhite ? 'w' : 'b',
      opponent: iAmWhite ? g.blackName : g.whiteName,
      rated: g.rated,
      result: myScore,
      reason: g.termination ?? 'finished',
      ratingDelta: (iAmWhite ? g.whiteDelta : g.blackDelta) ?? null,
      pgn: g.pgn,
      createdAt: g.endedAt ?? g.createdAt,
    }
  })

  const games = [...botRows, ...onlineRows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)

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
  const botLevel = Math.max(1, Math.min(20, Number(body.botLevel ?? 1)))
  const botName = String(body.botName ?? 'Bot').slice(0, 40)
  const rated = Boolean(body.rated)
  const result = ['win', 'loss', 'draw'].includes(body.result) ? body.result : 'draw'
  const reason = String(body.reason ?? 'checkmate').slice(0, 30)
  const pgn = String(body.pgn ?? '').slice(0, 20000)
  const finalFen = String(body.finalFen ?? '').slice(0, 100)
  const moveCount = Math.max(0, Math.min(1000, Number(body.moveCount ?? 0)))
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  // the fixed est. rating of the bot faced, used for the Elo update
  const botRating = Math.max(100, Math.min(3200, Number(body.botRating ?? 0)))

  // Estimated Elo from bot play, chess.com style: casual never touches the
  // real Glicko pools, but every bot result moves the estimate with K=32 Elo.
  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
  const est = botRating > 0
    ? nextBotElo(profile.botElo, profile.botEloGames, seedForSkill(profile.skillLevel), botRating, score)
    : null

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
      ratingDelta: est ? est.delta : null,
    },
  })

  // XP for playing: modest, win-weighted
  let xpGain = 0
  if (result === 'win') xpGain = 20
  else if (result === 'draw') xpGain = 10
  const data: {
    botGames: number
    xp?: number
    botElo?: number
    botEloGames?: number
  } = { botGames: profile.botGames + 1 }
  if (xpGain > 0) data.xp = profile.xp + xpGain
  if (est) {
    data.botElo = est.rating
    data.botEloGames = profile.botEloGames + 1
  }
  await db.profile.update({ where: { id: pid }, data })

  await bumpActivity(pid, dayKey, 'gamesPlayed', 1)

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({ record, profile: updated, xpGain, estElo: est?.rating ?? null, estDelta: est?.delta ?? null })
}
