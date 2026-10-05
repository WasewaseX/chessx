// ChessX rated multiplayer service.
// Real accounts only: every socket must present a single-use SocketTicket
// minted by the Next.js server, so matchmaking and ratings are backed by the
// same SQLite database the web app reads.
//
// Rating math: Glicko-1 exactly like chess.com (see src/lib/rating/glicko.ts
// for the shared spec). One rating per time pool: bullet, blitz, rapid.
//
// Chess.com behavior this follows:
//   - bot-free queue: you only get matched with another signed-in account
//   - rating window starts tight and widens the longer you wait
//   - games shorter than 2 moves per side are aborted, not rated
//   - disconnect with less than 2 moves each: abort; later: 60s grace then loss
//   - draw by agreement, resign, flagfall all rate normally

import { Server } from 'socket.io'
import { Chess } from 'chess.js'
import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'
const prisma = new PrismaClient()

const PORT = 3030
const RECONNECT_GRACE_MS = 60_000
const SWEEP_MS = 250

// Glicko-1 constants (mirror of src/lib/rating/glicko.ts, service-local on purpose)
const Q = 0.0057565
const RD_FLOOR = 30
const RD_MAX = 350
const RATING_FLOOR = 100
const RD_INACTIVITY_C = 34.65

const TIME_CONTROLS: Record<string, { initialSec: number; incSec: number; pool: 'bullet' | 'blitz' | 'rapid' }> = {
  '1+0': { initialSec: 60, incSec: 0, pool: 'bullet' },
  '3+0': { initialSec: 180, incSec: 0, pool: 'blitz' },
  '3+2': { initialSec: 180, incSec: 2, pool: 'blitz' },
  '5+0': { initialSec: 300, incSec: 0, pool: 'blitz' },
  '10+0': { initialSec: 600, incSec: 0, pool: 'rapid' },
  '15+10': { initialSec: 900, incSec: 10, pool: 'rapid' },
}

function gFactor(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI))
}
function expectedScore(rating: number, oppRating: number, oppRd: number): number {
  return 1 / (1 + Math.pow(10, (-gFactor(oppRd) * (rating - oppRating)) / 400))
}
function inflateRd(rd: number, idleDays: number): number {
  if (idleDays <= 0) return Math.min(RD_MAX, rd)
  return Math.min(RD_MAX, Math.sqrt(rd * rd + RD_INACTIVITY_C * RD_INACTIVITY_C * idleDays))
}
function applyGlicko(
  player: { rating: number; rd: number },
  opp: { rating: number; rd: number },
  score: number,
): { rating: number; rd: number; delta: number } {
  const g = gFactor(opp.rd)
  const e = expectedScore(player.rating, opp.rating, opp.rd)
  const invD = Q * Q * g * g * e * (1 - e)
  const denom = 1 / (player.rd * player.rd) + invD
  const newRating = player.rating + (Q / denom) * (g * (score - e))
  const newRd = Math.sqrt(1 / denom)
  const clamped = Math.max(RATING_FLOOR, newRating)
  return { rating: clamped, rd: Math.max(RD_FLOOR, Math.min(RD_MAX, newRd)), delta: Math.round(clamped - player.rating) }
}

interface Seat {
  userId: string
  username: string
  rating: number
  rd: number
  games: number
  socketId: string | null
  connected: boolean
  disconnectTimer: ReturnType<typeof setTimeout> | null
}

interface ServerGame {
  id: string
  white: Seat
  black: Seat
  chess: Chess
  initialSec: number
  incSec: number
  pool: 'bullet' | 'blitz' | 'rapid'
  rated: boolean
  whiteMs: number
  blackMs: number
  turnStartedAt: number
  drawOfferBy: 'w' | 'b' | null
  finished: boolean
}

interface QueueEntry {
  socketId: string
  userId: string
  username: string
  tc: string
  pool: 'bullet' | 'blitz' | 'rapid'
  rating: number
  rd: number
  games: number
  joinedAt: number
}

const io = new Server(PORT, { cors: { origin: '*' } })

/** socketId -> authed session */
const sessions = new Map<string, { userId: string; username: string }>()
/** userId -> socketId (reconnect replaces) */
const byUser = new Map<string, string>()
/** userId -> active game while it still exists in memory */
const activeGameByUser = new Map<string, ServerGame>()
/** game id -> live game */
const games = new Map<string, ServerGame>()
/** userId -> queue entry */
const queue = new Map<string, QueueEntry>()

function seatView(s: Seat) {
  return { username: s.username, rating: Math.round(s.rating), provisional: s.games < 5 || s.rd > 110 }
}

