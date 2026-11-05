// The puzzle core — LIGHT EDITION. The 1.57GB puzzles.db serving bank is
// RETIRED (Nov 2 mandate: "the puzzle database is not needed, only use light
// free apis"). What replaced it:
//
//   1. db/puzzle-pack.json (~542 curated puzzles, ~130KB, in git) — built by
//      scripts/build-puzzle-pack.ts from the old bank's quality slice
//      (popularity >= 50, rd <= 120): every rating band 600-2795, every
//      opening the repertoire courses teach, every theme the concept map
//      references. Loaded once, zero disk I/O after that. It is the
//      always-there resilience layer: by-id grading fallback, theme chips,
//      and the fallback for windows/rush/openings when the upstream is down.
//
//   2. the free Lichess puzzle API (no key, no auth): /api/puzzle/daily and
//      /api/puzzle/next. VERIFIED UPSTREAM CONTRACT (probed live, Nov 2):
//        - anonymous `next` returns ONE puzzle per call and NO `fen`; the
//          position is derived by replaying game.pgn up to initialPly+1
//          plies (calibrated against the daily's real fen — 6/6 solution
//          replays clean), and EVERY candidate must replay its full UCI
//          solution or it is rejected, never served.
//        - the anonymous `themes` filter is IGNORED upstream; `opening`
//          works. Theme filtering therefore happens locally on candidates.
//      Windows are small parallel batches, deduped + TTL-cached (10 min),
//      so repeat hits are free and upstream load stays tiny.
//
//   3. the served-puzzle store: every puzzle dealt out from the API is
//      registered so grading/reveal/attempt can resolve it by id — the role
//      the bank played with lichessById. It MUST be durable, not just
//      memory: in dev each route compiles as its own bundle, so a
//      module-scoped map in the index route is INVISIBLE to the move route's
//      own module copy (caught live on Oct 31: /api/puzzles/daily served a
//      puzzle, then /api/puzzles/move answered "puzzle not found" for it).
//      Truth is therefore shared through a small capped JSON file on disk
//      (kilobytes, the role the 1.57GB file used to play) plus an in-memory
//      copy for zero-I/O hot reads.
//
// The exported surface is IDENTICAL to the bank edition, so every route,
// the daily plan, the grader and the public API keep their contracts —
// windows/rush/daily/opening are async now (network-backed), everything
// else stays sync. Failures degrade to the pack, then to the curated
// PUZZLES pool in the routes — never to a crash.
import 'server-only'
import { Chess } from 'chess.js'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

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
const SERVED_PATH = path.join(process.cwd(), 'db', 'served-puzzles.json')

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

// ---------------------------------------------------------------------------
// Served-puzzle store: durable, capped, cross-bundle. See the header — a
// module-scoped map cannot share truth between route bundles in dev, so the
// store persists to a small JSON file (atomic rename) with an in-memory copy
// for the hot path.
// ---------------------------------------------------------------------------
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

function registerServed(rows: LichessPuzzle[]): void {
  loadServed()
  let dirty = false
  for (const p of rows) {
    if (served.has(p.id)) served.delete(p.id)
    served.set(p.id, p)
    dirty = true
  }
  while (served.size > SERVED_MAX) {
    const oldest = served.keys().next().value
    if (oldest === undefined) break
    served.delete(oldest)
  }
  if (dirty) persistServed()
}

// ---------------------------------------------------------------------------
// Upstream health: one failed call is noise (a single 429 inside a parallel
// batch is normal); three inside the 60s window is an outage worth routing
// around (fast-path to the pack instead of waiting on timeouts).
// ---------------------------------------------------------------------------
const API_BASE = 'https://lichess.org/api/puzzle'
const FETCH_TIMEOUT_MS = 7_000
const USER_AGENT = 'chessx-app (puzzle feed; lightweight client)'

let lastFailureAt = 0
let failureCount = 0
const FAILURE_COOLDOWN_MS = 60_000

function markFailure(): void {
  const now = Date.now()
  if (now - lastFailureAt > FAILURE_COOLDOWN_MS) failureCount = 0
  failureCount += 1
  lastFailureAt = now
}

