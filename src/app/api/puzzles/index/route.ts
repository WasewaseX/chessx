import { NextRequest, NextResponse } from 'next/server'
import { PUZZLES } from '@/content/puzzles'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { lichessAvailable, lichessCount, lichessWindow } from '@/lib/server/lichess-bank'
import { bankStatus, kickBankBootstrap } from '@/lib/server/bank-bootstrap'

/**
 * GET: the client-side puzzle index, sanitized. Powers every piece of client
 * picking (theme chips, rated deal, rush ordering, battle deals, vision
 * deals) without shipping a single solution, title or source line. The
 * answers stay on the server; /api/puzzles/move grades against them.
 *
 * With the Lichess bank installed this serves a bounded window (400 rows)
 * around the player's puzzle rating — the closest slices first, widened
 * progressively, popularity-ordered, shuffled so chips and deals vary.
 * Optional additive params: ?rating= override and ?themes=a,b filter.
 * Without the bank it serves the curated PUZZLES pool exactly as before.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Defense in depth: instrumentation normally installs the puzzle bank at
  // boot; kick here too so an API-first environment still self-heals.
  if (!lichessAvailable()) kickBankBootstrap()

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
    const window = lichessWindow(rating, 400, themes)
    if (window.length) {
      const puzzles = window.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating, themes: p.themes }))
      return NextResponse.json({ puzzles, total: puzzles.length, lichessTotal: lichessCount() })
    }
    // Bank present but empty/broken for this ask: fall through to the pool.
  }

  const puzzles = PUZZLES.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating, themes: p.themes }))
  // The client can show an honest "installing the puzzle bank…" state instead
  // of a bare 214 while the self-healing installer runs.
  return NextResponse.json({ puzzles, total: puzzles.length, lichessTotal: 0, bank: bankStatus() })
}
