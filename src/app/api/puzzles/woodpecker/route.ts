import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { lichessAvailable, lichessById, lichessCount, lichessWindow } from '@/lib/server/lichess-bank'
import { PUZZLE_THEMES } from '@/content/schema'
import { PUZZLES } from '@/content/puzzles'

/**
 * The Woodpecker method: one FIXED set of puzzles per theme, replayed cycle
 * after cycle. The next cycle unlocks only when a run is FASTER than the
 * best AND at least as accurate — the player is sharpening the same moves,
 * not hunting fresh puzzles.
 *
 * GET                -> the player's sets (theme, size, cycle, bests, last run)
 * GET ?theme&size=   -> the fixed set for that theme, built once and stored
 *                       (ids live in WoodpeckerSet.idsJson; the bank is read
 *                       again by id so the wire carries fens, never solutions)
 * POST               -> record a completed cycle: { theme, ms, accuracy,
 *                       solved, total } and apply the unlock rule
 *
 * Grading during a run never goes through this route: the client replays the
 * standard /api/puzzles/move flow exactly like Rated, so a solution never
 * crosses the wire before the solver earns it.
 */

const SET_SIZES = [12, 20, 30] as const
const MIN_SET = 6

interface SetPuzzle {
  id: string
  fen: string
  rating: number
}

function serializeSet(s: {
  theme: string
  kind: string
  size: number
  cycle: number
  bestMs: number | null
  bestAccuracy: number | null
  lastRunAt: Date | null
}) {
  return {
    theme: s.theme,
    kind: s.kind,
    size: s.size,
    cycle: s.cycle,
    bestMs: s.bestMs,
    bestAccuracy: s.bestAccuracy,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
  }
}

async function requireProfile(user: { id: string; username: string }) {
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  return profile
}

/** Build a themed pool from the bank, or the curated pool as a fallback. */
function buildSetPuzzles(theme: string, size: number, rating: number): { puzzles: SetPuzzle[]; kind: 'lichess' | 'curated' } | null {
  if (lichessAvailable()) {
    // A wide themed window around the player's rating, then the closest
    // `size` rows, lightly shuffled. The order gets frozen into idsJson, so
    // every later cycle faces the identical sequence.
    const pool = lichessWindow(rating, Math.min(400, Math.max(80, size * 8)), [theme])
    if (pool.length > 0) {
      const sorted = [...pool].sort(
        (a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating),
      )
      const picked = sorted.slice(0, size)
      for (let i = picked.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[picked[i], picked[j]] = [picked[j], picked[i]]
      }
      return {
        puzzles: picked.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating })),
        kind: 'lichess',
      }
    }
  }
  // Curated fallback: same shape, honest kind label.
  const pool = PUZZLES.filter((p) => p.themes.includes(theme))
  if (pool.length === 0) return null
  const sorted = [...pool].sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating))
  const picked = sorted.slice(0, Math.max(MIN_SET, Math.min(size, pool.length)))
  return {
    puzzles: picked.map((p) => ({ id: p.id, fen: p.fen, rating: p.rating })),
    kind: 'curated',
  }
}

