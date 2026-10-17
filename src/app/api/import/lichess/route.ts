import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/auth'

/**
 * Lichess-only fetch fallback for the game import panel.
 *
 * lichess.org serves game PGNs to browsers directly (CORS-open), so the panel
 * always tries the browser first. This proxy exists for the rare network where
 * even that fails: the server tries once more from its own IP. It is honest and
 * tiny — it only relays https://lichess.org/ URLs, returns { pgn } text, and
 * never touches any other host. Session is not required; the endpoint is
 * rate-limited to 20 requests per minute per IP (in-memory, per process).
 */

const WINDOW_MS = 60_000
const LIMIT = 20
const MAX_PGN_BYTES = 3_000_000

function ipOf(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null
  const raw = typeof body?.url === 'string' ? body.url : ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return NextResponse.json({ error: 'A lichess.org URL is required.' }, { status: 400 })
  }
  const host = target.hostname.replace(/^www\./, '').toLowerCase()
  if (target.protocol !== 'https:' || host !== 'lichess.org') {
    return NextResponse.json({ error: 'Only https://lichess.org URLs are allowed.' }, { status: 400 })
  }
  if (!rateLimit(`import-lichess:${ipOf(req)}`, LIMIT, WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many lichess fallback requests — wait a minute and try again.' }, { status: 429 })
  }
  try {
    const upstream = await fetch(target.toString(), {
      headers: { Accept: 'application/x-chess-pgn' },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: `lichess answered HTTP ${upstream.status}.` }, { status: 502 })
    }
    const pgn = await upstream.text()
    if (pgn.length > MAX_PGN_BYTES) {
      return NextResponse.json({ error: 'That response is too large to relay.' }, { status: 502 })
    }
    return NextResponse.json({ pgn })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Could not reach lichess from the server: ${msg}` }, { status: 502 })
  }
}
