import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

function fenError(fen: string): string | null {
  const parts = fen.trim().split(/\s+/)
  if (parts.length < 2) return 'A FEN needs at least the piece placement and the side to move.'
  let g: Chess
  try {
    g = new Chess(fen)
  } catch {
    return 'That FEN does not describe a legal position.'
  }
  if (g.isCheckmate() || g.isStalemate() || g.isInsufficientMaterial() || g.isThreefoldRepetition() || g.isDraw()) {
    return 'That position is already decided: the game is over the moment it starts.'
  }
  return null
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ positions: [] })
  const positions = await db.savedPosition.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return NextResponse.json({ positions })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let body: { name?: unknown; fen?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }
  const fen = typeof body.fen === 'string' ? body.fen.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (!fen) return NextResponse.json({ error: 'Paste a FEN first.' }, { status: 400 })
  const bad = fenError(fen)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Profile missing' }, { status: 400 })
  const existing = await db.savedPosition.findFirst({ where: { profileId: profile.id, fen } })
  if (existing) return NextResponse.json({ position: existing, existed: true })
  const position = await db.savedPosition.create({
    data: { profileId: profile.id, name: name || 'Saved position', fen },
  })
  return NextResponse.json({ position })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Profile missing' }, { status: 400 })
  const row = await db.savedPosition.findUnique({ where: { id } })
  if (!row || row.profileId !== profile.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.savedPosition.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
