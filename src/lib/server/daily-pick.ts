// Single source of truth for "which puzzle is THE daily puzzle today", and
// the fix for a real bug: the daily route served a Lichess bank/API pick
// while /api/puzzles/attempt validated completions against the curated pool
// rotation (dailyPuzzleIdFor) — two different sources of truth, so a solved
// daily could silently never register as done.
//
// resolveDaily() picks once (live Lichess API daily via lichess-bank ->
// curated rotation), hands the same object to every caller, and remembers
// the served id PER DAY. expectedDailyId() returns exactly that id for
// validation, falling back to the curated rotation when nothing was served
// in this deployment lifetime.
//
// The served-id registry is DURABLE (a tiny JSON file, atomic rename), not
// a module map: in dev each route compiles as its own bundle, so a
// module-scoped map written by the daily route is invisible to the attempt
// route's own module copy (the exact lesson of the Oct 31 served-puzzles
// store in lichess-bank.ts). The file is one ~50-byte line.
import 'server-only'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { lichessDaily } from './lichess-bank'
import { PUZZLES } from '@/content/puzzles'
import { dailyPuzzleIndex } from '@/lib/api'

const SERVED_DAILY_PATH = path.join(process.cwd(), 'db', 'served-daily.json')

export interface DailyPick {
  id: string
  fen: string
  rating: number
  themes: string[]
  /** Solution length in moves — safe to publish, the moves themselves are not. */
  moveCount: number
  /** Where today's pick came from — surfaced honestly in public payloads. */
  source: 'lichess-daily' | 'curated'
}

function readServedDaily(): { dayKey: string; id: string } | null {
  try {
    if (!existsSync(SERVED_DAILY_PATH)) return null
    const raw = JSON.parse(readFileSync(SERVED_DAILY_PATH, 'utf8')) as {
      dayKey?: string
      id?: string
    }
    if (!raw?.dayKey || !raw?.id) return null
    return { dayKey: String(raw.dayKey).slice(0, 10), id: String(raw.id).slice(0, 40) }
  } catch {
    /* corrupt file = nothing served in this lifetime; the curated fallback owns the day */
    return null
  }
}

function writeServedDaily(dayKey: string, id: string): void {
  try {
    const tmp = `${SERVED_DAILY_PATH}.tmp`
    writeFileSync(tmp, JSON.stringify({ dayKey: dayKey.slice(0, 10), id: id.slice(0, 40) }))
    renameSync(tmp, SERVED_DAILY_PATH)
  } catch {
    /* best effort — a failed persist only costs a daily-completion credit */
  }
}

/** The id actually served for `dayKey` by any route bundle of this deployment. */
export function servedDailyId(dayKey: string): string | null {
  const hit = readServedDaily()
  return hit && hit.dayKey === String(dayKey).slice(0, 10) ? hit.id : null
}

/**
 * The id a daily completion for `dayKey` is validated against: the id this
 * deployment actually served when asked, else the curated rotation.
 */
export function expectedDailyId(dayKey: string): string {
  return servedDailyId(dayKey) ?? dailyPuzzleIdFor(dayKey)
}

function curatedPick(dayKey: string): DailyPick {
  const p = PUZZLES[dailyPuzzleIndex(dayKey)]
  return {
    id: p.id,
    fen: p.fen,
    rating: p.rating,
    themes: p.themes,
    moveCount: p.solution.split(' ').filter(Boolean).length,
    source: 'curated',
  }
}

/**
 * Resolve the daily puzzle for `dayKey` — live Lichess daily first (cached
 * six hours inside lichess-bank), curated rotation as the floor. Always
 * resolves: a daily that 500s is a bug, never a network condition.
 */
export async function resolveDaily(dayKey: string): Promise<DailyPick> {
  try {
    if (lichessAvailable()) {
      const lp = await lichessDaily(dayKey)
      if (lp) {
        writeServedDaily(dayKey, lp.id)
        return {
          id: lp.id,
          fen: lp.fen,
          rating: lp.rating,
          themes: lp.themes,
          moveCount: lp.movesUci.length,
          source: 'lichess-daily',
        }
      }
    }
  } catch {
    /* fall through to the curated rotation */
  }
  const pick = curatedPick(dayKey)
  writeServedDaily(dayKey, pick.id)
  return pick
}
