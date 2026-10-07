import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit } from '@/lib/auth'
import { bumpActivity } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { expectedScore, seedForSkill } from '@/lib/rating'
import { numOr, publicProfile } from '@/lib/api'

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

  const limit = numOr(req.nextUrl.searchParams.get('limit'), 20, 1, 50)
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

  // Modest flood guard: 30 recorded bot games per profile per hour.
  if (!rateLimit(`games:${pid}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many games recorded, try again soon' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const color = body.color === 'b' ? 'b' : 'w'
  const botLevel = numOr(body.botLevel, 1, 1, 20)
  const botName = String(body.botName ?? 'Bot').slice(0, 40)
  const rated = Boolean(body.rated)
  const result = ['win', 'loss', 'draw'].includes(body.result) ? body.result : 'draw'
  const reason = String(body.reason ?? 'checkmate').slice(0, 30)
  const pgn = String(body.pgn ?? '').slice(0, 20000)
  const finalFen = String(body.finalFen ?? '').slice(0, 100)
  const moveCount = numOr(body.moveCount, 0, 0, 1000)
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()
  // the fixed est. rating of the bot faced, used for the Elo update
  const botRating = numOr(body.botRating, 0, 100, 3200)

  // A claimed win must carry the game that produced it: no moves and no PGN,
  // no record and no XP.
  if (result === 'win' && (moveCount <= 0 || pgn.trim().length === 0)) {
    return NextResponse.json({ error: 'win requires the finished game' }, { status: 400 })
  }

  // Estimated Elo from bot play, chess.com style: casual never touches the
  // real Glicko pools, but every bot result moves the estimate with K=32 Elo.
  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
  const est = botRating > 0
    ? nextBotElo(profile.botElo, profile.botEloGames, seedForSkill(profile.skillLevel), botRating, score)
    : null
  // the estimate lives in the same band as every real rating; a value past
  // 3500 is corrupt, never a real result
  const estClamped = est ? { rating: Math.min(3500, Math.max(100, est.rating)), delta: est.delta } : null

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
      ratingDelta: est ? estClamped!.delta : null,
    },
  })

  // XP for playing: modest, win-weighted. Counters move with atomic
  // increments so racing requests never lose or double-count a game.
  let xpGain = 0
  if (result === 'win') xpGain = 20
  else if (result === 'draw') xpGain = 10
  const data: {
    botGames: { increment: number }
    xp?: { increment: number }
    botElo?: number
    botEloGames?: { increment: number }
  } = { botGames: { increment: 1 } }
  if (xpGain > 0) data.xp = { increment: xpGain }
  if (est) {
    data.botElo = estClamped!.rating
    data.botEloGames = { increment: 1 }
  }
  await db.profile.update({ where: { id: pid }, data })

  await bumpActivity(pid, dayKey, 'gamesPlayed', 1)

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({ record, profile: updated ? publicProfile(updated) : null, xpGain, estElo: estClamped?.rating ?? null, estDelta: estClamped?.delta ?? null })
}
