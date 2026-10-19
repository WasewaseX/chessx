// Persist finished Play-with-Coach games (with the engine classification
// trail) and list recent ones for the profile.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

const LABELS = new Set([
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'missedwin', 'blunder', 'forced', 'checkmate', 'unknown',
])

function sanitizeTrail(raw: unknown): string {
  if (!Array.isArray(raw)) return '[]'
  const out: unknown[] = []
  for (const item of raw.slice(0, 320)) {
    const p = item as Record<string, unknown>
    if (typeof p.san !== 'string' || !p.san) continue
    out.push({
      san: p.san.slice(0, 8),
      color: p.color === 'b' ? 'b' : 'w',
      label: typeof p.label === 'string' && LABELS.has(p.label) ? p.label : 'unknown',
      before: typeof p.before === 'number' ? Math.max(-100, Math.min(100, p.before)) : null,
      after: typeof p.after === 'number' ? Math.max(-100, Math.min(100, p.after)) : null,
      bestSan: typeof p.bestSan === 'string' ? p.bestSan.slice(0, 8) : null,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : undefined,
      cpl: typeof p.cpl === 'number' ? Math.max(0, Math.min(2000, p.cpl)) : null,
    })
  }
  return JSON.stringify(out)
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const coachId = typeof body.coachId === 'string' ? body.coachId.slice(0, 32) : ''
  const elo = typeof body.elo === 'number' ? Math.max(400, Math.min(2400, Math.round(body.elo))) : NaN
  const color = body.color === 'b' ? 'b' : 'w'
  const result = ['win', 'loss', 'draw'].includes(String(body.result)) ? String(body.result) : ''
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 120) : null
  const pgn = typeof body.pgn === 'string' ? body.pgn.slice(0, 16_000) : ''
  const accuracy = typeof body.accuracy === 'number' ? Math.max(0, Math.min(100, body.accuracy)) : null

  if (!coachId || Number.isNaN(elo) || !result || !pgn) {
    return NextResponse.json({ error: 'coachId, elo, result and pgn required' }, { status: 400 })
  }

  const game = await db.coachGame.create({
    data: {
      profileId: profile.id,
      coachId,
      coachElo: elo,
      color,
      result,
      reason,
      pgn,
      movesJson: sanitizeTrail(body.trail),
      accuracy,
    },
  })
  return NextResponse.json({ id: game.id })
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ games: [] })

  const games = await db.coachGame.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      coachId: true,
      coachElo: true,
      color: true,
      result: true,
      reason: true,
      accuracy: true,
      movesJson: true,
      createdAt: true,
    },
  })

  // Label counts ride along per game so the UI can show a mini summary.
  return NextResponse.json({
    games: games.map((g) => {
      let counts: Record<string, number> = {}
      try {
        const plies = JSON.parse(g.movesJson) as { color: string; label: string }[]
        counts = plies
          .filter((p) => p.color === g.color)
          .reduce<Record<string, number>>((acc, p) => {
            acc[p.label] = (acc[p.label] ?? 0) + 1
            return acc
          }, {})
      } catch {
        counts = {}
      }
      return { ...g, movesJson: undefined, labelCounts: counts }
    }),
  })
}