function markSuccess(): void {
  failureCount = 0
  lastFailureAt = 0
}

function apiDown(): boolean {
  if (Date.now() - lastFailureAt > FAILURE_COOLDOWN_MS) return false
  return failureCount >= 3
}

// ---------------------------------------------------------------------------
// Public availability: the app has puzzles as long as the pack exists. The
// API being down never makes the app "unavailable" — it degrades to the
// pack (then to the curated pool in the routes).
// ---------------------------------------------------------------------------
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

/** One puzzle by id — the grading/reveal path. Served rows first, then pack. */
export function lichessById(id: string): LichessPuzzle | null {
  loadServed()
  const key = String(id).slice(0, 30)
  const hit = served.get(key)
  if (hit) return hit
  return getPackIndex().get(key) ?? null
}

// ---------------------------------------------------------------------------
// Theme chips: computed from the pack once — honest counts for stable chips.
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
// Upstream client. One puzzle per anonymous call, hard timeouts, JSON
// validation, and a soundness gate that replays the whole solution.
// ---------------------------------------------------------------------------
interface ApiPuzzle {
  game?: { id?: string; pgn?: string }
  puzzle?: {
    id?: string
    fen?: string
    rating?: number
    solution?: unknown
    themes?: unknown
    initialPly?: number
    lastMove?: string
  }
}

/** One anonymous puzzle fetch. Throws on transport/HTTP failure. */
async function fetchOnePuzzle(query: string): Promise<ApiPuzzle> {
  const url = query ? `${API_BASE}/next?${query}` : `${API_BASE}/next`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      cache: 'no-store',
    })
    if (!res.ok) {
      // Counted once, in the catch below (the throw lands there).
      const err = new Error(`lichess ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    markSuccess()
    return (await res.json()) as ApiPuzzle
  } catch (err) {
    markFailure()
    throw err
  }
}

/**
 * Derive the puzzle position from the game PGN. The anonymous `next`
 * endpoint omits `fen`, so the position is derived by replaying the PGN up
 * to `initialPly + 1` plies (convention calibrated live against the daily,
 * which carries the real fen: replaying initialPly plies lands one half-move
 * BEFORE the puzzle; initialPly+1 matches it exactly).
 */
function deriveFen(pgn: string, initialPly: number): string | null {
  try {
    const full = new Chess()
    full.loadPgn(pgn)
    const hist = full.history()
    const g = new Chess()
    for (let k = 0; k < initialPly + 1 && k < hist.length; k++) g.move(hist[k])
    return g.fen()
  } catch {
    return null
  }
}

/**
 * Lichess response -> LichessPuzzle. Shipped fen is authoritative (the
 * daily carries it); otherwise the position is derived from the PGN. Every
 * candidate must then replay its full UCI solution cleanly — an unsound
 * puzzle is treated as if the fetch never happened.
 */
function toLichessPuzzle(entry: ApiPuzzle | undefined): LichessPuzzle | null {
  const p = entry?.puzzle
  const gameId = entry?.game?.id
  if (!p || !p.id || !Array.isArray(p.solution)) return null
  const movesUci = p.solution.map(String).filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))
  if (movesUci.length === 0) return null

  let fen = typeof p.fen === 'string' && p.fen ? p.fen : ''
  if (!fen) {
    const pgn = entry?.game?.pgn
    if (!pgn || typeof p.initialPly !== 'number' || p.initialPly < 0) return null
    fen = deriveFen(pgn, p.initialPly) ?? ''
    if (!fen) return null
  }

  // Soundness gate: the whole solution must replay from the position.
  try {
    const g = new Chess(fen)
    for (const uci of movesUci) {
      g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) })
    }
  } catch {
    return null
  }

  const themes = Array.isArray(p.themes) ? mapThemes(p.themes.map(String).join(' ')) : []
  const gameUrl = gameId
    ? `https://lichess.org/${gameId}${typeof p.initialPly === 'number' && p.initialPly > 0 ? `#${p.initialPly + 1}` : ''}`
    : ''
  return {
    id: String(p.id).slice(0, 30),
    fen,
    movesUci,
    rating: Number(p.rating) || 1000,
    themes,
    gameUrl,
    openingTags: [],
  }
}

/**
 * A small parallel batch of distinct puzzles. The anonymous API serves one
 * puzzle per call, so a window is N parallel calls; duplicates (the API can
 * repeat puzzles) are dropped. Failures degrade to fewer puzzles — the
 * caller decides whether that is enough.
 */
async function fetchPuzzleBatch(count: number, query: string): Promise<LichessPuzzle[]> {
  const n = Math.min(24, Math.max(1, Math.round(count)))
  const settled = await Promise.allSettled(Array.from({ length: n }, () => fetchOnePuzzle(query)))
  const seen = new Set<string>()
  const out: LichessPuzzle[] = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    const p = toLichessPuzzle(s.value)
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  if (out.length) registerServed(out)
  return out
}

/** Dedup + TTL cache. One entry per key; entries expire after ttlMs. */
class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>()
  private inflight = new Map<string, Promise<T>>()
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}
  get(key: string): { at: number; value: T } | null {
    const hit = this.store.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit
    if (hit) this.store.delete(key)
    return null
  }
  /** Deduped loader: parallel callers with the same key share one promise. */
  async load(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached) return cached.value
    const running = this.inflight.get(key)
    if (running) return running
    const p = loader()
      .then((value) => {
        // FIFO eviction: drop the oldest entry when full.
        if (this.store.size >= this.maxEntries) {
          const oldest = this.store.keys().next().value
          if (oldest !== undefined) this.store.delete(oldest)
        }
        this.store.set(key, { at: Date.now(), value })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }
}

