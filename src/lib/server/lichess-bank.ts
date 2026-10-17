// The Lichess puzzle bank: the app's puzzle core. db/puzzles.db holds the
// quality-filtered slice of the official Lichess puzzle database (popularity
// >= 50, rating deviation <= 120, every rating band), imported by
// scripts/import-lichess-puzzles.ts. This module is the ONLY reader: it opens
// the file read-only and lazily, and if it is missing or unreadable every
// function degrades to null/empty so the app never crashes — callers fall
// back to the curated PUZZLES pool exactly as before.
import 'server-only'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { Chess } from 'chess.js'

export interface LichessPuzzle {
  id: string
  fen: string
  /** The full solution in UCI, solver moves at even indexes, replies at odd. */
  movesUci: string[]
  rating: number
  /**
   * Theme tags mapped to this app's concept ids where an honest mapping
   * exists; unmapped Lichess themes keep their raw Lichess id and still
   * count when a filter is asked for by that raw id.
   */
  themes: string[]
  gameUrl: string
  openingTags: string[]
}

const DB_PATH = path.join(process.cwd(), 'db', 'puzzles.db')

// ---------------------------------------------------------------------------
// Lazy read-only singleton. A missing file must never take the app down, so
// failures are cached for a short window and re-probed afterwards (the file
// can appear once the import finishes without a server restart).
// ---------------------------------------------------------------------------
let db: DatabaseSync | null = null
let lastFailure = 0
const RETRY_AFTER_MS = 30_000

function getDb(): DatabaseSync | null {
  if (db) return db
  if (Date.now() - lastFailure < RETRY_AFTER_MS) return null
  try {
    if (!existsSync(DB_PATH)) {
      lastFailure = Date.now()
      return null
    }
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    return db
  } catch {
    lastFailure = Date.now()
    return null
  }
}

export function lichessAvailable(): boolean {
  return getDb() !== null
}

/** True row count — surfaced in the UI as honest proof the bank is real. */
let countCache: { at: number; value: number } | null = null
const COUNT_CACHE_MS = 60_000

