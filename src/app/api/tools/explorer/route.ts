// Opening Explorer backend: proxies the Lichess community-games database
// (explorer.lichess.ovh) so the browser never talks to a third party directly
// and every response passes through this app's own validation, caching and
// rate limits. Responses are cached in memory for 10 minutes: opening
// statistics move slowly, and the explorer API is a shared free service that
// this app must treat politely.
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, clientIp, rateLimit } from '@/lib/auth'
import { Chess } from 'chess.js'

export const maxDuration = 15

const EXPLORER_URL = 'https://explorer.lichess.ovh/lichess'
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 300

interface ExplorerMove {
  uci: string
  san: string
  white: number
  draws: number
  black: number
  averageRating?: number
}

interface ExplorerPayload {
  fen: string
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  opening: { eco: string; name: string } | null
}

const cache = new Map<string, { at: number; payload: ExplorerPayload }>()

function cacheGet(key: string): ExplorerPayload | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.payload
}

function cachePut(key: string, payload: ExplorerPayload) {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), payload })
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`explorer:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })
  }

  const fenParam = req.nextUrl.searchParams.get('fen')?.slice(0, 120) ?? ''
  let fen: string
  try {
    // Validate and normalize: the explorer wants a full FEN, and this gate
    // also blocks arbitrary strings from ever reaching the upstream URL.
    const g = new Chess(fenParam || undefined)
    fen = g.fen()
  } catch {
    return NextResponse.json({ error: 'Invalid FEN.' }, { status: 400 })
  }

  const cached = cacheGet(fen)
  if (cached) return NextResponse.json({ ...cached, cached: true })

  const url = new URL(EXPLORER_URL)
  url.searchParams.set('variant', 'standard')
  url.searchParams.set('fen', fen)
  url.searchParams.set('speeds', 'blitz,rapid,classical')
  url.searchParams.set('ratings', '1000,1200,1400,1600,1800,2000,2200,2500')
  url.searchParams.set('topGames', '0')
  url.searchParams.set('recentGames', '0')
  url.searchParams.set('moves', '12')

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `The explorer database answered with HTTP ${res.status}.` }, { status: 502 })
    }
    const raw = (await res.json()) as Record<string, unknown>
    const payload: ExplorerPayload = {
      fen,
      white: Number(raw.white ?? 0),
      draws: Number(raw.draws ?? 0),
      black: Number(raw.black ?? 0),
      moves: Array.isArray(raw.moves)
        ? (raw.moves as Record<string, unknown>[]).slice(0, 12).map((m) => ({
            uci: String(m.uci ?? '').slice(0, 6),
            san: String(m.san ?? '').slice(0, 8),
            white: Number(m.white ?? 0),
            draws: Number(m.draws ?? 0),
            black: Number(m.black ?? 0),
            averageRating: m.averageRating != null ? Number(m.averageRating) : undefined,
          }))
        : [],
      opening:
        raw.opening && typeof raw.opening === 'object'
          ? {
              eco: String((raw.opening as Record<string, unknown>).eco ?? ''),
              name: String((raw.opening as Record<string, unknown>).name ?? ''),
            }
          : null,
    }
    cachePut(fen, payload)
    return NextResponse.json({ ...payload, cached: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Could not reach the explorer database (${msg.slice(0, 80)}).` }, { status: 502 })
  }
}
