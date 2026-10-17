// Mistake Corrector API — the player's own analyzed-game errors as a
// replay-until-mastered drill loop.
//
//  GET    /api/drills            harvest new errors from stored analyzed games,
//                                lazily resolve pending engine answers, return
//                                the queue WITHOUT solutions (fen + metadata
//                                only; userSan/bestSan/note stay server-side
//                                until a drill is solved or revealed)
//  POST   /api/drills
//           { drillId, move }   grade a played move (SAN; from/to/promotion
//                               also accepted) against the stored best
//           { drillId, reveal } explicit "show me the answer" (no stat change)
//           { fen, userSan, bestSan?, evalLossCp, plyNumber, ... }
//                               direct creation from the Game review Key
//                               Moments list ("Save as drill")
//  DELETE /api/drills?id=       dismiss ("Never show again")
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import { analyze } from '@/lib/server/engine'
import { harvestDrills, resolvePendingDrills } from '@/lib/server/drill-harvest'
import type { Drill } from '@prisma/client'

const DAY_MS = 86_400_000

/** Queue DTO: everything the drill needs, nothing that gives the answer away. */
function publicDrill(d: Drill) {
  let sideToMove: 'w' | 'b' = 'w'
  try {
    sideToMove = new Chess(d.fen).turn()
  } catch {
    /* corrupt fen cannot leak anything anyway */
  }
  return {
    id: d.id,
    fen: d.fen,
    sideToMove,
    evalLossCp: d.evalLossCp,
    plyNumber: d.plyNumber,
    opening: d.opening,
    opponent: d.opponent,
    attempts: d.attempts,
    fails: d.fails,
    mastered: d.mastered,
    revealed: d.revealed,
    nextDueAt: d.nextDueAt,
    createdAt: d.createdAt,
    saved: Boolean(d.gameRecordId),
  }
}

function coachLine(d: Drill): string {
  if (d.note) return d.note
  return `This was your move in the game — the engine preferred ${d.bestSan}, which saves about ${lossPawns(d.evalLossCp)} pawns.`
}

function lossPawns(cp: number): string {
  return (cp / 100).toFixed(1)
}

const cleanStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null

const cleanInt = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def
}

/** Play a stored/engine SAN in a fresh board; null when illegal. */
function playSan(fen: string, san: string) {
  try {
    return new Chess(fen).move(san)
  } catch {
    return null
  }
}

/** Play an engine UCI (e2e4 / e7e8q) in a FRESH board at `fen`; null when illegal. */
function playUci(fen: string, uci: string) {
  try {
    return new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    })
  } catch {
    return null
  }
}