function clockView(g: ServerGame) {
  return { whiteMs: Math.max(0, Math.round(g.whiteMs)), blackMs: Math.max(0, Math.round(g.blackMs)), turn: g.chess.turn() }
}

function emitState(g: ServerGame, extra: Record<string, unknown> = {}) {
  const state = {
    id: g.id,
    fen: g.chess.fen(),
    lastMove: g.chess.history({ verbose: true }).at(-1) ?? null,
    pgn: g.chess.pgn(),
    moves: g.chess.history(),
    ...clockView(g),
    white: seatView(g.white),
    black: seatView(g.black),
    check: g.chess.isCheck(),
    ...extra,
  }
  io.to(roomOf(g.id)).emit('game:state', state)
}

function roomOf(gameId: string) {
  return `game:${gameId}`
}

function currentUser(socketId: string) {
  return sessions.get(socketId) ?? null
}

async function ratingFor(userId: string, pool: string) {
  const r = await prisma.userRating.findUnique({ where: { userId_pool: { userId, pool } } })
  if (r) return r
  return prisma.userRating.create({ data: { userId, pool } })
}

function leaveQueue(userId: string) {
  queue.delete(userId)
}

async function tryMatch() {
  const entries = [...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  const taken = new Set<string>()
  const now = Date.now()
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]
    if (taken.has(a.userId) || !sessions.has(a.socketId)) continue
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]
      if (taken.has(b.userId) || !sessions.has(b.socketId)) continue
      if (a.pool !== b.pool || a.tc !== b.tc) continue
      const wait = Math.min((now - Math.min(a.joinedAt, b.joinedAt)) / 1000, 90)
      const window = 120 + 12 * wait + (a.games < 5 || b.games < 5 ? 600 : 0)
      if (Math.abs(a.rating - b.rating) <= window) {
        taken.add(a.userId)
        taken.add(b.userId)
        queue.delete(a.userId)
        queue.delete(b.userId)
        await startGame(a, b)
        break
      }
    }
  }
  // prune dead entries
  for (const [uid, e] of queue) if (!sessions.has(e.socketId)) queue.delete(uid)
}

function seatFromEntry(e: QueueEntry, socketId: string): Seat {
  return {
    userId: e.userId,
    username: e.username,
    rating: e.rating,
    rd: e.rd,
    games: e.games,
    socketId,
    connected: true,
    disconnectTimer: null,
  }
}

async function startGame(a: QueueEntry, b: QueueEntry) {
  const tc = TIME_CONTROLS[a.tc]
  const whiteIsA = Math.random() < 0.5
  const white = seatFromEntry(whiteIsA ? a : b, whiteIsA ? a.socketId : b.socketId)
  const black = seatFromEntry(whiteIsA ? b : a, whiteIsA ? b.socketId : a.socketId)

  const game: ServerGame = {
    id: crypto.randomUUID(),
    white,
    black,
    chess: new Chess(),
    initialSec: tc.initialSec,
    incSec: tc.incSec,
    pool: tc.pool,
    rated: true,
    whiteMs: tc.initialSec * 1000,
    blackMs: tc.initialSec * 1000,
    turnStartedAt: Date.now(),
    drawOfferBy: null,
    finished: false,
  }
  games.set(game.id, game)
  activeGameByUser.set(white.userId, game)
  activeGameByUser.set(black.userId, game)

  await prisma.onlineGame.create({
    data: {
      id: game.id,
      whiteId: white.userId,
      blackId: black.userId,
      whiteName: white.username,
      blackName: black.username,
      pool: game.pool,
      initialSec: game.initialSec,
      incSec: game.incSec,
      rated: true,
    },
  })

  for (const [seat, color] of [[white, 'w'], [black, 'b']] as const) {
    const opponent = color === 'w' ? black : white
    const sock = io.sockets.sockets.get(seat.socketId!)
    if (!sock) continue
    sock.join(roomOf(game.id))
    sock.emit('match:found', {
      game: {
        id: game.id,
        color,
        initialSec: game.initialSec,
        incSec: game.incSec,
        pool: game.pool,
        white: seatView(white),
        black: seatView(black),
        opponent: seatView(opponent),
        fen: game.chess.fen(),
        moves: [],
        ...clockView(game),
      },
    })
  }

  // full state to the room so white sees it is their move
  emitState(game)
}

