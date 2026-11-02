import { NextRequest, NextResponse } from 'next/server'
import { PUZZLES } from '@/content/puzzles'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { lichessAvailable, lichessCount, lichessWindow } from '@/lib/server/lichess-bank'

/**
 * GET: the client-side puzzle index, sanitized. Powers every piece of client
 * picking (theme chips, rated deal, rush ordering, battle deals, vision
 * deals) without shipping a single solution, title or source line. The
 * answers stay on the server; /api/puzzles/move grades against them.
 *
 * Puzzles come live from the free Lichess puzzle API: a bounded window (up
 * to 50 rows) around the player's puzzle rating, shuffled so chips and deals
 * vary, deduped + TTL-cached so repeat hits cost nothing. Optional additive
 * params: ?rating= override and ?themes=a,b filter. When the upstream is
 * unreachable the curated PUZZLES pool serves exactly as before.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  if (lichessAvailable()) {
    const ratingParam = req.nextUrl.searchParams.get('rating')
    const themesParam = req.nextUrl.searchParams.get('themes')
    const themes = themesParam
      ? themesParam.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : undefined
    let rating = 1200
    if (ratingParam === null || ratingParam === '') {
      const profile = await db.profile.findUnique({
        where: { userId: user.id },
        select: { puzzleRating: true },
      })
      if (profile?.puzzleRating) rating = profile.puzzleRating
    } else {
      const n = Number(ratingParam)
      if (Number.isFinite(n) && n > 0) rating = n
    }
    const window = await lichessWindow(rating, 50, themes)
    if (window.length) {
      const puzzles = window.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating, themes: p.themes }))
      return NextResponse.json({ puzzles, total: puzzles.length, lichessTotal: lichessCount() })
    }
    // Upstream unreachable or empty for this ask: fall through to the pool.
  }

  const puzzles = PUZZLES.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating, themes: p.themes }))
  return NextResponse.json({ puzzles, total: puzzles.length, lichessTotal: 0 })
}
