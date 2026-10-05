import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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
  const ratings = await db.userRating.findMany({ where: { userId: user.id } })
  return NextResponse.json({
    profile: publicProfile(profile),
    ratings: ratings.map(publicRating),
  })
}

function publicProfile(p: Record<string, unknown>) {
  // never send the raw API key to the client, only whether one exists
  const { aiApiKey, ...rest } = p as { aiApiKey?: string | null }
  return { ...rest, hasApiKey: Boolean(aiApiKey) }
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
