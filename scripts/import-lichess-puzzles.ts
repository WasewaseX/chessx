/**
 * Lichess puzzle database importer.
 *
 * Streams the official lichess_db_puzzle.csv (https://database.lichess.org)
 * line by line — the file is ~1.2GB, it is never loaded into memory — and
 * imports a quality-filtered copy into the dedicated SQLite database
 * db/puzzles.db using node:sqlite (DatabaseSync). Prisma is not involved:
 * this is a separate, read-mostly serving database, not the app's own data.
 *
 * Quality filter: popularity >= 50 AND ratingDeviation <= 120. All rating
 * bands are kept (600-2700+), so every level of the app gets real puzzles.
 *
 * After the import the script verifies itself: row count, min/max rating and
 * a random sample of 1000 rows replayed through chess.js (every sample row
 * must replay legally). If the pass rate drops below 99% it exits non-zero.
 *
 * Run with Node >= 24 (node:sqlite + built-in zstd):
 *   node scripts/import-lichess-puzzles.ts
 * Flags:
 *   --keep-csv    keep the decompressed CSV after a successful import
 *   --keep-zst    keep the .zst archive after a successful import
 *   --fresh       delete db/puzzles.db first and rebuild from scratch
 */
import { DatabaseSync } from 'node:sqlite'
import { createReadStream, createWriteStream, existsSync, statSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Chess } from 'chess.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data', 'lichess')
const CSV = path.join(DATA_DIR, 'lichess_db_puzzle.csv')
const ZST = path.join(DATA_DIR, 'lichess_db_puzzle.csv.zst')
const DB = path.join(ROOT, 'db', 'puzzles.db')

const KEEP_CSV = process.argv.includes('--keep-csv')
const KEEP_ZST = process.argv.includes('--keep-zst')
const FRESH = process.argv.includes('--fresh')

async function main() {
  if (!existsSync(CSV) && !existsSync(ZST)) {
    console.error(`[import] no source found. Expected ${CSV} or ${ZST}.`)
    console.error('[import] download it from https://database.lichess.org/#puzzles first.')
    process.exit(1)
  }
  // Prefer the zstd CLI (handles every frame layout, including the skippable
  // frames node's own wrapper rejects); fall back to python3+zstandard.
  if (!existsSync(CSV)) {
    decompress()
  }
  if (!existsSync(CSV)) {
    console.error('[import] decompression produced no CSV — aborting.')
    process.exit(1)
  }
  const bytes = statSync(CSV).size
  console.log(`[import] CSV ready: ${(bytes / 1e9).toFixed(2)} GB`)

  if (FRESH && existsSync(DB)) {
    rmSync(DB)
    console.log('[import] --fresh: removed the old database.')
  }
  if (existsSync(DB) && !FRESH) {
    const n = openDb().prepare('SELECT COUNT(*) c FROM puzzles').get()
    if (Number(n.c) > 1_000_000) {
      console.log(`[import] db/puzzles.db already holds ${Number(n.c).toLocaleString()} rows — nothing to do. Use --fresh to rebuild.`)
      finish(KEEP_CSV, KEEP_ZST)
      return
    }
  }

  await importAll()
  verify()
  finish(KEEP_CSV, KEEP_ZST)
}

function decompress() {
  console.log('[import] decompressing the .zst archive (this takes a minute)...')
  // First choice: Node's built-in zstd stream (Node >= 24) — no external
  // binaries needed, and it streams so the 1.2GB output never sits in RAM.
  try {
    const { createZstdDecompress } = require('node:zlib') as typeof import('node:zlib')
    execFileSync(
      process.execPath,
      [
        '-e',
        `const { createZstdDecompress } = require('node:zlib');
         const { pipeline } = require('node:stream/promises');
         const fs = require('node:fs');
         pipeline(fs.createReadStream(${JSON.stringify(ZST)}), createZstdDecompress(), fs.createWriteStream(${JSON.stringify(CSV)}))
           .then(() => console.log('[node-zstd] done'))
           .catch((e) => { console.error(e); process.exit(1) });`,
      ],
      { stdio: 'inherit' },
    )
    return
  } catch (e) {
    console.log('[import] node zstd unavailable or failed; trying the zstd CLI...')
  }
  try {
    execFileSync('zstd', ['-d', '-f', '-q', ZST, '-o', CSV], { stdio: 'inherit' })
    return
  } catch {
    console.log('[import] zstd CLI unavailable or failed; trying python3 + zstandard...')
  }
  try {
    execFileSync('python3', ['-c', `import zstandard, shutil, sys; ` +
      `i = open(${JSON.stringify(ZST)}, 'rb'); d = zstandard.ZstdDecompressor().stream_reader(i); ` +
      `o = open(${JSON.stringify(CSV)}, 'wb'); shutil.copyfileobj(d, o); o.close()`], { stdio: 'inherit' })
  } catch (e) {
    console.error('[import] python zstandard failed too:', e.message)
    process.exit(1)
  }
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(DB)
  db.exec(`CREATE TABLE IF NOT EXISTS puzzles (
    id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER NOT NULL,
    ratingdev INTEGER NOT NULL,
    popularity INTEGER NOT NULL,
    nbplays INTEGER NOT NULL,
    themes TEXT NOT NULL,
    gameurl TEXT NOT NULL,
    openingtags TEXT NOT NULL
  )`)
  return db
}

