import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { numOr } from '@/lib/api'

/**
 * Imported-games library (REA chessigma port item 1): a browsable store of
 * every game the account ever imported (GameRecord rows with botLevel = 0).
 *
 * GET /api/library            — paginated rows + whole-library aggregates
 *   ?result=win|loss|draw     — player's result filter
 *   ?source=chesscom|lichess  — provider filter (null source = "imported")
 *   ?opening=Sicilian         — substring match on the stored opening name
 *   ?q=opponent-name          — substring match on the opponent
 *   ?page=1&pageSize=25       — pagination (pageSize clamped 5..50)
 *
 * Rows never carry the PGN: the list stays small. ?game=<id> returns that one
 * owned imported game WITH its PGN — the analysis handoff uses it.
 */

const RESULTS = ['win', 'loss', 'draw'] as const
const SOURCES = ['chesscom', 'lichess'] as const

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 })
  const pid = profile.id

  const sp = req.nextUrl.searchParams

  // Single-game handoff: ownership-checked, imported games only.
  const gameId = (sp.get('game') ?? '').trim().slice(0, 40)
  if (gameId) {
    const game = await db.gameRecord.findFirst({
      where: { id: gameId, profileId: pid, botLevel: 0 },
      select: {
        id: true, color: true, botName: true, result: true, reason: true,
        opening: true, moveCount: true, playerAcc: true, accuracy: true,
        analyzedAt: true, source: true, createdAt: true, pgn: true,
      },
    })
    if (!game) return NextResponse.json({ error: 'Imported game not found.' }, { status: 404 })
    return NextResponse.json({ game: { ...game, acc: game.playerAcc ?? game.accuracy ?? null } })
  }

  const result = RESULTS.includes(sp.get('result') as (typeof RESULTS)[number]) ? sp.get('result') : null
  const source = SOURCES.includes(sp.get('source') as (typeof SOURCES)[number]) ? sp.get('source') : null
  const opening = (sp.get('opening') ?? '').trim().slice(0, 60)
  const q = (sp.get('q') ?? '').trim().slice(0, 40)
  const page = numOr(sp.get('page'), 1, 1, 1000)
  const pageSize = numOr(sp.get('pageSize'), 25, 5, 50)

  const where = {
    profileId: pid,
    botLevel: 0,
    ...(result ? { result } : {}),
    ...(source ? { source } : {}),
    ...(opening ? { opening: { contains: opening } } : {}),
    ...(q ? { botName: { contains: q } } : {}),
  }

  const [rows, filteredTotal, allTotal, win, loss, draw, bySource, openings] = await Promise.all([
    db.gameRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        color: true,
        botName: true,
        rated: true,
        result: true,
        reason: true,
        opening: true,
        moveCount: true,
        playerAcc: true,
        accuracy: true,
        analyzedAt: true,
        source: true,
        createdAt: true,
      },
    }),
    db.gameRecord.count({ where }),
    db.gameRecord.count({ where: { profileId: pid, botLevel: 0 } }),
    db.gameRecord.count({ where: { profileId: pid, botLevel: 0, result: 'win' } }),
    db.gameRecord.count({ where: { profileId: pid, botLevel: 0, result: 'loss' } }),
    db.gameRecord.count({ where: { profileId: pid, botLevel: 0, result: 'draw' } }),
    db.gameRecord.groupBy({
      by: ['source'],
      where: { profileId: pid, botLevel: 0 },
      _count: { _all: true },
    }),
    db.gameRecord.groupBy({
      by: ['opening'],
      where: { profileId: pid, botLevel: 0, opening: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { opening: 'desc' } },
      take: 6,
    }),
  ])

  const sources: Record<string, number> = { chesscom: 0, lichess: 0, unknown: 0 }
  for (const g of bySource) {
    if (g.source === 'chesscom' || g.source === 'lichess') sources[g.source] += g._count._all
    else sources.unknown += g._count._all
  }

  return NextResponse.json({
    games: rows.map((g) => ({
      ...g,
      // playerAcc is the review pipeline number; accuracy is the legacy bot-play field
      acc: g.playerAcc ?? g.accuracy ?? null,
    })),
    page,
    pageSize,
    filteredTotal,
    summary: {
      total: allTotal,
      win,
      loss,
      draw,
      sources,
      openings: openings
        .filter((o) => o.opening)
        .map((o) => ({ name: o.opening as string, count: o._count._all })),
    },
  })
}
