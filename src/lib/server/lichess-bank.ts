// The puzzle core — LIGHTWEIGHT EDITION (Oct 24 decision: the 1.57GB
// db/puzzles.db serving bank is retired; the app streams from two light
// sources instead):
//
//   1. db/puzzle-pack.json (~542 curated puzzles, ~130KB, in git) — built by
//      scripts/build-puzzle-pack.ts from the old bank's quality slice
//      (popularity >= 50, rd <= 120): every rating band 600-2795, every
//      opening the repertoire courses teach, every theme the concept map
//      references. Powers the rated windows, theme chips, opening training
//      windows, the rush ladder and the deterministic daily fallback.
//      No disk I/O after the first read, no page cache, no download.
//
//   2. the free lichess puzzle API (no auth) — the real daily puzzle,
//      fetched once and cached for hours; a served-puzzle LRU makes every
//      API-served puzzle gradable/revealable by id exactly like bank rows
//      were. Solutions still never leave the server before the solve.
//
// The exported surface is IDENTICAL to the bank edition, so every route,
// the daily plan, the grader and the public API keep their contracts.
// Failures degrade to the pack (never to a crash), exactly as before.
import 'server-only'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'
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

const PACK_PATH = path.join(process.cwd(), 'db', 'puzzle-pack.json')

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

/** Reverse view used to build theme filters from app concept ids. */
const APP_TO_LICHESS: Record<string, string[]> = {}
for (const [lichess, app] of Object.entries(LICHESS_TO_APP)) {
  ;(APP_TO_LICHESS[app] ??= []).push(lichess)
}

/** Apply the mapping; unmapped Lichess ids pass through untouched. */
function mapThemes(raw: string | string[]): string[] {
  const ids = Array.isArray(raw) ? raw : raw.split(' ')
  const out: string[] = []
  for (const t of ids) {
    if (!t) continue
    const id = LICHESS_TO_APP[t] ?? t
    if (!out.includes(id)) out.push(id)
  }
  return out
}

// ---------------------------------------------------------------------------
// Pack load: one small file, parsed once, kept in memory (~a few hundred KB).
// A missing/corrupt pack must never take the app down — every consumer
// already handles empty results, and the curated PUZZLES pool remains the
// final fallback in the routes.
// ---------------------------------------------------------------------------
interface PackEntry {
  id: string
  fen: string
  m: string // UCI solution line
  r: number
  t: string // raw lichess theme ids
  u: string
  o: string // raw opening tags
}

let pack: LichessPuzzle[] = []
let packLoaded = false

function loadPack(): void {
  if (packLoaded) return
  packLoaded = true
  try {
    const raw = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as { puzzles: PackEntry[] }
    for (const e of raw.puzzles ?? []) {
      const movesUci = String(e.m ?? '').split(' ').filter(Boolean)
      if (!e.id || !e.fen || movesUci.length === 0) continue
      pack.push({
        id: e.id,
        fen: e.fen,
        movesUci,
        rating: Number(e.r) || 1000,
        themes: mapThemes(e.t ?? ''),
        gameUrl: String(e.u ?? ''),
        openingTags: String(e.o ?? '').split(' ').filter(Boolean),
      })
    }
  } catch {
    pack = []
  }
}

/** O(1) id lookup over the pack. */
let packIndex: Map<string, LichessPuzzle> | null = null
function getPackIndex(): Map<string, LichessPuzzle> {
  loadPack()
  if (!packIndex) {
    packIndex = new Map(pack.map((p) => [p.id, p]))
  }
  return packIndex
}

export function lichessAvailable(): boolean {
  loadPack()
  return pack.length > 0
}

/** Honest size of the light source behind the puzzles (pack + served). */
export function lichessCount(): number {
  loadPack()
  loadServed()
  return pack.length + served.size
}