export function lichessCount(): number {
  const cached = countCache
  if (cached && Date.now() - cached.at < COUNT_CACHE_MS) return cached.value
  const d = getDb()
  if (!d) return 0
  try {
    const row = d.prepare('SELECT COUNT(*) c FROM puzzles').get() as { c: number | bigint }
    const n = Number(row.c)
    countCache = { at: Date.now(), value: n }
    return n
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Theme mapping: Lichess theme ids -> this app's concept ids (src/content/
// schema.ts). The rule is honesty: only map when the Lichess theme really is
// the app concept; everything else stays raw.
// ---------------------------------------------------------------------------
const LICHESS_TO_APP: Record<string, string> = {
  mate: 'mate',
  mateIn1: 'mate',
  mateIn2: 'mate',
  mateIn3: 'mate',
  mateIn4: 'mate',
  mateIn5: 'mate',
  backRankMate: 'mate',
  smotheredMate: 'mate',
  anastasiaMate: 'mate',
  arabianMate: 'mate',
  bodenMate: 'mate',
  dovetailMate: 'mate',
  hookMate: 'mate',
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discoveredAttack: 'discoveredAttack',
  doubleCheck: 'discoveredAttack',
  attackingF2F7: 'doubleAttack',
  queensideAttack: 'doubleAttack',
  kingsideAttack: 'kingSafety',
  exposedKing: 'kingSafety',
  sacrifice: 'sacrifice',
  trappedPiece: 'winningMaterial',
  hangingPiece: 'hangingPiece',
  capturingDefender: 'removingDefender',
  deflection: 'deflection',
  promotion: 'promotion',
  underpromotion: 'promotion',
  endgame: 'endgame',
  bishopEndgame: 'endgame',
  knightEndgame: 'endgame',
  pawnEndgame: 'endgame',
  rookEndgame: 'endgame',
  zugzwang: 'zugzwang',
  defensiveMove: 'defense',
}

/** Reverse view used to build SQL filters from app concept ids. */
const APP_TO_LICHESS: Record<string, string[]> = {}
for (const [lichess, app] of Object.entries(LICHESS_TO_APP)) {
  ;(APP_TO_LICHESS[app] ??= []).push(lichess)
}

/** Apply the mapping; unmapped Lichess ids pass through untouched. */
function mapThemes(raw: string): string[] {
  const out: string[] = []
  for (const t of raw.split(' ')) {
    if (!t) continue
    const mapped = LICHESS_TO_APP[t]
    const id = mapped ?? t
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** SQL fragment for an app concept filter: OR-ed LIKEs over the raw ids. */
function themePatterns(themes: string[] | undefined): string[] {
  if (!themes || themes.length === 0) return []
  const out: string[] = []
  for (const t of themes) {
    const raws = APP_TO_LICHESS[t] ?? [t]
    for (const r of raws) out.push(`% ${r} %`)
  }
  return out
}

interface Row {
  id: string
  fen: string
  moves: string
  rating: number
  themes: string
  gameurl: string
  openingtags: string
}

const COLS = 'id, fen, moves, rating, themes, gameurl, openingtags'

function rowToPuzzle(r: Row | undefined | null): LichessPuzzle | null {
  if (!r || !r.id || !r.fen || !r.moves) return null
  const movesUci = String(r.moves).split(' ').filter(Boolean)
  if (movesUci.length === 0) return null
  return {
    id: r.id,
    fen: r.fen,
    movesUci,
    rating: Number(r.rating) || 1000,
    themes: mapThemes(String(r.themes ?? '')),
    gameUrl: String(r.gameurl ?? ''),
    openingTags: String(r.openingtags ?? '').split(' ').filter(Boolean),
  }
}

function rowsToPuzzles(rows: unknown[]): LichessPuzzle[] {
  const out: LichessPuzzle[] = []
  for (const r of rows) {
    const p = rowToPuzzle(r as Row)
    if (p) out.push(p)
  }
  return out
}

/** One puzzle by id — the grading/reveal path. */
export function lichessById(id: string): LichessPuzzle | null {
  const d = getDb()
  if (!d) return null
  try {
    const row = d.prepare(`SELECT ${COLS} FROM puzzles WHERE id = ?`).get(String(id).slice(0, 30))
    return rowToPuzzle(row as unknown as Row)
  } catch {
    return null
  }
}

/** Theme chips: real counts for the themes that exist in the served window. */
export function lichessThemeStats(limit = 60): { theme: string; count: number }[] {
  const d = getDb()
  if (!d) return []
  try {
    const rows = d.prepare('SELECT theme, count FROM theme_stats ORDER BY count DESC LIMIT ?').all(limit)
    return rows.map((r) => ({ theme: String((r as { theme: string }).theme), count: Number((r as { count: number }).count) }))
  } catch {
    return []
  }
}

/**
 * A bounded window around a rating for the client-side puzzle index (theme
 * chips, battle deals, vision deals). Mixed relevance: the closest band
 * first, then progressively wider slices, all popularity-ordered, then a
 * final shuffle so the client's own picks are not deterministic.
 *
 * Results are cached per (rating, themes) key for ten minutes: the served
 * window is large (400 rows), the client reshuffles its picks locally, and
 * on a memory-tight host the 1.3GB bank's pages evict constantly — a cache
 * here keeps every repeat mount instant instead of re-reading from disk.
 */
const WINDOW_CACHE_MS = 10 * 60 * 1000
const windowCache = new Map<string, { at: number; rows: LichessPuzzle[] }>()
const WINDOW_CACHE_MAX = 24

export function lichessWindow(rating: number, size = 400, themes?: string[]): LichessPuzzle[] {
  const d = getDb()
  if (!d) return []
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const key = `${target}|${size}|${(themes ?? []).slice().sort().join(',')}`
  const hit = windowCache.get(key)
  if (hit && Date.now() - hit.at < WINDOW_CACHE_MS) return hit.rows
  try {
    const patterns = themePatterns(themes)
    const themeClause = patterns.length
      ? ` AND (${patterns.map(() => `(' ' || themes || ' ') LIKE ?`).join(' OR ')})`
      : ''
    const seen = new Set<string>()
    const out: LichessPuzzle[] = []
    const slices: [number, number][] = [
      [150, 150],
      [300, 130],
      [600, 80],
      [1200, 60],
    ]
    for (const [width, take] of slices) {
      if (out.length >= size) break
      const rows = d
        .prepare(
          `SELECT ${COLS} FROM puzzles WHERE rating BETWEEN ? AND ?${themeClause} ORDER BY nbplays DESC LIMIT ?`,
        )
        .all(target - width, target + width, ...patterns, take) as unknown as Row[]
      for (const r of rows) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        const p = rowToPuzzle(r)
        if (p) out.push(p)
        if (out.length >= size) break
      }
    }
    // Fisher-Yates over the assembled window: the client chips/battle deals
    // should not see the same ordering twice.
    for (let k = out.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1))
      ;[out[k], out[r]] = [out[r], out[k]]
    }
    if (windowCache.size >= WINDOW_CACHE_MAX) {
      const oldest = windowCache.keys().next().value
      if (oldest !== undefined) windowCache.delete(oldest)
    }
    windowCache.set(key, { at: Date.now(), rows: out })
    return out
  } catch {
    return []
  }
}

/** FNV-1a: tiny, stable across processes — the daily seed. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h >>>= 0
  }
  return h >>> 0
}

/**
 * The deterministic daily puzzle: the same position for everyone on the same
 * day. The day string seeds the pick; the rowid scan keeps it stable for the
 * lifetime of the database file. Moderate band (1000-2000) so the daily is
 * fair for every level.
 */
export function lichessDaily(dayKey: string): LichessPuzzle | null {
  const d = getDb()
  if (!d) return null
  try {
    const maxRow = (d.prepare('SELECT MAX(rowid) m FROM puzzles').get() as { m: number | null }).m
    if (!maxRow) return null
    const start = hashSeed(dayKey) % maxRow
    const sql = `SELECT ${COLS} FROM puzzles WHERE rating BETWEEN 1000 AND 2000 AND rowid >= ? ORDER BY rowid LIMIT 1`
    const hit = rowToPuzzle(d.prepare(sql).get(start) as unknown as Row)
    if (hit) return hit
    // The band ran out past the seed point: wrap to the beginning of it.
    return rowToPuzzle(
      d
        .prepare(`SELECT ${COLS} FROM puzzles WHERE rating BETWEEN 1000 AND 2000 ORDER BY rowid LIMIT 1`)
        .get() as unknown as Row,
    )
  } catch {
    return null
  }
}

/**
 * A big shuffled batch ordered easy to hard — the Puzzle Rush feed. Buckets
 * walk the whole rating range; inside each bucket the most-played puzzles of
 * a random rowid window are taken (rowids are uncorrelated with rating in
 * the Lichess export, so the window is the cheap source of variety), and the
 * final list keeps the easy->hard order with a light shuffle inside
 * near-equal rating groups.
 */
export function lichessRushBatch(size = 250): LichessPuzzle[] {
  const d = getDb()
  if (!d) return []
  try {
    const perBucket = 28
    const buckets: [number, number][] = []
    for (let lo = 500; lo < 3200; lo += 300) buckets.push([lo, lo + 300])
    const all: LichessPuzzle[] = []
    const seen = new Set<string>()
    const maxRow = (d.prepare('SELECT MAX(rowid) m FROM puzzles').get() as { m: number | null }).m ?? 0
    for (const [lo, hi] of buckets) {
      let rows: Row[] = []
      if (maxRow > 10_000) {
        const start = Math.floor(Math.random() * Math.max(1, maxRow - 8000))
        rows = d
          .prepare(
            `SELECT ${COLS} FROM puzzles WHERE rowid BETWEEN ? AND ? AND rating BETWEEN ? AND ? ORDER BY nbplays DESC LIMIT ?`,
          )
          .all(start, start + 8000, lo, hi, perBucket) as unknown as Row[]
      }
      if (rows.length < 8) {
        // Sparse band (the very top of the ladder): fall back to the most
        // played puzzles of the whole band.
        rows = d
          .prepare(
            `SELECT ${COLS} FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY nbplays DESC LIMIT ?`,
          )
          .all(lo, hi, perBucket) as unknown as Row[]
      }
      for (const r of rows) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        const p = rowToPuzzle(r)
        if (p) all.push(p)
      }
      if (all.length >= size) break
    }
    // easy -> hard overall, light shuffle inside same-rating groups so runs
    // do not feel memorized.
    const sorted = all.sort((a, b) => a.rating - b.rating).slice(0, size)
    let i = 0
    while (i < sorted.length) {
      let j = i
      while (j < sorted.length && sorted[j].rating === sorted[i].rating) j++
      const group = sorted.slice(i, j)
      for (let k = group.length - 1; k > 0; k--) {
        const r = Math.floor(Math.random() * (k + 1))
        ;[group[k], group[r]] = [group[r], group[k]]
      }
      i = j
    }
    return sorted
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Cold-start warmup: the bank is a 1.3GB file and a fresh install (or a
// server restart) starts with a cold page cache — the first COUNT(*) and the
// first window query then take seconds, which the puzzle view experiences as
// a hang and retries against, piling requests up. warmBank() runs the hot
// paths once in the background right after boot so the first real request is
// instant. Idempotent and best-effort.
// ---------------------------------------------------------------------------
let warmed = false

export function warmBank(): void {
  if (warmed) return
  const d = getDb()
  if (!d) return
  warmed = true
  setImmediate(() => {
    try {
      lichessCount()
    } catch {
      /* best effort */
    }
    try {
      lichessWindow(1200, 400)
    } catch {
      /* best effort */
    }
    try {
      lichessThemeStats(60)
    } catch {
      /* best effort */
    }
  })
}

// ---------------------------------------------------------------------------
// Adapter for the grading/reveal pipeline (Puzzle-shaped)
// ---------------------------------------------------------------------------

/**
 * Convert a Lichess puzzle into the app's Puzzle shape: the UCI line becomes
 * SAN once, here, server-side. The title is deliberately neutral — the design
 * brief forbids headlines that spoil the motif; post-solve surfaces show the
 * source line instead.
 */
export function lichessToAppPuzzle(lp: LichessPuzzle): {
  id: string
  fen: string
  solution: string
  rating: number
  themes: string[]
  title: string
  source?: string
} {
  const g = new Chess(lp.fen)
  const sans: string[] = []
  for (const uci of lp.movesUci) {
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length === 5 ? uci[4] : undefined
    const mv = g.move({ from, to, ...(promotion ? { promotion } : {}) })
    sans.push(mv.san)
  }
  return {
    id: lp.id,
    fen: lp.fen,
    solution: sans.join(' '),
    rating: lp.rating,
    themes: lp.themes,
    title: 'Lichess Puzzle',
    source: lp.gameUrl || undefined,
  }
}