const sameMove = (
  a: { from: string; to: string; promotion?: string } | null,
  b: { from: string; to: string; promotion?: string } | null,
) => Boolean(a && b && a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? ''))

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  // the harvest replays PGNs and the engine fill searches — keep it bounded
  if (!rateLimit(`drills-get:${pid}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  try {
    await harvestDrills(pid)
    await resolvePendingDrills(pid)
  } catch (err) {
    console.error('[drills] harvest failed', err) // queue still serves what exists
  }

  const [rows, mastered] = await Promise.all([
    db.drill.findMany({
      where: { profileId: pid, mastered: false, bestSan: { not: '' } },
      orderBy: { nextDueAt: 'asc' },
      take: 40,
    }),
    db.drill.count({ where: { profileId: pid, mastered: true } }),
  ])

  return NextResponse.json({ drills: rows.map(publicDrill), mastered, total: rows.length })
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`drills-post:${pid}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  // ---------------- direct creation ("Save as drill" from Key Moments) -----
  const fen = cleanStr(body.fen, 100)
  const userSan = cleanStr(body.userSan, 12)
  if (fen && userSan) return createDrill(pid, body, fen, userSan)

  // ---------------- grading / reveal ----------------------------------------
  const drillId = cleanStr(body.drillId, 40)
  if (!drillId) return NextResponse.json({ error: 'drillId (or fen+userSan) required' }, { status: 400 })
  const drill = await db.drill.findFirst({ where: { id: drillId, profileId: pid } })
  if (!drill) return NextResponse.json({ error: 'no such drill' }, { status: 404 })
  if (drill.bestSan === '') {
    return NextResponse.json({ error: 'This drill is still being prepared — try again shortly' }, { status: 409 })
  }

  // explicit reveal: no counters move, the answer is just shown
  if (body.reveal === true && !cleanStr(body.move, 12)) {
    await db.drill.update({ where: { id: drill.id }, data: { revealed: true } })
    return NextResponse.json({
      revealed: true,
      bestSan: drill.bestSan,
      userSan: drill.userSan,
      lossCp: drill.evalLossCp,
      coachLine: coachLine(drill),
    })
  }

  // grade: the move arrives as SAN (from the client's chess.js board) or raw squares
  let board: Chess
  try {
    board = new Chess(drill.fen)
  } catch {
    return NextResponse.json({ error: 'Drill position is corrupt — dismiss it and continue' }, { status: 422 })
  }
  const sanInput = cleanStr(body.move, 12)
  let played: ReturnType<Chess['move']> | null = null
  if (sanInput) {
    try {
      played = board.move(sanInput)
    } catch {
      played = null
    }
    if (!played) return NextResponse.json({ error: 'That move is not legal in this position' }, { status: 400 })
  } else {
    const from = cleanStr(body.from, 2)
    const to = cleanStr(body.to, 2)
    const promotion = cleanStr(body.promotion, 1)
    if (!from || !to) return NextResponse.json({ error: 'move (SAN) or from/to required' }, { status: 400 })
    try {
      played = board.move({ from, to, promotion: promotion || undefined })
    } catch {
      played = null
    }
    if (!played) return NextResponse.json({ error: 'That move is not legal in this position' }, { status: 400 })
  }

  const best = playSan(drill.fen, drill.bestSan)
  if (!best) return NextResponse.json({ error: 'Drill solution is corrupt — dismiss it and continue' }, { status: 422 })

  if (sameMove(played, best)) {
    // correct: first try of the cycle (no miss since the last success, answer
    // never revealed) masters the drill; otherwise one more pass tomorrow
    const firstTry = drill.streakFails === 0 && !drill.revealed
    const mastered = firstTry ? true : drill.mastered
    const nextDueAt = new Date(Date.now() + (firstTry ? 7 : 1) * DAY_MS)
    const updated = await db.drill.update({
      where: { id: drill.id },
      data: { attempts: { increment: 1 }, streakFails: 0, revealed: false, mastered, nextDueAt },
    })
    return NextResponse.json({
      correct: true,
      drill: { id: updated.id, mastered, nextDueAt, attempts: updated.attempts },
      bestSan: drill.bestSan,
      userSan: drill.userSan,
      lossCp: drill.evalLossCp,
      coachLine: coachLine(drill),
    })
  }

  // wrong: 10-minute retry; the 2nd consecutive failure (or an explicit
  // reveal) shows the stored answer
  const streakFails = drill.streakFails + 1
  const reveal = streakFails >= 2 || body.reveal === true
  const nextDueAt = new Date(Date.now() + 10 * 60_000)
  const updated = await db.drill.update({
    where: { id: drill.id },
    data: {
      attempts: { increment: 1 },
      fails: { increment: 1 },
      streakFails,
      revealed: drill.revealed || reveal,
      nextDueAt,
    },
  })
  return NextResponse.json({
    correct: false,
    drill: { id: updated.id, attempts: updated.attempts, fails: updated.fails, nextDueAt },
    reveal,
    ...(reveal
      ? { bestSan: drill.bestSan, userSan: drill.userSan, lossCp: drill.evalLossCp, coachLine: coachLine(drill) }
      : {}),
  })
}

/** Direct creation from the Game review Key Moments list. */
async function createDrill(pid: string, body: Record<string, unknown>, fen: string, userSan: string) {
  let board: Chess
  try {
    board = new Chess(fen)
  } catch {
    return NextResponse.json({ error: 'That FEN does not describe a legal position' }, { status: 400 })
  }
  if (board.isGameOver()) {
    return NextResponse.json({ error: 'The position is already decided — nothing to drill here' }, { status: 422 })
  }
  let played: ReturnType<Chess['move']> | null = null
  try {
    played = board.move(userSan)
  } catch {
    played = null
  }
  if (!played) return NextResponse.json({ error: 'userSan is not legal in that position' }, { status: 400 })

  const bestSanBody = cleanStr(body.bestSan, 12)
  // the best move always lives on a fresh board at the BEFORE position — the
  // user's move above must never mutate it
  let best: ReturnType<Chess['move']> | null = bestSanBody ? playSan(fen, bestSanBody) : null
  if (bestSanBody && !best) return NextResponse.json({ error: 'bestSan is not legal in that position' }, { status: 400 })
  if (!best) {
    // the moment carried no stored best move — ask the engine once, persist it
    const analysis = await analyze(fen, 1, 12, { movetimeMs: 3000, timeoutMs: 15_000 })
    best = analysis?.best ? playUci(fen, analysis.best) : null
    if (!best) {
      return NextResponse.json(
        { error: 'Could not reach the engine to determine the best move — try again shortly' },
        { status: 503 },
      )
    }
  }
  if (sameMove(played, best)) {
    return NextResponse.json({ error: 'That move was already the best one — nothing to drill here' }, { status: 422 })
  }

  const gameRecordId = cleanStr(body.gameRecordId, 40)
  // ownership guard: a stored game's drills must match the side the player had
  if (gameRecordId) {
    const game = await db.gameRecord.findFirst({ where: { id: gameRecordId, profileId: pid } })
    if (game) {
      const playerColor: 'w' | 'b' = game.color === 'b' ? 'b' : 'w'
      if (played.color !== playerColor) {
        return NextResponse.json(
          { error: 'That moment was your opponent\u2019s move — only your own errors become drills' },
          { status: 422 },
        )
      }
    }
  }

  const plyNumber = cleanInt(body.plyNumber, 0, 0, 2000)
  const evalLossCp = cleanInt(body.evalLossCp, 100, 1, 3000)
  const opening = cleanStr(body.opening, 80)
  const opponent = cleanStr(body.opponent, 60)
  const bestUci = `${best.from}${best.to}${best.promotion ?? ''}`
  const bestSan = best.san

  const existing = gameRecordId
    ? await db.drill.findFirst({ where: { profileId: pid, gameRecordId, plyNumber } })
    : await db.drill.findFirst({ where: { profileId: pid, gameRecordId: null, fen } })
  if (existing) {
    const updated = await db.drill.update({
      where: { id: existing.id },
      data: {
        userSan: played.san,
        bestSan,
        bestUci,
        evalLossCp,
        opening: opening ?? existing.opening,
        opponent: opponent ?? existing.opponent,
      },
    })
    return NextResponse.json({ drill: { ...publicDrill(updated), bestSan, userSan: played.san }, existed: true })
  }

  const created = await db.drill.create({
    data: {
      profileId: pid,
      gameRecordId,
      fen,
      userSan: played.san,
      bestSan,
      bestUci,
      evalLossCp,
      plyNumber,
      opening,
      opponent,
    },
  })
  return NextResponse.json({ drill: { ...publicDrill(created), bestSan, userSan: played.san }, existed: false })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const gone = await db.drill.deleteMany({ where: { id, profileId: pid } })
  if (gone.count === 0) return NextResponse.json({ error: 'no such drill' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
