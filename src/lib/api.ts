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
 * Deterministic daily puzzle: same position for everyone on a given day,
 * rotating through the whole pool before repeating.
 */
export function dailyPuzzleIndex(dayKey: string): number {
  let h = 0
  for (let i = 0; i < dayKey.length; i++) {
    h = (h * 31 + dayKey.charCodeAt(i)) >>> 0
  }
  return h % PUZZLES.length
}

/** The puzzle id that owns `dayKey`; used to validate daily completions. */
export function dailyPuzzleIdFor(dayKey: string): string {
  return PUZZLES[dailyPuzzleIndex(dayKey)].id
}