function shuffle<T>(rows: T[]): T[] {
  for (let k = rows.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1))
    ;[rows[k], rows[r]] = [rows[r], rows[k]]
  }
  return rows
}

// FNV-1a: tiny, stable across processes — the deterministic daily fallback.
function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h >>>= 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Pack fallbacks: the band-walk spirit of the bank edition over a tiny
// in-memory array. A 542-row scan is microseconds; no caching layer needed.
// ---------------------------------------------------------------------------
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
  for (const r of raws) {
    const mapped = LICHESS_TO_APP[r] ?? r
    if (p.themes.includes(mapped) || p.themes.includes(r)) return true
  }
  return false
}

function packWindow(rating: number, size: number, themes?: string[]): LichessPuzzle[] {
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
        out.push(p)
        seen.add(p.id)
        picked++
      }
      lo++
      if (lo <= hi && picked < take && out.length < size) {
        const q = band[hi]
        if (!seen.has(q.id)) {
          out.push(q)
          seen.add(q.id)
          picked++
        }
        hi--
      }
    }
  }
  return shuffle(out.slice(0, size))
}

function packRushBatch(size: number): LichessPuzzle[] {
  loadPack()
  if (pack.length === 0) return []
  const sorted = [...pack].sort((a, b) => a.rating - b.rating).slice(0, size)
  // light shuffle inside same-rating groups so runs do not feel memorized
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && sorted[j].rating === sorted[i].rating) j++
    shuffle(sorted.slice(i, j))
    i = j
  }
  return sorted
}

function packOpeningWindow(rating: number, tag: string, exclude: Set<string>, size: number): LichessPuzzle[] {
  loadPack()
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const matching = pack.filter(
    (p) =>
      !exclude.has(p.id) &&
      Math.abs(p.rating - target) <= 300 &&
      p.openingTags.some((t) => t === tag || t.startsWith(tag)),
  )
  const pool = matching.length >= 6 ? matching : pack.filter((p) => !exclude.has(p.id) && p.openingTags.some((t) => t === tag || t.startsWith(tag)))
  return shuffle(pool.slice(0, Math.max(size, Math.min(pool.length, 60))))
}

