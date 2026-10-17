// Single-position evaluation for the free analysis board: engine core on the
// server (native Stockfish 19), SAN-converted PV so the client never shows
// raw UCI coordinates.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { analyze, engineIdentity } from '@/lib/server/engine'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const fen = typeof body?.fen === 'string' ? body.fen.trim() : ''
  if (!fen) return NextResponse.json({ error: 'fen required' }, { status: 400 })
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return NextResponse.json({ error: 'invalid fen' }, { status: 400 })
  }

  // Depth clamp: 6-40. The top of the ladder (Deep 24+, "Analyze Deeper",
  // Unlimited) is honest about time — deeper asks get a bigger wall-clock
  // budget, and the response carries the depth the engine ACTUALLY reached.
  const depth = clamp(Math.round(Number(body?.depth ?? 14) || 14), 6, 40)
  const info = await analyze(fen, 1, depth, { timeoutMs: depth > 24 ? 45_000 : 15_000 })
  if (!info || !info.best || info.best === '(none)') {
    return NextResponse.json({ error: 'engine unavailable' }, { status: 503 })
  }

  const turn = game.turn()
  const scoreCp = info.bestScore // side-to-move POV
  // mate sign convention used by the client: positive = side to move mates
  const mateStm = Math.abs(scoreCp) >= 90000 ? (scoreCp > 0 ? 1 : -1) : null

  // SAN PV replay
  const g = new Chess(fen)
  const pvSan: string[] = []
  for (const uci of info.pv.slice(0, 12)) {
    try {
      const pm = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
      if (!pm) break
      pvSan.push(pm.san)
    } catch {
      break
    }
  }

  return NextResponse.json({
    depth,
    depthReached: info.depthReached ?? depth,
    scoreCp,
    mate: mateStm,
    bestSan: pvSan[0] ?? null,
    pv: info.pv,
    pvSan,
    engine: await engineIdentity(),
  })
}
