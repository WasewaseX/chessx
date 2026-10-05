import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ user: null }, { status: 401 })

  const [profile, ratings] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.userRating.findMany({ where: { userId: user.id } }),
  ])

  return NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
    profile,
    ratings: ratings.map((r) => ({
      pool: r.pool,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
    })),
  })
}
