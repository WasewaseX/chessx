// Live move classification for Play-with-Coach.
//
// The coaching game streams each new ply here; the server runs the SAME
// evalPlies pipeline used by full game review (engine-verified labels,
// eval swing, the better move and the plain-words reason). The client's own
// quick guess is only a placeholder until this answers: the server is the
// source of truth so the label set can never drift.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { getSessionUser, rateLimit, clientIp } from '@/lib/auth'
import { evalPlies, type PlyIn } from '@/lib/server/game-report'

export const maxDuration = 60

const MAX_PLIES = 160
const MAX_CHUNK = 8

function normalizeSan(raw: string): string {
  return raw.replace(/[+#!?]/g, '').trim().slice(0, 8)
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const unlocked = user.role === 'admin'
  if (!unlocked && (!rateLimit(`cg-analyze:${user.id}`, 60, 60_000) || !rateLimit(`cg-analyze-ip:${clientIp(req)}`, 120, 60_000))) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    sans?: unknown
    fromPly?: unknown
    depth?: unknown
  }
  const sans = Array.isArray(body.sans)
    ? body.sans.filter((s): s is string => typeof s === 'string').slice(0, MAX_PLIES).map(normalizeSan).filter(Boolean)
    : []
  if (sans.length === 0) {
    return NextResponse.json({ error: 'sans required' }, { status: 400 })
  }

  // Replay the game server-side; a forged or malformed line stops there and
  // everything before it is still analyzed honestly.
  const board = new Chess()
  const plies: PlyIn[] = []
  for (const san of sans) {
    const fenBefore = board.fen()
    try {
      const mv = board.move(san)
      if (!mv) break
      plies.push({ san: mv.san, color: mv.color, fenBefore })
    } catch {
      break
    }
  }
  if (plies.length === 0) {
    return NextResponse.json({ error: 'no legal moves in sans' }, { status: 400 })
  }

  // Chunked live mode: fromPly (1-based) asks for the plies at the tail only;
  // everything before rides along as priorSans so book/theory stay correct.
  const fromPlyRaw = typeof body.fromPly === 'number' ? Math.floor(body.fromPly) : plies.length
  const fromPly = Math.max(1, Math.min(plies.length, fromPlyRaw))
  const chunkStart = Math.min(fromPly - 1, Math.max(0, plies.length - MAX_CHUNK))
  const chunk = plies.slice(chunkStart)
  const priorSans = plies.slice(0, chunkStart).map((p) => p.san)

  const depthRaw = typeof body.depth === 'number' ? Math.floor(body.depth) : 12
  const depth = Math.max(8, Math.min(16, depthRaw))

  const result = await evalPlies(chunk, depth, { priorSans })
  return NextResponse.json({
    plies: result.plies,
    engineAvailable: result.engineAvailable,
    opening: result.opening,
  })
}
