import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
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
  const body = await req.json().catch(() => null)
  const gameId = typeof body?.gameId === 'string' ? body.gameId : null
  const plies: PlyIn[] = Array.isArray(body?.plies) ? body.plies : []
  if (!gameId || plies.length === 0) {
    return NextResponse.json({ error: 'gameId and plies required' }, { status: 400 })
  }

  const game = await db.gameRecord.findUnique({ where: { id: gameId } })
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

  // player's local hour at game end (the browser is the clock in this app)
  const localHour = Number.isInteger(body?.localHour) ? Math.max(0, Math.min(23, Number(body.localHour))) : null

  const updated = await db.gameRecord.update({
    where: { id: gameId },
    data: {
      opening,
      whiteAcc,
      blackAcc,
      playerAcc,
      labelsJson: JSON.stringify(counts),
      localHour,
      analyzedAt: new Date(),
    },
  })

  return NextResponse.json({
    report: { gameId: updated.id, opening, whiteAcc, blackAcc, playerAcc, counts },
  })
}
