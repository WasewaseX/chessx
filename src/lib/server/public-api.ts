// HTTP plumbing for the public, key-less API: CORS, rate limiting with
// honest X-RateLimit-* headers, and one uniform error envelope. Every
// /api/public route runs through withPublic() so the docs card, the headers
// and the actual behavior can never drift apart.
import { NextRequest, NextResponse } from 'next/server'
import { publicRateLimit } from './public-rate-limit'
import type { LichessPuzzle } from './lichess-bank'

const WINDOW_MS = 60_000
const LIMIT = 30

/** Best-effort client IP (the sandbox proxies forward x-forwarded-for). */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** OPTIONS preflight for the open CORS policy (204, cacheable). */
export function preflight(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  })
}

/**
 * Rate-limit one public handler per IP+route (30 req/min), wrap its JSON
 * response with the rate-limit + CORS headers, and turn unexpected throws
 * into a 500 instead of an HTML error page. The handler returns the
 * NextResponse it wants to send; headers are attached here so route files
 * stay tiny and cannot forget them.
 */
export async function withPublic(req: NextRequest, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const verdict = publicRateLimit(`${clientIp(req)}|${req.nextUrl.pathname}`, LIMIT, WINDOW_MS)
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(verdict.limit),
    'X-RateLimit-Remaining': String(verdict.remaining),
    'X-RateLimit-Reset': String(verdict.reset),
    ...CORS_HEADERS,
  }
  if (!verdict.ok) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded: ${LIMIT} requests per minute per IP. Retry in ${verdict.retryAfter}s.`,
      },
      { status: 429, headers: { ...headers, 'Retry-After': String(verdict.retryAfter) } },
    )
  }
  try {
    const res = await handler()
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    return res
  } catch {
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500, headers })
  }
}

/**
 * Spoiler-free puzzle row for the public surface: position, rating, themes
 * and the solution's move COUNT (never the moves themselves, never the
 * title, never the source URL — same redaction rules as the in-app daily).
 */
export function sanitizePuzzle(lp: LichessPuzzle): {
  id: string
  fen: string
  rating: number
  themes: string[]
  moveCount: number
} {
  return {
    id: lp.id,
    fen: lp.fen,
    rating: lp.rating,
    themes: lp.themes,
    moveCount: lp.movesUci.length,
  }
}
