import { NextRequest, NextResponse } from 'next/server'
import { PUZZLES } from '@/content/puzzles'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { dailyPuzzleIndex } from '@/lib/api'
import { lichessAvailable, lichessDaily } from '@/lib/server/lichess-bank'

// The deterministic rotation itself lives in src/lib/api.ts so the attempt
// route validates daily completions against the very same pick.

function daysSinceEpoch(dayKey: string): number {
  const d = new Date(dayKey + 'T00:00:00Z')
  return Math.floor(d.getTime() / 86400000)
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const dayKey = req.nextUrl.searchParams.get('day') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return NextResponse.json({ error: 'bad day param' }, { status: 400 })
  }
  // The Lichess bank serves the daily when installed (deterministic per
  // dayKey — the same position for everyone, from the 5M+ real-game pool).
  let full: { id: string; fen: string; rating: number } | undefined
  if (lichessAvailable()) {
    const lp = lichessDaily(dayKey)
    if (lp) full = { id: lp.id, fen: lp.fen, rating: lp.rating }
  }
  if (!full) {
    const idx = dailyPuzzleIndex(dayKey)
    full = PUZZLES[idx]
  }
  // Spoiler-safe payload: position, rating, nothing else. The solution, the
  // title, the themes and the source cross the wire only after the solve,
  // through /api/puzzles/move (scriptDone) or /api/puzzles/reveal.
  const puzzle = full ? { id: full.id, fen: full.fen, rating: full.rating } : null
  return NextResponse.json({
    puzzle,
    dayKey,
    seriesNumber: daysSinceEpoch(dayKey),
    completed: profile.dailyDoneDate === dayKey,
  })
}
