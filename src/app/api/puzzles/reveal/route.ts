import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { revealPuzzle } from '@/lib/server/puzzle-grade'

/**
 * POST: hand over the full answer — line, title, themes, source. Called only
 * by surfaces that have already shown the finish: a failed attempt or the
 * explicit "Show solution" click. Before that moment the answer stays on the
 * server, which is the whole point of the spoiler-safe puzzle flow.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const puzzleId = String((body as { puzzleId?: unknown } | null)?.puzzleId ?? '').slice(0, 60)
  if (!puzzleId) return NextResponse.json({ error: 'puzzleId required' }, { status: 400 })

  const revealed = revealPuzzle(puzzleId)
  if ('error' in revealed) return NextResponse.json({ error: revealed.error }, { status: 404 })
  return NextResponse.json(revealed)
}