// ---------------------------------------------------------------------------
// Served-puzzle store: every puzzle dealt out from the lichess API (currently
// the daily) is registered here so the grading/reveal/attempt paths can
// resolve it by id — the role the bank played with lichessById. It MUST be a
// file, not memory: in dev each route compiles as its own bundle, so an
// in-memory map in the daily route is INVISIBLE to the move route's own
// module copy (found live: /api/puzzles/daily served 7i6QO, then
// /api/puzzles/move answered "puzzle not found" for it). The bank era shared
// truth through the 1.57GB file on disk; the light edition shares truth
// through this small file instead — same role, kilobytes, capped.
// ---------------------------------------------------------------------------
const SERVED_PATH = path.join(process.cwd(), 'db', 'served-puzzles.json')
const SERVED_MAX = 2000
const served = new Map<string, LichessPuzzle>()
let servedLoaded = false

interface ServedEntry {
  id: string
  fen: string
  m: string
  r: number
  t: string
  u: string
  o: string
}

function toEntry(p: LichessPuzzle): ServedEntry {
  return { id: p.id, fen: p.fen, m: p.movesUci.join(' '), r: p.rating, t: p.themes.join(' '), u: p.gameUrl, o: p.openingTags.join(' ') }
}

function fromEntry(e: ServedEntry): LichessPuzzle | null {
  const movesUci = String(e.m ?? '').split(' ').filter(Boolean)
  if (!e.id || !e.fen || movesUci.length === 0) return null
  return {
    id: e.id,
    fen: e.fen,
    movesUci,
    rating: Number(e.r) || 1000,
    themes: mapThemes(e.t ?? ''),
    gameUrl: String(e.u ?? ''),
    openingTags: String(e.o ?? '').split(' ').filter(Boolean),
  }
}

function loadServed(): void {
  if (servedLoaded) return
  servedLoaded = true
  try {
    if (!existsSync(SERVED_PATH)) return
    const raw = JSON.parse(readFileSync(SERVED_PATH, 'utf8')) as ServedEntry[]
    for (const e of raw) {
      const p = fromEntry(e)
      if (p) served.set(p.id, p)
    }
  } catch {
    /* a corrupt file just means the served map starts empty */
  }
}

function persistServed(): void {
  try {
    const tmp = `${SERVED_PATH}.tmp`
    writeFileSync(tmp, JSON.stringify([...served.values()].map(toEntry)))
    renameSync(tmp, SERVED_PATH)
  } catch {
    /* best effort — a failed persist only costs an id-resolution later */
  }
}

function registerServed(p: LichessPuzzle): void {
  loadServed()
  if (served.has(p.id)) served.delete(p.id)
  served.set(p.id, p)
  while (served.size > SERVED_MAX) {
    const oldest = served.keys().next().value
    if (oldest === undefined) break
    served.delete(oldest)
  }
  persistServed()
}

/** One puzzle by id — the grading/reveal path. */
export function lichessById(id: string): LichessPuzzle | null {
  loadServed()
  const key = String(id).slice(0, 30)
  const hit = served.get(key)
  if (hit) return hit
  return getPackIndex().get(key) ?? null
}

// ---------------------------------------------------------------------------
// Theme stats: computed from the pack once — honest counts for the chips.
// ---------------------------------------------------------------------------
let themeStatsCache: { theme: string; count: number }[] | null = null

export function lichessThemeStats(limit = 60): { theme: string; count: number }[] {
  loadPack()
  if (!themeStatsCache) {
    const counts = new Map<string, number>()
    for (const p of pack) {
      for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    themeStatsCache = [...counts.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
  }
  return themeStatsCache.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Windows: the same band-walk spirit as the bank edition, over a tiny
// in-memory array — closest band first, widened progressively, then shuffled
// so the client's own picks never feel deterministic. A 542-row scan is
// microseconds; no caching layer is needed anymore.
// ---------------------------------------------------------------------------
function shuffled<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let k = out.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1))
    ;[out[k], out[r]] = [out[r], out[k]]
  }
  return out
}

function themePatterns(themes: string[] | undefined): string[] {
  if (!themes || themes.length === 0) return []
  const out: string[] = []
  for (const t of themes) {
    const raws = APP_TO_LICHESS[t] ?? [t]
    for (const r of raws) out.push(r)
  }
  return out
}