async function endGame(
  g: ServerGame,
  result: '1-0' | '0-1' | '1/2-1/2',
  termination: string,
  opts: { rated?: boolean } = {},
) {
  if (g.finished) return
  g.finished = true
  const rated = opts.rated ?? g.rated
  const whiteMoves = Math.ceil(g.chess.history().length / 2)
  const blackMoves = Math.floor(g.chess.history().length / 2)
  const rateable = rated && whiteMoves >= 2 && blackMoves >= 2

  try {
    g.chess.header('Event', `ChessX ${g.pool}`)
    g.chess.header('White', g.white.username)
    g.chess.header('Black', g.black.username)
    g.chess.header('Result', result)
  } catch {
    /* headers are best effort */
  }
  const pgn = g.chess.pgn()

  let whiteDelta: number | null = null
  let blackDelta: number | null = null
  let whiteAfter: number | null = null
  let blackAfter: number | null = null

  if (rateable) {
    const whiteScore = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5
    const blackScore = 1 - whiteScore

    const [wRow, bRow] = await Promise.all([ratingFor(g.white.userId, g.pool), ratingFor(g.black.userId, g.pool)])
    const now = Date.now()
    const wIdle = Math.floor((now - (wRow.lastGameAt?.getTime() ?? 0)) / 86_400_000)
    const bIdle = Math.floor((now - (bRow.lastGameAt?.getTime() ?? 0)) / 86_400_000)
    const wPre = { rating: wRow.rating, rd: inflateRd(wRow.rd, wIdle) }
    const bPre = { rating: bRow.rating, rd: inflateRd(bRow.rd, bIdle) }

    const wRes = applyGlicko(wPre, bPre, whiteScore)
    const bRes = applyGlicko(bPre, wPre, blackScore)

    await Promise.all([
      prisma.userRating.update({
        where: { userId_pool: { userId: g.white.userId, pool: g.pool } },
        data: {
          rating: wRes.rating,
          rd: wRes.rd,
          lastGameAt: new Date(now),
          games: { increment: 1 },
          wins: { increment: whiteScore === 1 ? 1 : 0 },
          losses: { increment: whiteScore === 0 ? 1 : 0 },
          draws: { increment: whiteScore === 0.5 ? 1 : 0 },
        },
      }),
      prisma.userRating.update({
        where: { userId_pool: { userId: g.black.userId, pool: g.pool } },
        data: {
          rating: bRes.rating,
          rd: bRes.rd,
          lastGameAt: new Date(now),
          games: { increment: 1 },
          wins: { increment: blackScore === 1 ? 1 : 0 },
          losses: { increment: blackScore === 0 ? 1 : 0 },
          draws: { increment: blackScore === 0.5 ? 1 : 0 },
        },
      }),
      prisma.onlineGame.update({
        where: { id: g.id },
        data: {
          result,
          termination,
          whiteDelta: wRes.delta,
          blackDelta: bRes.delta,
          whiteRating: Math.round(wRes.rating),
          blackRating: Math.round(bRes.rating),
          pgn,
          endedAt: new Date(now),
        },
      }),
    ])

    whiteDelta = wRes.delta
    blackDelta = bRes.delta
    whiteAfter = Math.round(wRes.rating)
    blackAfter = Math.round(bRes.rating)
  } else {
    await prisma.onlineGame.update({
      where: { id: g.id },
      data: { result, termination, pgn, endedAt: new Date() },
    })
  }

  for (const [seat, color] of [[g.white, 'w'], [g.black, 'b']] as const) {
    const isWhite = color === 'w'
    const myDelta = isWhite ? whiteDelta : blackDelta
    const myNew = isWhite ? whiteAfter : blackAfter
    io.to(seat.socketId ?? '').emit('game:over', {
      id: g.id,
      result,
      termination,
      color,
      myDelta,
      myNewRating: myNew,
      rated: rateable,
      pgn,
    })
  }

  games.delete(g.id)
  activeGameByUser.delete(g.white.userId)
  activeGameByUser.delete(g.black.userId)
}

async function abortGame(g: ServerGame, reason: string) {
  if (g.finished) return
  g.finished = true
  await prisma.onlineGame
    .update({ where: { id: g.id }, data: { result: '*', termination: reason, endedAt: new Date() } })
    .catch(() => {})
  io.to(roomOf(g.id)).emit('game:aborted', { id: g.id, reason })
  games.delete(g.id)
  activeGameByUser.delete(g.white.userId)
  activeGameByUser.delete(g.black.userId)
}