function packDaily(dayKey: string): LichessPuzzle | null {
  loadPack()
  const band = pack.filter((p) => p.rating >= 1000 && p.rating <= 2000)
  const pool = band.length > 0 ? band : pack
  if (pool.length === 0) return null
  return pool[hashSeed(dayKey) % pool.length] ?? null
}

// ---------------------------------------------------------------------------
// Windows: fresh puzzles from the free API (small parallel batch, cached ten
// minutes per rating/theme combo), falling back to the pack band-walk when
// the upstream is down or a themed ask matches nothing locally. The
// anonymous upstream ignores theme filters, so themed asks over-fetch
// candidates and filter locally; a themed ask that matches nothing returns
// the pack's themed window instead — honest, never faked.
// ---------------------------------------------------------------------------
const windowCache = new TtlCache<LichessPuzzle[]>(10 * 60 * 1000, 24)
const WINDOW_MAX = 12

async function loadWindow(rating: number, size: number, themes: string[] | undefined): Promise<LichessPuzzle[]> {
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const want = Math.min(WINDOW_MAX, Math.max(8, size))
  if (!apiDown()) {
    if (themes && themes.length) {
      // Over-fetch candidates: not every fetched puzzle carries the theme.
      const pool = await fetchPuzzleBatch(Math.min(24, want * 3), `rating=${target}`)
      const filtered = pool.filter((p) => p.themes.some((t) => themes.includes(t)))
      if (filtered.length >= 6) return shuffle(filtered.slice(0, want))
    } else {
      const rows = await fetchPuzzleBatch(want, `rating=${target}`)
      if (rows.length >= 6) return shuffle(rows)
    }
  }
  // Upstream down (or too few sound themed candidates): the pack serves.
  return packWindow(target, want, themes)
}

export async function lichessWindow(rating: number, size = 400, themes?: string[]): Promise<LichessPuzzle[]> {
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const key = `${target}|${Math.min(WINDOW_MAX, size)}|${(themes ?? []).slice().sort().join(',')}`
  try {
    return await windowCache.load(key, () => loadWindow(target, Math.min(WINDOW_MAX, size), themes))
  } catch {
    return packWindow(target, Math.min(WINDOW_MAX, size), themes)
  }
}

/**
 * A rating window filtered by a Lichess opening family (e.g.
 * `Sicilian_Defense`) — the one anonymous filter the upstream honors. An
 * exclusion ring applies locally so a trainer session never repeats a
 * puzzle its player has seen. Falls back to the pack's opening slice.
 */
const openingCache = new TtlCache<LichessPuzzle[]>(10 * 60 * 1000, 16)
const OPENING_MAX = 12

export async function lichessOpeningWindow(
  rating: number,
  openings: string[],
  exclude: string[],
  size = 200,
): Promise<LichessPuzzle[]> {
  const tag = openings
    .map((t) => String(t).replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .slice(0, 1)[0]
  if (!tag) return []
  const target = Math.min(2800, Math.max(600, Math.round(rating) || 1200))
  const want = Math.min(OPENING_MAX, Math.max(8, size))
  const excl = new Set(exclude.map((e) => String(e).slice(0, 30)))
  const key = `o|${target}|${tag}|${want}|${excl.size}`
  try {
    return await openingCache.load(key, async () => {
      if (!apiDown()) {
        const batch = await fetchPuzzleBatch(want, `rating=${target}&opening=${tag}`)
        const filtered = excl.size ? batch.filter((r) => !excl.has(r.id)) : batch
        if (filtered.length >= 6) return filtered
      }
      return packOpeningWindow(target, tag, excl, want)
    })
  } catch {
    return packOpeningWindow(target, tag, excl, want)
  }
}

// ---------------------------------------------------------------------------
// Daily: Lichess publishes one official daily puzzle per UTC day (shipped
// fen is authoritative). Cached six hours per dayKey; a failed fetch is
// negatively cached for ten minutes so a wounded upstream is not retried on
// every request. Fallback: the same deterministic FNV-1a-seeded pick from
// the pack — the same position the MCP tool serves for the same date.
// ---------------------------------------------------------------------------
const DAILY_TTL_MS = 6 * 60 * 60 * 1000
const DAILY_NEG_TTL_MS = 10 * 60 * 1000
const dailyStore = new Map<string, { at: number; value: LichessPuzzle | null }>()
let dailyInflight: Promise<LichessPuzzle | null> | null = null

export async function lichessDaily(dayKey: string): Promise<LichessPuzzle | null> {
  const key = String(dayKey).slice(0, 10)
  const hit = dailyStore.get(key)
  if (hit) {
    const fresh = hit.value !== null ? DAILY_TTL_MS : DAILY_NEG_TTL_MS
    if (Date.now() - hit.at < fresh) return hit.value
    dailyStore.delete(key)
  }
  if (dailyInflight) return dailyInflight
  dailyInflight = (async () => {
    let value: LichessPuzzle | null = null
    if (!apiDown()) {
      try {
        const res = await fetch(`${API_BASE}/daily`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
          cache: 'no-store',
        })
        if (res.ok) {
          markSuccess()
          const body = (await res.json()) as ApiPuzzle
          value = toLichessPuzzle(body)
        } else {
          markFailure()
        }
      } catch {
        markFailure()
      }
    }
    if (value) registerServed([value])
    else value = packDaily(key)
    dailyStore.set(key, { at: Date.now(), value })
    return value
  })()
  try {
    return await dailyInflight
  } finally {
    dailyInflight = null
  }
}

