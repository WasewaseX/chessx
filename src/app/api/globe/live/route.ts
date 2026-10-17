// GET /api/globe/live — featured live games from lichess TV for the Chess
// Globe on the Home view. Picks the first 8 channels from a fixed priority
// list, fetches each channel's current PGN (8s timeout, allSettled so one
// slow channel can't sink the rest), parses headers + replays the moves with
// chess.js for an honest ply count, and caches the whole payload in memory
// for 20 seconds. On TOTAL failure it answers 502 with an honest message —
// it never invents games. Rate limit: 10 requests/min per IP (this route
// fans out to 9 upstream requests, so it is deliberately tighter than the
// public surface's 30/min).
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { clientIp } from '@/lib/server/public-api'
import { publicRateLimit } from '@/lib/server/public-rate-limit'

const TTL_MS = 20_000
const UPSTREAM_TIMEOUT_MS = 8_000
const RATE_LIMIT = 10
const WINDOW_MS = 60_000
const MAX_GAMES = 8

/** Fixed priority list; the first 8 keys present on lichess TV are used. */
const CHANNEL_PRIORITY = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'ultraBullet',
  'chess960',
  'crazyhouse',
  'kingOfTheHill',
  'horde',
  'antichess',
  'atomic',
  'threeCheck',
  'racingKings',
  'computer',
  'bot',
  'topRated',
] as const

export interface GlobeGame {
  channel: string
  gameId: string
  white: { name: string; elo: number | null }
  black: { name: string; elo: number | null }
  plies: number
  /** Final FEN after replaying every legal move — proof the replay happened. */
  fen: string
  result: string
}

interface GlobePayload {
  games: GlobeGame[]
  updatedAt: string
}

interface TvChannelInfo {
  user?: { name?: string; rating?: number }
  gameId?: string
  color?: string
}

let cache: { at: number; payload: GlobePayload } | null = null
let inflight: Promise<GlobePayload> | null = null

async function fetchWithTimeout(url: string, ms: number, accept: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { headers: { Accept: accept }, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

/** First `\[Header "value"]` line of a PGN, or null. */
function pgnHeader(pgn: string, name: string): string | null {
  const re = new RegExp(`^\\s*\\[${name}\\s+"([^"]*)"\\]`, 'm')
  const m = re.exec(pgn)
  return m ? m[1] : null
}

function parseElo(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** https://lichess.org/AbCdEfGh#3 -> AbCdEfGh (Site header fallback). */
function gameIdFromSite(site: string | null): string {
  if (!site) return ''
  const tail = site.split('/').pop() ?? ''
  return tail.split('#')[0].trim()
}

/**
 * Strip headers/comments/variations/NAGs/move numbers, then replay the SAN
 * tokens through chess.js. Illegal token -> stop and keep the honest count
 * of what actually replayed.
 */
function replayPgn(pgn: string): { plies: number; fen: string } {
  let s = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ')
  for (let i = 0; i < 20 && /\(/.test(s); i++) s = s.replace(/\([^()]*\)/g, ' ')
  s = s
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\b\d+\.(?:\.\.)?/g, ' ')
    .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
  const tokens = s.trim().split(/\s+/).filter(Boolean)
  const board = new Chess()
  let plies = 0
  for (const san of tokens) {
    try {
      board.move(san)
      plies += 1
    } catch {
      break
    }
  }
  return { plies, fen: board.fen() }
}

async function loadGlobeGames(): Promise<GlobePayload> {
  const channelsRes = await fetchWithTimeout(
    'https://lichess.org/api/tv/channels',
    UPSTREAM_TIMEOUT_MS,
    'application/json',
  )
  if (!channelsRes.ok) throw new Error(`tv/channels answered ${channelsRes.status}`)
  const channels = (await channelsRes.json()) as Record<string, TvChannelInfo>

  const picked = CHANNEL_PRIORITY.filter((c) => channels[c]).slice(0, MAX_GAMES)
  const settled = await Promise.allSettled(
    picked.map(async (channel): Promise<GlobeGame> => {
      const res = await fetchWithTimeout(
        `https://lichess.org/api/tv/${channel}`,
        UPSTREAM_TIMEOUT_MS,
        'application/x-chess-pgn',
      )
      if (!res.ok) throw new Error(`tv/${channel} answered ${res.status}`)
      const pgn = await res.text()
      const info = channels[channel]
      const whiteName = pgnHeader(pgn, 'White') || info?.user?.name || 'White'
      const blackName = pgnHeader(pgn, 'Black') || 'Black'
      const gameId = info?.gameId || gameIdFromSite(pgnHeader(pgn, 'Site'))
      if (!gameId) throw new Error(`tv/${channel} has no game id`)
      const { plies, fen } = replayPgn(pgn)
      return {
        channel,
        gameId,
        white: { name: whiteName, elo: parseElo(pgnHeader(pgn, 'WhiteElo')) },
        black: { name: blackName, elo: parseElo(pgnHeader(pgn, 'BlackElo')) },
        plies,
        fen,
        result: pgnHeader(pgn, 'Result') ?? '*',
      }
    }),
  )

  const games = settled
    .filter((r): r is PromiseFulfilledResult<GlobeGame> => r.status === 'fulfilled')
    .map((r) => r.value)
  if (games.length === 0) throw new Error('every lichess TV channel failed')

  return { games, updatedAt: new Date().toISOString() }
}

function load(): Promise<GlobePayload> {
  if (!inflight) {
    inflight = loadGlobeGames().finally(() => {
      inflight = null
    })
  }
  return inflight
}

export async function GET(req: NextRequest) {
  const verdict = publicRateLimit(`${clientIp(req)}|${req.nextUrl.pathname}`, RATE_LIMIT, WINDOW_MS)
  if (!verdict.ok) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded: ${RATE_LIMIT} requests per minute per IP. Retry in ${verdict.retryAfter}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfter) } },
    )
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const payload = await load()
    cache = { at: Date.now(), payload }
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[globe/live] lichess TV is unreachable:', err)
    return NextResponse.json(
      { error: 'live games are unreachable right now' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