function matchesThemes(p: LichessPuzzle, raws: string[]): boolean {
  if (raws.length === 0) return true
  // The pack stores mapped themes; re-derive the raw set membership honestly.
  // A mapped concept matches if ANY of its raw ids appears in the puzzle's
  // mapped themes (mapped ids equal the concept id) OR in its raw spelling.
  for (const r of raws) {
    const mapped = LICHESS_TO_APP[r] ?? r
    if (p.themes.includes(mapped) || p.themes.includes(r)) return true
  }
  return false
}

export function lichessWindow(rating: number, size = 400, themes?: string[]): LichessPuzzle[] {
  loadPack()
  if (pack.length === 0) return []
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const raws = themePatterns(themes)
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
    const band = pack
      .filter((p) => Math.abs(p.rating - target) <= width && matchesThemes(p, raws) && !seen.has(p.id))
      .sort((a, b) => a.rating - b.rating)
    // take from both edges of the band so the window spans it
    let lo = 0
    let hi = band.length - 1
    let picked = 0
    while (picked < take && lo <= hi && out.length < size) {
      const p = band[lo]
      if (!seen.has(p.id)) {
        seen.add(p.id)
        out.push(p)
        picked++
      }
      lo++
      if (picked >= take || lo > hi || out.length >= size) break
      const q = band[hi]
      if (!seen.has(q.id)) {
        seen.add(q.id)
        out.push(q)
        picked++
      }
      hi--
    }
  }
  // widest slice: if the pack is thin around this rating, top up with
  // anything matching the theme filter anywhere in the pack.
  if (out.length < Math.min(size, 80)) {
    for (const p of pack) {
      if (out.length >= size) break
      if (!seen.has(p.id) && matchesThemes(p, raws)) {
        seen.add(p.id)
        out.push(p)
      }
    }
  }
  return shuffled(out).slice(0, size)
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
 * Rating window filtered by lichess *opening* tags (e.g. `Sicilian_Defense
 * Najdorf_Variation`), honoring an exclusion list so a trainer session never
 * repeats a puzzle its player has seen.
 */
export function lichessOpeningWindow(
  rating: number,
  openings: string[],
  exclude: string[],
  size = 200,
): LichessPuzzle[] {
  loadPack()
  if (pack.length === 0) return []
  const tags = openings.map((t) => String(t).replace(/[^A-Za-z0-9_-]/g, '')).filter(Boolean).slice(0, 4)
  if (!tags.length) return []
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const excl = new Set([...new Set(exclude.map((e) => String(e).slice(0, 30)))])
  const matching = pack.filter((p) => {
    if (excl.has(p.id)) return false
    const raw = p.openingTags
    return tags.some((t) => raw.includes(t))
  })
  if (matching.length === 0) return []
  // nearest-to-target first with progressive widening, then shuffled
  matching.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))
  const window = matching.slice(0, Math.max(size, Math.min(matching.length, 60)))
  return shuffled(window).slice(0, size)
}

// ---------------------------------------------------------------------------
// The daily: lichess's free, unauthenticated /api/puzzle/daily — fetched at
// most once every 6h (a couple of KB of JSON + PGN), replayed to the puzzle
// position with chess.js, self-validated (the first solution move must be
// legal from the replayed position) and registered in the served LRU. On any
// failure the deterministic pack daily takes over — the same position for
// everyone on the same day, from the FNV-1a seed, exactly like the bank did.
// ---------------------------------------------------------------------------

interface LichessDailyJson {
  game?: { pgn?: string; id?: string }
  puzzle?: {
    id?: string
    rating?: number
    solution?: string[]
    themes?: string[]
    /** The puzzle position itself — present on daily/next responses. */
    fen?: string
    initialPly?: number
    gameUrl?: string
  }
}

