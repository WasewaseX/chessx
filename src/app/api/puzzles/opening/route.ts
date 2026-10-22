import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { lichessAvailable, lichessCount, lichessOpeningWindow } from '@/lib/server/lichess-bank'
import { kickBankBootstrap } from '@/lib/server/bank-bootstrap'

/**
 * GET /api/puzzles/opening?openings=Tag1,Tag2&elo=1250&exclude=id,id
 *
 * The Opening Training puzzles mode (chessreps port, deep-dive P4): a
 * rating window of puzzles from the 5.77M bank filtered by the repertoire
 * course's opening tags. The response never carries a solution, a theme or
 * a title — grading stays behind /api/puzzles/move exactly like every other
 * puzzle surface.
 *
 * - `openings`: up to 4 lichess opening tags (underscored, e.g. `London_System`).
 * - `elo`: rating window center; defaults to the player's puzzle rating.
 * - `exclude`: up to 300 already-seen puzzle ids (the client keeps the ring).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  if (!lichessAvailable()) kickBankBootstrap()

  const openingsParam = req.nextUrl.searchParams.get('openings') ?? ''
  const openings = openingsParam
    .split(',')
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z0-9_-]{2,60}$/.test(t))
    .slice(0, 4)
  if (!openings.length) return NextResponse.json({ error: 'openings required' }, { status: 400 })

  const excludeRaw = req.nextUrl.searchParams.get('exclude') ?? ''
  const exclude = excludeRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300)

  let rating = 1200
  const ratingParam = req.nextUrl.searchParams.get('elo')
  if (ratingParam) {
    const n = Number(ratingParam)
    if (Number.isFinite(n) && n > 0) rating = n
  } else {
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { puzzleRating: true },
    })
    if (profile?.puzzleRating) rating = profile.puzzleRating
  }

  if (!lichessAvailable()) {
    // Honest state: the self-healing installer is running. The client shows
    // its "bank is warming up" card instead of an empty session.
    return NextResponse.json({ puzzles: [], total: 0, lichessTotal: 0, warming: true })
  }

  const rows = lichessOpeningWindow(rating, openings, exclude, 200)
  const puzzles = rows.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating }))
  return NextResponse.json({ puzzles, total: puzzles.length, lichessTotal: lichessCount() })
}
