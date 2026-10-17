// POST /api/public/position/eval { fen, depth? } — one Stockfish 19
// evaluation through the same server engine the app uses. Depth defaults to
// 12 and is clamped to 6-18 so anonymous traffic cannot pin the engine core.
// Score and mate are side-to-move POV, matching the in-app analysis board.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { preflight, withPublic } from '@/lib/server/public-api'
import { analyze } from '@/lib/server/engine'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export async function POST(req: NextRequest) {
  return withPublic(req, async () => {
    const body = (await req.json().catch(() => null)) as { fen?: unknown; depth?: unknown } | null
    const fen = typeof body?.fen === 'string' ? body.fen.trim() : ''
    if (!fen) return NextResponse.json({ error: 'fen required' }, { status: 400 })
    let game: Chess
    try {
      game = new Chess(fen)
    } catch {
      return NextResponse.json({ error: 'invalid fen' }, { status: 400 })
    }
    const depth = clamp(Math.round(Number(body?.depth ?? 12) || 12), 6, 18)
    const info = await analyze(fen, 1, depth, { timeoutMs: 15_000 })
    if (!info || !info.best || info.best === '(none)') {
      return NextResponse.json({ error: 'engine unavailable' }, { status: 503 })
    }

    const scoreCp = info.bestScore // side-to-move POV; mate mapped huge by the engine
    const mate = Math.abs(scoreCp) >= 90000 ? (scoreCp > 0 ? 1 : -1) : null

    // SAN replay of the principal variation on the validated board.
    const pvSan: string[] = []
    for (const uci of info.pv.slice(0, 12)) {
      try {
        const pm = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
        if (!pm) break
        pvSan.push(pm.san)
      } catch {
        break
      }
    }

    return NextResponse.json({
      fen,
      depthReached: info.depthReached ?? depth,
      bestMove: { uci: info.best, san: pvSan[0] ?? null },
      scoreCp,
      mate,
      pvSan,
    })
  })
}

export function OPTIONS() {
  return preflight()
}