function replayToPly(pgn: string, ply: number): string | null {
  try {
    const tokens = pgn
      .trim()
      .split(/\s+/)
      .filter((t) => t && !/^\d+\.*$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    const g = new Chess()
    const n = Math.max(0, Math.min(ply, tokens.length))
    for (let i = 0; i < n; i++) {
      g.move(tokens[i]) // throws on anything illegal — the validator
    }
    return g.fen()
  } catch {
    return null
  }
}

function dailyFromJson(j: LichessDailyJson): LichessPuzzle | null {
  const id = j.puzzle?.id
  const solution = j.puzzle?.solution ?? []
  const pgn = j.game?.pgn ?? ''
  if (!id || solution.length === 0 || !pgn) return null
  // The API ships the puzzle position directly (verified live: initialPly
  // replay gives a DIFFERENT position — the ply convention does not match
  // the truncated PGN — so the shipped fen is the authority, replay only as
  // a fallback for responses that lack it).
  const fen = j.puzzle?.fen || replayToPly(pgn, Number.isFinite(j.puzzle?.initialPly) ? Number(j.puzzle?.initialPly) : 9999)
  if (!fen) return null
  // Self-validation: the solver's first move must be legal from the replayed
  // position. A wrong ply convention would otherwise serve a broken board.
  try {
    const g = new Chess(fen)
    const uci = solution[0]
    g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) })
  } catch {
    return null
  }
  return {
    id: String(id).slice(0, 30),
    fen,
    movesUci: solution.map((m) => String(m)).filter(Boolean),
    rating: Number(j.puzzle?.rating) || 1500,
    themes: mapThemes((j.puzzle?.themes ?? []).map((t) => String(t))),
    gameUrl: `https://lichess.org/game/${j.game?.id ?? ''}`,
    openingTags: [],
  }
}

let dailyCache: { at: number; puzzle: LichessPuzzle | null; dayKey?: string } | null = null
const DAILY_TTL_MS = 6 * 60 * 60 * 1000
const DAILY_NEG_TTL_MS = 10 * 60 * 1000

async function fetchLichessDaily(): Promise<LichessPuzzle | null> {
  try {
    const res = await fetch('https://lichess.org/api/puzzle/daily', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const j = (await res.json()) as LichessDailyJson
    return dailyFromJson(j)
  } catch {
    return null
  }
}

function packDaily(dayKey: string): LichessPuzzle | null {
  loadPack()
  const band = pack.filter((p) => p.rating >= 1000 && p.rating <= 2000)
  const pool = band.length > 0 ? band : pack
  if (pool.length === 0) return null
  return pool[hashSeed(dayKey) % pool.length]
}

export async function lichessDaily(dayKey: string): Promise<LichessPuzzle | null> {
  const now = Date.now()
  if (dailyCache) {
    const ttl = dailyCache.puzzle ? DAILY_TTL_MS : DAILY_NEG_TTL_MS
    if (now - dailyCache.at < ttl) {
      // Same-day stability: a cached GOOD daily is only served while the day
      // key matches; a new day refetches (cheap) before falling back.
      if (dailyCache.puzzle && dailyCache.dayKey === dayKey) return dailyCache.puzzle
      if (!dailyCache.puzzle) return packDaily(dayKey)
    }
  }
  const fetched = await fetchLichessDaily()
  dailyCache = { at: now, puzzle: fetched, dayKey }
  if (fetched) {
    registerServed(fetched)
    return fetched
  }
  return packDaily(dayKey)
}

/**
 * A shuffled batch ordered easy to hard — the Puzzle Rush feed. The pack was
 * built band-by-band across the whole ladder, so it already IS the ladder.
 */
export function lichessRushBatch(size = 250): LichessPuzzle[] {
  loadPack()
  if (pack.length === 0) return []
  const sorted = [...pack].sort((a, b) => a.rating - b.rating).slice(0, size)
  // light shuffle inside same-rating groups so runs do not feel memorized
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
}

// ---------------------------------------------------------------------------
// Cold-start warmup: nothing heavy exists anymore, so this is an instant
// no-op kept for call-site compatibility (instrumentation/start-prod call it
// in the bank era; with the pack there is nothing to warm).
// ---------------------------------------------------------------------------
let warmed = false

export function warmBank(): void {
  if (warmed) return
  warmed = true
  loadPack()
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
