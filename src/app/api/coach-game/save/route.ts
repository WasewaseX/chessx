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
  // 'unfinished' marks an in-progress autosave row the setup screen offers as
  // resumable; win/loss/draw finalize it. Anything else is a client bug.
  const result = ['win', 'loss', 'draw', 'unfinished'].includes(String(body.result)) ? String(body.result) : ''
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 120) : null
  const pgn = typeof body.pgn === 'string' ? body.pgn.slice(0, 16_000) : ''
  const accuracy = typeof body.accuracy === 'number' ? Math.max(0, Math.min(100, body.accuracy)) : null
  const resumeId = typeof body.id === 'string' && body.id.length > 0 && body.id.length < 64 ? body.id : null

  if (!coachId || Number.isNaN(elo) || !result || !pgn) {
    return NextResponse.json({ error: 'coachId, elo, result and pgn required' }, { status: 400 })
  }

  const data = {
    coachId,
    coachElo: elo,
    color,
    result,
    reason,
    pgn,
    movesJson: sanitizeTrail(body.trail),
    accuracy,
  }

  // A resumable row is updated in place: the autosave rewrites the same row
  // as the trail grows, and the final result finalizes it — one row per game.
  if (resumeId) {
    const existing = await db.coachGame.findFirst({
      where: { id: resumeId, profileId: profile.id, result: 'unfinished' },
      select: { id: true },
    })
    if (existing) {
      await db.coachGame.update({ where: { id: existing.id }, data })
      return NextResponse.json({ id: existing.id })
    }
    // A stale or foreign id falls through to a fresh row: never error a move.
  }

  const game = await db.coachGame.create({ data: { profileId: profile.id, ...data } })
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
      pgn: true,
      createdAt: true,
    },
  })

  // Label counts ride along per game so the UI can show a mini summary.
  // Unfinished rows carry their PGN + full trail — that is what "Resume"
  // replays: position, labels and evals come back exactly as left.
  return NextResponse.json({
    games: games.map((g) => {
      let counts: Record<string, number> = {}
      let trail: unknown = undefined
      try {
        const plies = JSON.parse(g.movesJson) as { color: string; label: string }[]
        counts = plies
          .filter((p) => p.color === g.color)
          .reduce<Record<string, number>>((acc, p) => {
            acc[p.label] = (acc[p.label] ?? 0) + 1
            return acc
          }, {})
        if (g.result === 'unfinished') trail = plies
      } catch {
        counts = {}
      }
      return {
        ...g,
        movesJson: undefined,
        pgn: g.result === 'unfinished' ? g.pgn : undefined,
        trail,
        labelCounts: counts,
      }
    }),
  })
}

/** Discard an unfinished coaching game (the setup screen's "Delete"). */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // deleteMany with the profile guard: ownership check and delete in one step.
  const gone = await db.coachGame.deleteMany({ where: { id, profileId: profile.id, result: 'unfinished' } })
  if (gone.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
