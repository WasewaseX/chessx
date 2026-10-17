// GET /api/public/opening/identify?moves=e4,e5,Nf3
// POST /api/public/opening/identify { pgn }   (also accepts { moves })
//
// Match a move list against the compact ECO table (~120 common lines).
// Returns { eco, name, matchedPlies } — matchedPlies is the honest count of
// table plies that matched, 0 with nulls when nothing matched.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { preflight, withPublic } from '@/lib/server/public-api'
import { identifyEcoLine, tokenizeMoves } from '@/lib/chess/eco-table'

export async function GET(req: NextRequest) {
  return withPublic(req, async () => {
    const tokens = tokenizeMoves(req.nextUrl.searchParams.get('moves') ?? '')
    if (tokens.length === 0) {
      return NextResponse.json({ error: 'moves required, e.g. ?moves=e4,e5,Nf3' }, { status: 400 })
    }
    const m = identifyEcoLine(tokens)
    return NextResponse.json({ eco: m.eco, name: m.name, matchedPlies: m.matchedPlies })
  })
}

export async function POST(req: NextRequest) {
  return withPublic(req, async () => {
    const body = (await req.json().catch(() => null)) as { pgn?: unknown; moves?: unknown } | null
    if (!body || (body.pgn == null && body.moves == null)) {
      return NextResponse.json({ error: 'Send pgn or moves' }, { status: 400 })
    }
    let tokens: string[] = []
    if (typeof body.pgn === 'string' && body.pgn.trim()) {
      const g = new Chess()
      try {
        g.loadPgn(body.pgn)
      } catch {
        return NextResponse.json({ error: 'That PGN could not be parsed' }, { status: 400 })
      }
      tokens = g.history()
    } else if (Array.isArray(body.moves)) {
      tokens = body.moves.slice(0, 40).map((m) => String(m))
    } else if (typeof body.moves === 'string') {
      tokens = tokenizeMoves(body.moves)
    }
    if (tokens.length === 0) return NextResponse.json({ error: 'No moves to identify' }, { status: 400 })
    const m = identifyEcoLine(tokens)
    return NextResponse.json({ eco: m.eco, name: m.name, matchedPlies: m.matchedPlies })
  })
}

export function OPTIONS() {
  return preflight()
}
