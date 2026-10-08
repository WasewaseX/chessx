import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { accuracyFromLoss } from '@/lib/rating'
import { detectOpening } from '@/lib/chess/openings'

const LABELS = ['best', 'brilliant', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const
type Label = (typeof LABELS)[number]

interface PlyIn {
  san: string
  color: string
  before: number
  after: number
  label: string
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => null)
  const gameId = typeof body?.gameId === 'string' ? body.gameId : null
  const plies: PlyIn[] = Array.isArray(body?.plies) ? body.plies : []
  if (!gameId || plies.length === 0) {
    return NextResponse.json({ error: 'gameId and plies required' }, { status: 400 })
  }

  // only the owner of the game may generate its report
  const game = await db.gameRecord.findFirst({ where: { id: gameId, profileId: pid } })
  if (!game) return NextResponse.json({ error: 'no such game' }, { status: 404 })

  // keep only what the client actually evaluated, with sane numbers
  const clean = plies
    .filter(
      (p): p is PlyIn & { label: Label } =>
        typeof p.san === 'string' &&
        (p.color === 'w' || p.color === 'b') &&
        Number.isFinite(p.before) &&
        Number.isFinite(p.after) &&
        (LABELS as readonly string[]).includes(p.label),
    )
    .map((p) => ({ ...p, before: Math.max(-80, Math.min(80, p.before)), after: Math.max(-80, Math.min(80, p.after)) }))
    .slice(0, 1000)
  if (clean.length === 0) {
    return NextResponse.json({ error: 'no usable plies' }, { status: 400 })
  }

  // accuracy per side from the average eval drop, same math as the on-screen report
  const lossesFor = (color: 'w' | 'b') =>
    clean
      .filter((p) => p.color === color)
      .map((p) => Math.max(0, (color === 'w' ? p.before : -p.before) - (color === 'w' ? p.after : -p.after)))
  const whiteLosses = lossesFor('w')
  const blackLosses = lossesFor('b')
  const whiteAcc = whiteLosses.length ? Math.round(accuracyFromLoss(whiteLosses.reduce((a, b) => a + b, 0) / whiteLosses.length) * 10) / 10 : null
  const blackAcc = blackLosses.length ? Math.round(accuracyFromLoss(blackLosses.reduce((a, b) => a + b, 0) / blackLosses.length) * 10) / 10 : null
  const playerAcc = game.color === 'w' ? whiteAcc : blackAcc

  const counts: Record<string, { w: number; b: number }> = {}
  for (const p of clean) {
    counts[p.label] = counts[p.label] ?? { w: 0, b: 0 }
    counts[p.label][p.color] += 1
  }

  const sans = clean.map((p) => p.san)
  const opening = detectOpening(sans)

  // The pivotal moment: the player's biggest eval drop, kept with the FEN
  // right before the move so the coach can rebuild the exact miss as a drill.
  // The FEN is rebuilt from the server-side SAN replay, never trusted from
  // the client.
  let pivotFen: string | null = null
  let pivotSan: string | null = null
  let pivotPly: number | null = null
  let pivotLoss: number | null = null
  let worst = 0
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i]
    if ((p.label !== 'blunder' && p.label !== 'mistake') || p.san === '...') continue
    const loss = Math.max(0, (p.color === 'w' ? p.before : -p.before) - (p.color === 'w' ? p.after : -p.after))
    if (loss > worst) {
      worst = loss
      pivotSan = p.san
      pivotPly = i
      pivotLoss = Math.round(loss)
    }
  }
  if (pivotPly != null) {
    try {
      const replay = new Chess()
      for (let i = 0; i < pivotPly; i++) replay.move(clean[i].san)
      pivotFen = replay.fen()
    } catch {
      pivotFen = null
    }
  }

  // player's local hour at game end (the browser is the clock in this app)
  const localHour = Number.isInteger(body?.localHour) ? Math.max(0, Math.min(23, Number(body.localHour))) : null

  const updated = await db.gameRecord.update({
    where: { id: game.id },
    data: {
      opening,
      whiteAcc,
      blackAcc,
      playerAcc,
      labelsJson: JSON.stringify(counts),
      ...(pivotFen ? { pivotFen, pivotSan, pivotPly, pivotLoss } : {}),
      localHour,
      analyzedAt: new Date(),
    },
  })

  return NextResponse.json({
    report: { gameId: updated.id, opening, whiteAcc, blackAcc, playerAcc, counts },
  })
}
