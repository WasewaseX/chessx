// GET /api/public/puzzles/daily — today's official Lichess daily puzzle,
// live from the free API, spoiler-free: id, FEN, rating, themes, move count.
// No solution, no title, no source. Falls back to the curated pool's own
// deterministic rotation when the upstream is unreachable, so the endpoint
// always answers honestly instead of 500ing.
import { NextRequest, NextResponse } from 'next/server'
import { preflight, withPublic } from '@/lib/server/public-api'
import { resolveDaily } from '@/lib/server/daily-pick'

export async function GET(req: NextRequest) {
  return withPublic(req, async () => {
    const dayKey = new Date().toISOString().slice(0, 10)
    const pick = await resolveDaily(dayKey)
    return NextResponse.json({
      id: pick.id,
      fen: pick.fen,
      rating: pick.rating,
      themes: pick.themes,
      moveCount: pick.moveCount,
      source: pick.source,
    })
  })
}

export function OPTIONS() {
  return preflight()
}
