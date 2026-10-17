// Read-only access to the app's Lichess puzzle bank (db/puzzles.db, 5.77M
// rows) for the get_daily_puzzle MCP tool. The FNV-1a seed + rowid scan is
// ported verbatim from src/lib/server/lichess-bank.ts lichessDaily so the
// MCP daily puzzle is THE SAME position the app serves for the same date.
// Spoiler policy: the solution `moves` column is never returned.
import { Database } from 'bun:sqlite'
import path from 'node:path'
import { existsSync } from 'node:fs'

const DB_CANDIDATES = [
  path.resolve(import.meta.dir, '..', '..', 'db', 'puzzles.db'),
  path.resolve(process.cwd(), 'db', 'puzzles.db'),
]

let db: Database | null = null
let lastFailure = 0
const RETRY_AFTER_MS = 30_000

function getDb(): Database | null {
  if (db) return db
  if (Date.now() - lastFailure < RETRY_AFTER_MS) return null
  for (const p of DB_CANDIDATES) {
    try {
      if (!existsSync(p)) continue
      db = new Database(p, { readonly: true })
      return db
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
}

/**
 * The deterministic daily puzzle: the same position for everyone on the same
 * day. Seeded pick inside the moderate 1000-2000 rating band, exactly like
 * the app. The solution moves are NEVER included (spoiler policy).
 */
export function dailyPuzzle(dayKey: string): DailyPuzzle | null {
  const d = getDb()
  if (!d) return null
  try {
    const maxRow = (d.query('SELECT MAX(rowid) m FROM puzzles').get() as { m: number | null }).m
    if (!maxRow) return null
    const start = hashSeed(dayKey) % maxRow
    const sql =
      'SELECT id, fen, rating, themes, moves FROM puzzles WHERE rating BETWEEN 1000 AND 2000 AND rowid >= ? ORDER BY rowid LIMIT 1'
    let row = d.query(sql).get(start) as
      | { id: string; fen: string; rating: number; themes: string; moves: string }
      | null
    if (!row) {
      // The band ran out past the seed point: wrap to the beginning of it.
      row = d
        .query('SELECT id, fen, rating, themes, moves FROM puzzles WHERE rating BETWEEN 1000 AND 2000 ORDER BY rowid LIMIT 1')
        .get() as typeof row
    }
    if (!row || !row.id || !row.fen) return null
    return {
      id: String(row.id),
      fen: String(row.fen),
      rating: Number(row.rating) || 0,
      themes: String(row.themes ?? '')
        .split(' ')
        .filter(Boolean),
      moveCount: String(row.moves ?? '')
        .split(' ')
        .filter(Boolean).length,
    }
  } catch {
    return null
  }
}

export function puzzleBankPath(): string | null {
  for (const p of DB_CANDIDATES) if (existsSync(p)) return p
  return null
}
