// Standalone in-memory sliding-window rate limiter for the public, key-less
// API surface. Deliberately NOT the session limiter in src/lib/auth.ts: the
// public API must never let anonymous traffic share (or exhaust) a signed-in
// user's per-route budget, and it needs remaining/reset accounting to feed
// the honest X-RateLimit-* headers on every response.

const WINDOW_MS = 60_000
export const PUBLIC_RATE_LIMIT = 30

const buckets = new Map<string, number[]>()

export interface PublicRateVerdict {
  ok: boolean
  limit: number
  /** Hits left in the current window after this request (0 when rejected). */
  remaining: number
  /** Unix seconds (UTC) at which the oldest hit leaves the window. */
  reset: number
  /** Whole seconds a rejected client should wait before retrying. */
  retryAfter: number
}

export function publicRateLimit(key: string, limit = PUBLIC_RATE_LIMIT, windowMs = WINDOW_MS): PublicRateVerdict {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    const opensAt = hits[0] + windowMs
    return {
      ok: false,
      limit,
      remaining: 0,
      reset: Math.ceil(opensAt / 1000),
      retryAfter: Math.max(1, Math.ceil((opensAt - now) / 1000)),
    }
  }
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > 5000) {
    // keep the map from growing forever in the sandbox (same hygiene as auth.ts)
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t > windowMs)) buckets.delete(k)
    }
  }
  return {
    ok: true,
    limit,
    remaining: limit - hits.length,
    reset: Math.ceil((hits[0] + windowMs) / 1000),
    retryAfter: 0,
  }
}