function flagOrEnd(g: ServerGame) {
  const c = g.chess
  if (c.isCheckmate()) {
    void endGame(g, c.turn() === 'w' ? '0-1' : '1-0', 'checkmate')
    return true
  }
  if (c.isStalemate()) {
    void endGame(g, '1/2-1/2', 'stalemate')
    return true
  }
  if (c.isInsufficientMaterial()) {
    void endGame(g, '1/2-1/2', 'insufficient material')
    return true
  }
  if (c.isThreefoldRepetition()) {
    void endGame(g, '1/2-1/2', 'repetition')
    return true
  }
  if (c.isDraw()) {
    void endGame(g, '1/2-1/2', 'fifty-move rule')
    return true
  }
  return false
}

// clock sweep: flag the side to move if their time ran out
setInterval(() => {
  const now = Date.now()
  for (const g of games.values()) {
    if (g.finished) continue
    const elapsed = now - g.turnStartedAt
    if (g.chess.turn() === 'w' && g.whiteMs - elapsed <= 0) {
      g.whiteMs = 0
      void endGame(g, '0-1', 'timeout')
      continue
    }
    if (g.chess.turn() === 'b' && g.blackMs - elapsed <= 0) {
      g.blackMs = 0
      void endGame(g, '1-0', 'timeout')
    }
  }
}, SWEEP_MS)

// matchmaking tick
setInterval(() => void tryMatch(), 400)

