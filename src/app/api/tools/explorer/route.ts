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
  /** 'explorer': real community game stats. 'cloud': community database
   * unreachable from this server; the Lichess cloud engine's verified
   * evaluation is served instead so the panel stays honest and useful. */
  mode?: 'explorer' | 'cloud'
  cloudDepth?: number
  cloudCp?: number | null
  cloudMate?: number | null
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
      // The community database answers 401 from some datacenter IPs. Fall back
      // to the Lichess cloud engine (a different host, usually reachable) so
      // the panel degrades to verified engine lines instead of an error.
      const cloud = await cloudEval(fen)
      if (cloud) {
        cachePut(fen, cloud.payload)
        return NextResponse.json({ ...cloud.payload, cached: false })
      }
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
      mode: 'explorer',
    }
    cachePut(fen, payload)
    return NextResponse.json({ ...payload, cached: false })
  } catch (e) {
    const cloud = await cloudEval(fen).catch(() => null)
    if (cloud) {
      cachePut(fen, cloud.payload)
      return NextResponse.json({ ...cloud.payload, cached: false })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Could not reach the explorer database (${msg.slice(0, 80)}).` }, { status: 502 })
  }
}

/** Lichess cloud-eval fallback: real engine output for positions the cloud
 * has seen. Returns null when the host is unreachable or the position is
 * unknown — never invents a line. */
async function cloudEval(fen: string): Promise<{ payload: ExplorerPayload } | null> {
  try {
    const res = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=3`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) },
    )
    if (!res.ok) return null
    const raw = (await res.json()) as {
      pvs?: { moves?: string; cp?: number; mate?: number }[]
      depth?: number
    }
    const pvs = Array.isArray(raw.pvs) ? raw.pvs.slice(0, 3) : []
    if (!pvs.length) return null
    const moves: ExplorerMove[] = []
    for (const pv of pvs) {
      const uciList = String(pv.moves ?? '').trim().split(/\s+/).filter(Boolean)
      const first = uciList[0]
      if (!first || first.length < 4) continue
      const g = new Chess(fen)
      let san: string
      try {
        const mv = g.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first.slice(4, 5) || undefined })
        if (!mv) continue
        san = mv.san
      } catch {
        continue
      }
      // In cloud mode there are no game stats; the row shows the engine's
      // continuation and the eval rides in the header text.
      moves.push({ uci: first, san, white: 0, draws: 0, black: 0, averageRating: undefined })
    }
    if (!moves.length) return null
    const firstPv = pvs[0]
    return {
      payload: {
        fen,
        white: 0,
        draws: 0,
        black: 0,
        moves,
        opening: null,
        mode: 'cloud',
        cloudDepth: Number(raw.depth ?? 0) || undefined,
        cloudCp: typeof firstPv.cp === 'number' ? firstPv.cp : null,
        cloudMate: typeof firstPv.mate === 'number' ? firstPv.mate : null,
      },
    }
  } catch {
    return null
  }
}