// ---------------------------------------------------------------------------
// Rush: fresh puzzles from the API across the rating ladder (small parallel
// fan-out, cached ten minutes), falling back to the pack ladder — enough for
// a full 3-minute run without ever touching a big disk file.
// ---------------------------------------------------------------------------
const rushCache = new TtlCache<LichessPuzzle[]>(10 * 60 * 1000, 2)
const RUSH_BANDS: [number, number][] = [
  [600, 1000],
  [1000, 1400],
  [1400, 1800],
  [1800, 2200],
  [2200, 2800],
]

export async function lichessRushBatch(size = 250): Promise<LichessPuzzle[]> {
  try {
    return await rushCache.load(`r|${size}`, async () => {
      if (!apiDown()) {
        const perBand = Math.min(10, Math.max(4, Math.ceil(size / RUSH_BANDS.length)))
        const settled = await Promise.allSettled(
          RUSH_BANDS.map(([lo, hi]) => fetchPuzzleBatch(perBand, `rating=${lo}-${hi}`)),
        )
        const seen = new Set<string>()
        const all: LichessPuzzle[] = []
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue
          for (const p of s.value) {
            if (seen.has(p.id)) continue
            seen.add(p.id)
            all.push(p)
          }
        }
        if (all.length >= 20) {
          // easy -> hard overall, light shuffle inside same-rating groups so
          // runs do not feel memorized.
          const sorted = all.sort((a, b) => a.rating - b.rating).slice(0, size)
          let i = 0
          while (i < sorted.length) {
            let j = i
            while (j < sorted.length && sorted[j].rating === sorted[i].rating) j++
            shuffle(sorted.slice(i, j))
            i = j
          }
          return sorted
        }
      }
      return packRushBatch(size)
    })
  } catch {
    return packRushBatch(size)
  }
}

// ---------------------------------------------------------------------------
// Cold-start warmup is obsolete: the pack is a parsed-once memory array and
// the API paths warm themselves lazily. Kept as a no-op so existing callers
// stay untouched.
// ---------------------------------------------------------------------------
let warmed = false

export function warmBank(): void {
  if (warmed) return
  warmed = true
}

/**
 * A real upstream probe for the deep-health check: one cheap daily fetch.
 * Resolves to a human detail line, throws when the API is unreachable — the
 * health surface still exercises the real dependency end to end.
 */
export async function lichessProbe(): Promise<string> {
  const p = await lichessDaily(new Date().toISOString().slice(0, 10))
  if (!p) throw new Error('lichess puzzle API unreachable')
  const servedNow = lichessCount()
  return `daily puzzle live from lichess.org (rating ${p.rating}) · ${servedNow.toLocaleString('en-US')} gradable puzzles on the light source`
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