io.on('connection', (socket) => {
  let authed = false

  // temporary introspection for live debugging (ids only, no user data)
  socket.on('debug:state', () => {
    socket.emit('debug:state', {
      queue: [...queue.values()].map((e) => ({ userId: e.userId.slice(-4), tc: e.tc, socketId: e.socketId?.slice(0, 6) })),
      sessions: [...sessions.entries()].map(([sid, s]) => ({ sid: sid.slice(0, 6), userId: s.userId.slice(-4) })),
      games: games.size,
    })
  })

  socket.on('auth', async ({ ticket }: { ticket: string }) => {
    if (authed) return
    if (typeof ticket !== 'string' || ticket.length < 10) {
      socket.emit('auth:failed', { error: 'Invalid ticket' })
      return
    }
    const row = await prisma.socketTicket.findUnique({ where: { id: ticket }, include: { user: true } })
    if (!row || row.used || row.expiresAt.getTime() < Date.now()) {
      socket.emit('auth:failed', { error: 'Ticket expired' })
      return
    }
    await prisma.socketTicket.update({ where: { id: ticket }, data: { used: true } })
    authed = true

    // single live session per account: an old socket gets kicked
    const old = byUser.get(row.userId)
    if (old) {
      const oldSock = io.sockets.sockets.get(old)
      if (oldSock) oldSock.emit('auth:replaced', {})
      sessions.delete(old)
      for (const [uid, e] of queue) if (e.socketId === old) queue.delete(uid)
    }

    sessions.set(socket.id, { userId: row.user.id, username: row.user.username })
    byUser.set(row.user.id, socket.id)

    const ratings = await prisma.userRating.findMany({ where: { userId: row.user.id } })
    socket.emit('auth:ok', {
      username: row.user.username,
      ratings: Object.fromEntries(ratings.map((r) => [r.pool, { rating: Math.round(r.rating), rd: Math.round(r.rd), games: r.games }])),
    })

    // rejoin a live game after a refresh or reconnect
    const live = activeGameByUser.get(row.user.id)
    if (live && !live.finished) {
      const seat = live.white.userId === row.user.id ? live.white : live.black
      const wasDisconnected = !seat.connected
      if (seat.disconnectTimer) {
        clearTimeout(seat.disconnectTimer)
        seat.disconnectTimer = null
      }
      seat.socketId = socket.id
      seat.connected = true
      socket.join(roomOf(live.id))
      const color = live.white.userId === row.user.id ? 'w' : 'b'
      const opponent = color === 'w' ? live.black : live.white
      socket.emit('game:rejoined', {
        game: {
          id: live.id,
          color,
          initialSec: live.initialSec,
          incSec: live.incSec,
          pool: live.pool,
          white: seatView(live.white),
          black: seatView(live.black),
          opponent: seatView(opponent),
          fen: live.chess.fen(),
          moves: live.chess.history(),
          drawOfferBy: live.drawOfferBy,
          ...clockView(live),
        },
      })
      if (wasDisconnected) {
        socket.to(roomOf(live.id)).emit('opponent:connected', { username: row.user.username })
        emitState(live)
      }
    }
  })

  socket.on('queue:join', async ({ tc }: { tc: string }) => {
    const user = currentUser(socket.id)
    if (!user) {
      console.log('[queue] join from UNAUTHED socket', socket.id.slice(0, 6))
      return
    }
    const conf = TIME_CONTROLS[tc]
    if (!conf) {
      socket.emit('queue:error', { error: 'Unknown time control' })
      return
    }
    if (activeGameByUser.has(user.userId)) {
      socket.emit('queue:error', { error: 'Finish your current game first' })
      return
    }
    const row = await ratingFor(user.userId, conf.pool)
    queue.set(user.userId, {
      socketId: socket.id,
      userId: user.userId,
      username: user.username,
      tc,
      pool: conf.pool,
      rating: row.rating,
      rd: row.rd,
      games: row.games,
      joinedAt: Date.now(),
    })
    socket.emit('queue:ok', { tc, pool: conf.pool })
    void tryMatch()
  })

  socket.on('queue:leave', () => {
    const user = currentUser(socket.id)
    if (user) leaveQueue(user.userId)
  })

  socket.on('move:make', ({ gameId, from, to, promotion }: { gameId: string; from: string; to: string; promotion?: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished) return
    const color = g.white.userId === user.userId ? 'w' : g.black.userId === user.userId ? 'b' : null
    if (!color || color !== g.chess.turn()) return

    const now = Date.now()
    const elapsed = now - g.turnStartedAt
    if (color === 'w') g.whiteMs -= elapsed
    else g.blackMs -= elapsed
    if (g.whiteMs <= 0) return void endGame(g, '0-1', 'timeout')
    if (g.blackMs <= 0) return void endGame(g, '1-0', 'timeout')

    try {
      const mv = g.chess.move({ from, to, promotion: promotion || undefined })
      if (!mv) return
    } catch {
      return
    }

    if (color === 'w') g.whiteMs += g.incSec * 1000
    else g.blackMs += g.incSec * 1000
    g.turnStartedAt = now
    g.drawOfferBy = null

    if (flagOrEnd(g)) return
    emitState(g)
  })

  socket.on('resign', ({ gameId }: { gameId: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished) return
    if (g.white.userId === user.userId) void endGame(g, '0-1', 'resignation')
    else if (g.black.userId === user.userId) void endGame(g, '1-0', 'resignation')
  })

  socket.on('draw:offer', ({ gameId }: { gameId: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished) return
    const color = g.white.userId === user.userId ? 'w' : g.black.userId === user.userId ? 'b' : null
    if (!color) return
    g.drawOfferBy = color
    socket.to(roomOf(g.id)).emit('draw:offered', { by: color })
  })

  socket.on('draw:accept', ({ gameId }: { gameId: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished || !g.drawOfferBy) return
    const myColor = g.white.userId === user.userId ? 'w' : g.black.userId === user.userId ? 'b' : null
    if (!myColor || myColor === g.drawOfferBy) return
    void endGame(g, '1/2-1/2', 'agreement')
  })

  socket.on('draw:decline', ({ gameId }: { gameId: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished) return
    g.drawOfferBy = null
    socket.to(roomOf(g.id)).emit('draw:declined', {})
  })

  socket.on('claim:win', ({ gameId }: { gameId: string }) => {
    const user = currentUser(socket.id)
    if (!user) return
    const g = games.get(gameId)
    if (!g || g.finished) return
    const oppSeat = g.white.userId === user.userId ? g.black : g.white
    if (oppSeat.connected) return
    const myColor = g.white.userId === user.userId ? 'w' : 'b'
    void endGame(g, myColor === 'w' ? '1-0' : '0-1', 'abandonment')
  })

  socket.on('disconnect', () => {
    const user = sessions.get(socket.id)
    sessions.delete(socket.id)
    if (!user) return
    if (byUser.get(user.userId) === socket.id) byUser.delete(user.userId)
    leaveQueue(user.userId)

    const g = activeGameByUser.get(user.userId)
    if (!g || g.finished) return
    const seat = g.white.userId === user.userId ? g.white : g.black
    const opponent = seat === g.white ? g.black : g.white
    seat.connected = false

    const totalMoves = g.chess.history().length
    // fewer than 2 moves by each side: abort immediately, nothing rated
    if (Math.ceil(totalMoves / 2) < 2 || Math.floor(totalMoves / 2) < 2) {
      void abortGame(g, 'abandoned')
      return
    }
    if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer)
    seat.disconnectTimer = setTimeout(() => {
      if (g.finished || seat.connected) return
      const myColor = seat === g.white ? 'w' : 'b'
      void endGame(g, myColor === 'w' ? '0-1' : '1-0', 'abandonment')
    }, RECONNECT_GRACE_MS)
    io.to(opponent.socketId ?? '').emit('opponent:disconnected', { graceMs: RECONNECT_GRACE_MS })
  })
})

// keep an unused import path alive for prisma composite keys
// ratingFor covers all rating lookups

console.log(`ChessX game service listening on :${PORT}`)
