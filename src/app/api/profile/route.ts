import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { seedForSkill } from '@/lib/rating'
import { publicProfile } from '@/lib/api'

export const dynamic = 'force-dynamic'

// One Elo row per account (pool 'overall'). Created the moment the player
// picks a level during onboarding so the account carries its starting rating
// from day one, exactly like chess.com shows a rating after signup.
export async function ensureRatingRow(userId: string, skillLevel: string) {
  const existing = await db.userRating.findUnique({
    where: { userId_pool: { userId, pool: 'overall' } },
  })
  if (existing) return existing
  return db.userRating.create({
    data: { userId, pool: 'overall', rating: seedForSkill(skillLevel) },
  })
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) {
    profile = await db.profile.create({
      data: { userId: user.id, name: user.username },
    })
  }
  const ratings = await db.userRating.findMany({ where: { userId: user.id } })
  // self-heal: a rating outside 100..3500 is corrupt data from an older build,
  // never a real result. Repair to the skill seed instead of showing an
  // impossible number.
  for (const r of ratings) {
    if (r.rating > 3500 || r.rating < 100) {
      const fixed = await db.userRating.update({
        where: { id: r.id },
        data: { rating: seedForSkill(profile.skillLevel), rd: 350 },
      })
      Object.assign(r, fixed)
    }
  }
  return NextResponse.json({
    profile: publicProfile(profile),
    ratings: ratings.map(publicRating),
  })
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  const strFields = ['name', 'skillLevel', 'coach', 'theme', 'darkMode', 'aiProvider', 'aiBaseUrl', 'aiModel', 'aiApiKey']
  const boolFields = ['soundEnabled', 'showCoords', 'showLegal', 'autoPromote', 'onboarded']
  for (const f of strFields) {
    if (f in body) {
      if (f === 'aiApiKey' && (body[f] === null || body[f] === '')) data.aiApiKey = null
      else if (f === 'aiBaseUrl' && body[f] === '') data.aiBaseUrl = null
      else if (f === 'aiModel' && body[f] === '') data.aiModel = null
      else data[f] = String(body[f]).slice(0, 300)
    }
  }
  for (const f of boolFields) if (f in body) data[f] = Boolean(body[f])
  if ('goalMinutes' in body) {
    const g = Number(body.goalMinutes)
    if (Number.isFinite(g)) data.goalMinutes = Math.max(5, Math.min(120, Math.round(g)))
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) {
    profile = await db.profile.create({ data: { userId: user.id, name: user.username, ...data } })
  } else {
    profile = await db.profile.update({ where: { id: profile.id }, data })
  }
  // the level pick during onboarding seeds the account Elo (400 / 800 / 1200
  // / 1600 / 2000, the chess.com ladder); only runs if no row exists yet
  const skill = (data.skillLevel as string | undefined) ?? profile.skillLevel
  await ensureRatingRow(user.id, skill)
  const ratings = await db.userRating.findMany({ where: { userId: user.id } })
  return NextResponse.json({
    profile: publicProfile(profile),
    ratings: ratings.map(publicRating),
  })
}

function publicRating(r: { pool: string; rating: number; rd: number; games: number; wins: number; losses: number; draws: number }) {
  return {
    pool: r.pool,
    rating: Math.round(r.rating),
    rd: Math.round(r.rd),
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
  }
}
