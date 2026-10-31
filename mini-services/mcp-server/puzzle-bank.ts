// Read-only access to the app's LIGHT puzzle source (db/puzzle-pack.json,
// ~542 curated puzzles, plus the free lichess daily API) for the
// get_daily_puzzle MCP tool. Since the Oct 24 lightweight decision the
// 1.57GB serving bank is retired; the MCP tool mirrors the app's
// lichessDaily EXACTLY: the lichess daily API when reachable (replayed to
// the puzzle position with chess.js and self-validated), otherwise the same
// deterministic FNV-1a-seeded pick from the pack — so the MCP daily puzzle
// is THE SAME position the app serves for the same date. Spoiler policy:
// the solution moves are never returned.
import { Chess } from 'chess.js'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const PACK_CANDIDATES = [
  path.resolve(import.meta.dir, '..', '..', 'db', 'puzzle-pack.json'),
  path.resolve(process.cwd(), 'db', 'puzzle-pack.json'),
]

interface PackEntry {
  id: string
  fen: string
  m: string // UCI solution line
  r: number
  t: string // raw lichess theme ids
  u: string
  o: string
}

interface Pack {
  puzzles: PackEntry[]
}

let pack: PackEntry[] | null = null
let lastFailure = 0
const RETRY_AFTER_MS = 30_000

function getPack(): PackEntry[] | null {
  if (pack) return pack
  if (Date.now() - lastFailure < RETRY_AFTER_MS) return null
  for (const p of PACK_CANDIDATES) {
    try {
      if (!existsSync(p)) continue
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Pack
      if (Array.isArray(parsed.puzzles) && parsed.puzzles.length > 0) {
        pack = parsed.puzzles
        return pack
      }
    } catch {
      /* try the next candidate */
    }
  }
  lastFailure = Date.now()
  return null
}

/** FNV-1a: tiny, stable across processes — ported from lichess-bank.ts. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h >>>= 0
  }
  return h >>> 0
}

export interface DailyPuzzle {
  id: string
  fen: string
  rating: number
  themes: string[]
  moveCount: number
  source: 'lichess-daily-api' | 'pack'
}

function packDaily(dayKey: string): DailyPuzzle | null {
  const all = getPack()
  if (!all) return null
  const band = all.filter((p) => p.r >= 1000 && p.r <= 2000)
  const pool = band.length > 0 ? band : all
  if (pool.length === 0) return null
  // Same pick as the app's packDaily: band in pack-file order (rating asc),
  // seeded index — deterministic and identical across processes.
  const row = pool[hashSeed(dayKey) % pool.length]
  return {
    id: String(row.id),
    fen: String(row.fen),
    rating: Number(row.r) || 0,
    themes: String(row.t ?? '')
      .split(' ')
      .filter(Boolean),
    moveCount: String(row.m ?? '')
      .split(' ')
      .filter(Boolean).length,
    source: 'pack',
  }
}

// --- lichess daily API (the app's primary daily, mirrored) ------------------
interface LichessDailyJson {
  game?: { pgn?: string }
  puzzle?: { id?: string; rating?: number; solution?: string[]; themes?: string[]; fen?: string; initialPly?: number }
}

let apiCache: { at: number; puzzle: DailyPuzzle | null } | null = null
const API_TTL_MS = 6 * 60 * 60 * 1000
const API_NEG_TTL_MS = 10 * 60 * 1000

function replayToPly(pgn: string, ply: number): string | null {
  try {
    const tokens = pgn
      .trim()
      .split(/\s+/)
      .filter((t) => t && !/^\d+\.*$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    const g = new Chess()
    const n = Math.max(0, Math.min(ply, tokens.length))
    for (let i = 0; i < n; i++) g.move(tokens[i])
    return g.fen()
  } catch {
    return null
  }
}

async function apiDaily(): Promise<DailyPuzzle | null> {
  try {
    const res = await fetch('https://lichess.org/api/puzzle/daily', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as LichessDailyJson
    const id = j.puzzle?.id
    const solution = j.puzzle?.solution ?? []
    const pgn = j.game?.pgn ?? ''
    if (!id || solution.length === 0 || !pgn) return null
    // The API ships the puzzle position directly (verified live); replay is
    // only a fallback — the initialPly convention does not match the
    // truncated PGN and yields a wrong position.
    const fen = j.puzzle?.fen || replayToPly(pgn, Number.isFinite(j.puzzle?.initialPly) ? Number(j.puzzle?.initialPly) : 9999)
    if (!fen) return null
    // Self-validation, same as the app: the solver's first move must be legal
    // from the replayed position.
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
      rating: Number(j.puzzle?.rating) || 1500,
      themes: (j.puzzle?.themes ?? []).map((t) => String(t)),
      moveCount: solution.length,
      source: 'lichess-daily-api',
    }
  } catch {
    return null
  }
}

/**
 * The daily puzzle: the lichess daily API when reachable (cached 6h, exactly
 * like the app), otherwise the deterministic pack pick — the same position
 * for everyone on the same day either way. The solution moves are NEVER
 * included (spoiler policy).
 */
export async function dailyPuzzle(dayKey: string): Promise<DailyPuzzle | null> {
  const now = Date.now()
  if (apiCache) {
    const ttl = apiCache.puzzle ? API_TTL_MS : API_NEG_TTL_MS
    if (now - apiCache.at < ttl) {
      if (apiCache.puzzle) return apiCache.puzzle
      return packDaily(dayKey)
    }
  }
  const fetched = await apiDaily()
  apiCache = { at: now, puzzle: fetched }
  return fetched ?? packDaily(dayKey)
}

export function puzzleBankPath(): string | null {
  for (const p of PACK_CANDIDATES) if (existsSync(p)) return p
  return null
}
