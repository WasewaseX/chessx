// Small shared helpers for API routes: strict numeric request parsing, a
// profile serializer that never leaks secret fields, and the deterministic
// daily puzzle rotation shared by the daily and attempt routes.
// Server side only: this module pulls in the puzzle content pool.
import 'server-only'
import { PUZZLES } from '@/content/puzzles'

/**
 * Parse a numeric request value safely. Anything non finite (NaN, garbage
 * strings) or missing (null, undefined, empty string) falls back, and the
 * result is always clamped to [min, max], so Prisma never sees NaN or an
 * out-of-band number from a forged request.
 */
export function numOr(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') {
    return Math.min(max, Math.max(min, fallback))
  }
  const n = Number(value)
  const base = Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, base))
}

/**
 * Profile shape sent to clients: the raw AI API key never leaves the server,
 * the response only carries whether one is set.
 */
export function publicProfile(p: unknown): Record<string, unknown> {
  const { aiApiKey, ...rest } = (p ?? {}) as Record<string, unknown>
  return { ...rest, hasApiKey: Boolean(aiApiKey) }
}

/**
 * Deterministic daily puzzle: same position for everyone on a given day, and
 * a GUARANTEED full cycle: a fixed seeded permutation of the pool walked by
 * the day counter, so every puzzle appears exactly once per cycle before any
 * repeats (a plain hash % len can repeat early and skip others entirely).
 */
function seededPermutation(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  // xorshift on a fixed seed: deterministic forever, well-shuffled.
  let s = 0x9e3779b9 >>> 0
  const next = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s
  }
  for (let i = n - 1; i > 0; i--) {
    const j = next() % (i + 1)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

let permCache: { len: number; perm: number[] } | null = null
function poolPermutation(len: number): number[] {
  if (permCache?.len === len) return permCache.perm
  const perm = seededPermutation(len)
  permCache = { len, perm }
  return perm
}

export function dailyPuzzleIndex(dayKey: string): number {
  // Days since 1970-01-01 UTC parsed straight from the yyyy-mm-dd key, so
  // the sequence is stable regardless of timezone interpretation.
  const [y, m, d] = dayKey.split('-').map(Number)
  const days = Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000)
  const perm = poolPermutation(PUZZLES.length)
  return perm[((days % PUZZLES.length) + PUZZLES.length) % PUZZLES.length]
}

/** The puzzle id that owns `dayKey`; used to validate daily completions. */
export function dailyPuzzleIdFor(dayKey: string): string {
  return PUZZLES[dailyPuzzleIndex(dayKey)].id
}