/** Materialize stored ids into solvable stubs, skipping vanished bank rows. */
function materializeIds(ids: string[]): SetPuzzle[] {
  const out: SetPuzzle[] = []
  for (const id of ids) {
    const lp = lichessById(id)
    if (lp) out.push({ id: lp.id, fen: lp.fen, rating: lp.rating })
  }
  return out
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const themeParam = req.nextUrl.searchParams.get('theme')
  if (!themeParam) {
    const rows = await db.woodpeckerSet.findMany({
      where: { profileId: (await requireProfile(user)).id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({
      sets: rows.map(serializeSet),
      bankAvailable: lichessAvailable(),
      lichessTotal: lichessCount(),
    })
  }

  const theme = themeParam.trim()
  if (!Object.prototype.hasOwnProperty.call(PUZZLE_THEMES, theme)) {
    return NextResponse.json({ error: 'Unknown theme' }, { status: 400 })
  }
  const sizeParam = Number(req.nextUrl.searchParams.get('size') ?? 12)
  const size = SET_SIZES.includes(sizeParam as (typeof SET_SIZES)[number]) ? sizeParam : 12

  const profile = await requireProfile(user)
  const rating = profile.puzzleRating ?? 1200
  const existing = await db.woodpeckerSet.findUnique({
    where: { profileId_theme: { profileId: profile.id, theme } },
  })

  // A set of the same size already exists: serve it unchanged — that is the
  // entire point of the method. Only a different size rebuilds (and resets
  // the personal-best line, honestly: it is a different set).
  if (existing && existing.size === size) {
    let puzzles: SetPuzzle[] = []
    try {
      const ids = JSON.parse(existing.idsJson) as unknown
      if (Array.isArray(ids)) puzzles = materializeIds(ids.map(String))
    } catch {
      puzzles = []
    }
    if (puzzles.length >= MIN_SET) {
      return NextResponse.json({
        ...serializeSet(existing),
        size: puzzles.length,
        puzzles: puzzles.slice(0, size),
      })
    }
    // The bank changed underneath us: fall through and rebuild.
  }

  const built = buildSetPuzzles(theme, size, rating)
  if (!built || built.puzzles.length < MIN_SET) {
    return NextResponse.json(
      { error: 'Not enough puzzles in this theme yet. Pick another theme.' },
      { status: 422 },
    )
  }
  const rebuilt = existing !== null && existing.size !== size
  const data = {
    theme,
    kind: built.kind,
    idsJson: JSON.stringify(built.puzzles.map((p) => p.id)),
    size: built.puzzles.length,
    ...(rebuilt ? { cycle: 1, bestMs: null, bestAccuracy: null } : {}),
  }
  const row = await db.woodpeckerSet.upsert({
    where: { profileId_theme: { profileId: profile.id, theme } },
    create: { profileId: profile.id, ...data },
    update: data,
  })
  return NextResponse.json({
    ...serializeSet(row),
    puzzles: built.puzzles,
  })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { theme?: unknown; ms?: unknown; accuracy?: unknown; solved?: unknown; total?: unknown }
    | null
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 })

  const theme = String(body.theme ?? '').trim()
  if (!Object.prototype.hasOwnProperty.call(PUZZLE_THEMES, theme)) {
    return NextResponse.json({ error: 'Unknown theme' }, { status: 400 })
  }
  const ms = Math.round(Number(body.ms))
  const accuracy = Number(body.accuracy)
  const solved = Math.round(Number(body.solved))
  const total = Math.round(Number(body.total))
  if (!Number.isFinite(ms) || ms < 0 || ms > 6 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Invalid ms' }, { status: 400 })
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
    return NextResponse.json({ error: 'Invalid accuracy' }, { status: 400 })
  }
  if (!Number.isFinite(solved) || solved < 0 || !Number.isFinite(total) || total < 1 || solved > total || total > 100) {
    return NextResponse.json({ error: 'Invalid solved/total' }, { status: 400 })
  }

  const profile = await requireProfile(user)
  const existing = await db.woodpeckerSet.findUnique({
    where: { profileId_theme: { profileId: profile.id, theme } },
  })

  // First run (or a set with no finished run yet): cycle 1 is complete and
  // cycle 2 unlocks. Later runs unlock the next cycle only when this one is
  // faster than the best AND at least as accurate.
  const first = !existing || (existing.bestMs === null && existing.bestAccuracy === null)
  const unlocked = first || (ms < (existing?.bestMs ?? Infinity) && accuracy >= (existing?.bestAccuracy ?? -1))
  const cycle = first ? 2 : unlocked ? (existing?.cycle ?? 1) + 1 : (existing?.cycle ?? 1)
  const bestMs = first ? ms : Math.min(existing?.bestMs ?? ms, ms)
  const bestAccuracy = first ? accuracy : Math.max(existing?.bestAccuracy ?? accuracy, accuracy)

  const row = await db.woodpeckerSet.upsert({
    where: { profileId_theme: { profileId: profile.id, theme } },
    create: {
      profileId: profile.id,
      theme,
      size: total,
      cycle,
      bestMs,
      bestAccuracy,
      lastRunAt: new Date(),
    },
    update: {
      size: total,
      cycle,
      bestMs,
      bestAccuracy,
      lastRunAt: new Date(),
    },
  })

  return NextResponse.json({
    cycle: row.cycle,
    unlocked,
    bestMs: row.bestMs,
    bestAccuracy: row.bestAccuracy,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
  })
}
