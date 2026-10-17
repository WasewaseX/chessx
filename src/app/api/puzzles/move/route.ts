import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { gradePuzzleMoves } from '@/lib/server/puzzle-grade'

/**
 * POST: grade one solver move against the scripted line.
 * Body: { puzzleId, played: string[] (the solver's own SAN moves, in order),
 *         hint?: boolean }
 * The response never contains the solution: a miss returns correctness plus
 * the from-square the miss flow already glowed; a hit returns the forced
 * opponent reply (SAN) to animate and whether the scripted point is complete.
 * Title, themes and source ride along only once the tactic has landed.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const puzzleId = String((body as { puzzleId?: unknown } | null)?.puzzleId ?? '').slice(0, 60)
  if (!puzzleId) return NextResponse.json({ error: 'puzzleId required' }, { status: 400 })

  const playedRaw = (body as { played?: unknown } | null)?.played
  const played = Array.isArray(playedRaw) ? playedRaw.map((m) => String(m)).slice(0, 20) : []
  const hint = Boolean((body as { hint?: unknown } | null)?.hint)

  const verdict = gradePuzzleMoves(puzzleId, played, hint)
  if ('error' in verdict) return NextResponse.json({ error: verdict.error }, { status: 400 })
  return NextResponse.json(verdict)
}
