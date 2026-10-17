// GET /api/public/puzzles/daily — today's deterministic daily puzzle from
// the Lichess bank, spoiler-free: id, FEN, rating, themes, move count. No
// solution, no title, no source. Falls back to the curated pool's own
// deterministic rotation when the bank file is absent, so the endpoint
// always answers honestly instead of 500ing.
import { NextRequest, NextResponse } from 'next/server'
import { sanitizePuzzle, preflight, withPublic } from '@/lib/server/public-api'
import { lichessAvailable, lichessDaily } from '@/lib/server/lichess-bank'
import { PUZZLES } from '@/content/puzzles'
import { dailyPuzzleIndex } from '@/lib/api'

export async function GET(req: NextRequest) {
  return withPublic(req, async () => {
    const dayKey = new Date().toISOString().slice(0, 10)
    if (lichessAvailable()) {
      const lp = lichessDaily(dayKey)
      if (lp) return NextResponse.json(sanitizePuzzle(lp))
    }
    const p = PUZZLES[dailyPuzzleIndex(dayKey)]
    return NextResponse.json({
      id: p.id,
      fen: p.fen,
      rating: p.rating,
      themes: p.themes,
      moveCount: p.solution.split(' ').filter(Boolean).length,
    })
  })
}

export function OPTIONS() {
  return preflight()
}