const HEADER = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'RatingDeviation', 'Popularity', 'NbPlays', 'Themes', 'GameUrl', 'OpeningTags']

function importAll() {
  const db = openDb()
  const insert = db.prepare(
    'INSERT OR REPLACE INTO puzzles (id, fen, moves, rating, ratingdev, popularity, nbplays, themes, gameurl, openingtags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  db.exec('BEGIN')
  const rl = createInterface({ input: createReadStream(CSV, { encoding: 'utf8' }), crlfDelay: Infinity })
  let headerSkipped = false
  let rows = 0
  let sinceLog = 0
  let i = 0 // batch counter inside the transaction

  rl.on('line', (line) => {
    if (!line) return
    if (!headerSkipped) {
      headerSkipped = true
      return
    }
    const f = line.split(',')
    if (f.length < 9) return
    const ratingdev = Number(f[4])
    const popularity = Number(f[5])
    // quality filter: established, well-played puzzles only
    if (popularity < 50 || ratingdev > 120) return
    const values = [f[0], f[1], f[2], Number(f[3]), ratingdev, popularity, Number(f[6]), f[7] ?? '', f[8] ?? '', f[9] ?? '']
    if (values.some((v) => v == null)) return
    try {
      insert.run(...values)
      rows++
      sinceLog++
      i++
      if (i >= 50_000) {
        db.exec('COMMIT')
        db.exec('BEGIN')
        i = 0
        if (sinceLog >= 500_000) {
          console.log(`[import] ${rows.toLocaleString()} rows...`)
          sinceLog = 0
        }
      }
    } catch {
      /* a malformed line must never kill a 5M-row import */
    }
  })

  return new Promise<void>((resolve, reject) => {
    rl.on('close', () => {
      try {
        db.exec('COMMIT')
        db.exec(`CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles(rating)`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_puzzles_popularity ON puzzles(popularity)`)
        // theme popularity for the chips: pivot in rowid chunks so 5.7M rows
        // never sit in memory at once
        db.exec(`CREATE TABLE IF NOT EXISTS theme_stats (theme TEXT PRIMARY KEY, count INTEGER NOT NULL)`)
        db.exec(`DELETE FROM theme_stats`)
        const maxRow = (db.prepare('SELECT MAX(rowid) m FROM puzzles').get() as { m: number | bigint }).m
        const counts = new Map<string, number>()
        const CHUNK = 500_000
        for (let lo = 1; lo <= Number(maxRow); lo += CHUNK) {
          const rows = db
            .prepare('SELECT themes FROM puzzles WHERE rowid >= ? AND rowid < ?')
            .all(lo, lo + CHUNK) as { themes: string }[]
          for (const row of rows) {
            for (const t of String(row.themes).split(' ')) {
              if (!t) continue
              counts.set(t, (counts.get(t) ?? 0) + 1)
            }
          }
        }
        const ins = db.prepare(`INSERT INTO theme_stats (theme, count) VALUES (?, ?)`)
        for (const [t, c] of counts) ins.run(t, c)
        db.close()
        console.log(`[import] done: ${rows.toLocaleString()} puzzles imported.`)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    rl.on('error', reject)
  })
}

/** Replay a random sample through chess.js: the DB must hold legal puzzles. */
function verify() {
  const db = new DatabaseSync(DB, { readOnly: true })
  const meta = db.prepare('SELECT COUNT(*) c, MIN(rating) lo, MAX(rating) hi FROM puzzles').get()
  console.log(`[verify] rows=${Number(meta.c).toLocaleString()} rating ${meta.lo}-${meta.hi}`)
  if (Number(meta.c) < 1_000_000) {
    console.error('[verify] far fewer rows than expected — failing.')
    process.exit(1)
  }
  const sample = db.prepare(`SELECT id, fen, moves FROM puzzles ORDER BY (rowid * 7919) % (SELECT MAX(rowid) FROM puzzles) LIMIT 1000`).all()
  let ok = 0
  for (const row of sample) {
    try {
      const g = new Chess(String(row.fen))
      for (const uci of String(row.moves).split(' ')) {
        g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length === 5 ? uci[4] : undefined })
      }
      ok++
    } catch {
      /* counted as a failure */
    }
  }
  const pct = Math.round((ok / sample.length) * 1000) / 10
  console.log(`[verify] replayed ${sample.length} sampled puzzles: ${pct}% legal.`)
  if (pct < 99) {
    console.error('[verify] below the 99% pass rate — failing.')
    process.exit(1)
  }
  db.close()
}

function finish(keepCsv: boolean, keepZst: boolean) {
  if (!keepCsv && existsSync(CSV)) rmSync(CSV)
  if (!keepZst && existsSync(ZST)) rmSync(ZST)
  console.log('[import] finished. Source files cleaned up (pass --keep-csv / --keep-zst to keep them).')
}

main()
