/**
 * One-time curation: build db/puzzle-pack.json — a small (~700 puzzle,
 * few hundred KB, in-git) puzzle pack that REPLACES the 1.57GB db/puzzles.db
 * serving bank. The user's call (Oct 24): the giant bank is not needed; the
 * app now runs puzzle serving on this pack plus the free lichess puzzle API
 * (daily), so nothing heavy is ever downloaded, held, or paged in again.
 *
 * Selection, from the quality-filtered bank (popularity >= 50, rd <= 120 at
 * import time — every candidate below is already a vetted, real-game puzzle):
 *   1. rating bands 600-2799, top-played 20 per 100-pt band  -> the rated
 *      feed, the rush ladder (easy->hard) and the deterministic daily band
 *      (1000-2000 needs density: 10 bands x 20 = 200 puzzles there)
 *   2. every opening tag the 7 repertoire courses teach, top 12 each
 *   3. every raw lichess theme the app's concept map references, top 8 each
 * Deduped by id; order is rating-ascending for a deterministic file.
 *
 * Run: bun scripts/build-puzzle-pack.ts
 * (Requires the OLD bank on disk; after this the bank can be deleted.)
 */
import { Database } from 'bun:sqlite'
import { existsSync, writeFileSync, statSync } from 'node:fs'

const BANK = 'db/puzzles.db'
const OUT = 'db/puzzle-pack.json'

if (!existsSync(BANK)) {
  console.error('[pack] db/puzzles.db not found — nothing to curate from')
  process.exit(1)
}

const OPENING_TAGS = [
  'London_System',
  'Queens_Pawn_Game_Accelerated_London_System',
  'Italian_Game',
  'Sicilian_Defense',
  'Sicilian_Defense_Najdorf_Variation',
  'Caro-Kann_Defense',
  'Queens_Gambit_Declined',
  'Semi-Slav_Defense',
  'Queens_Gambit_Accepted',
  'Kings_Indian_Defense',
]

// Raw lichess theme ids the app maps to its concept ids (the value side of
// LICHESS_TO_APP in src/lib/server/lichess-bank.ts). Raw ids pass through,
// so covering exactly these keeps every concept trainable.
const THEME_IDS = [
  'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate',
  'dovetailMate', 'hookMate',
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck',
  'attackingF2F7', 'queensideAttack', 'kingsideAttack', 'exposedKing',
  'sacrifice', 'trappedPiece', 'hangingPiece', 'capturingDefender',
  'deflection', 'promotion', 'underpromotion',
  'endgame', 'bishopEndgame', 'knightEndgame', 'pawnEndgame', 'rookEndgame',
  'zugzwang', 'defensiveMove',
]

interface Row {
  id: string
  fen: string
  moves: string
  rating: number
  themes: string
  gameurl: string
  openingtags: string
}

const db = new Database(BANK, { readonly: true })
const COLS = 'id, fen, moves, rating, themes, gameurl, openingtags'
const picked = new Map<string, Row>()

const take = (rows: Row[], why: string): void => {
  let added = 0
  for (const r of rows) {
    if (!picked.has(r.id)) {
      picked.set(r.id, r)
      added++
    }
  }
  console.log(`[pack] ${why}: +${added}`)
}

// 1. rating bands
for (let lo = 600; lo <= 2700; lo += 100) {
  const rows = db
    .prepare(`SELECT ${COLS} FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY nbplays DESC LIMIT 20`)
    .all(lo, lo + 99) as unknown as Row[]
  take(rows, `band ${lo}-${lo + 99}`)
}

// 2. opening tags
for (const tag of OPENING_TAGS) {
  const rows = db
    .prepare(`SELECT ${COLS} FROM puzzles WHERE ' ' || openingtags || ' ' LIKE ? ORDER BY nbplays DESC LIMIT 12`)
    .all(`% ${tag} %`) as unknown as Row[]
  take(rows, `opening ${tag}`)
}

// 3. themes
for (const t of THEME_IDS) {
  const rows = db
    .prepare(`SELECT ${COLS} FROM puzzles WHERE ' ' || themes || ' ' LIKE ? ORDER BY nbplays DESC LIMIT 8`)
    .all(`% ${t} %`) as unknown as Row[]
  take(rows, `theme ${t}`)
}

const all = [...picked.values()].sort((a, b) => a.rating - b.rating)

// Sanity gates: the pack must serve every surface it replaces.
const daily = all.filter((p) => p.rating >= 1000 && p.rating <= 2000).length
const openingsCovered = OPENING_TAGS.filter((tag) =>
  all.some((p) => ` ${p.openingtags} `.includes(` ${tag} `)),
).length
if (all.length < 400 || daily < 100 || openingsCovered < OPENING_TAGS.length) {
  console.error(
    `[pack] sanity failed: total=${all.length} dailyBand=${daily} openings=${openingsCovered}/${OPENING_TAGS.length} — refusing to write`,
  )
  process.exit(1)
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'curated from the quality-filtered lichess puzzle bank (popularity>=50, rd<=120), then the bank was retired per the lightweight-app decision',
    total: all.length,
    dailyBand: { min: 1000, max: 2000, count: daily },
    openingsCovered,
    themesCovered: THEME_IDS.length,
  },
  puzzles: all.map((p) => ({
    id: p.id,
    fen: p.fen,
    m: p.moves, // UCI solution line, solver moves at even indexes
    r: p.rating,
    t: p.themes, // raw lichess theme ids, space-separated
    u: p.gameurl,
    o: p.openingtags, // raw lichess opening tags, space-separated
  })),
}

writeFileSync(OUT, JSON.stringify(out))
const kb = Math.round(statSync(OUT).size / 1024)
console.log(`[pack] wrote ${OUT}: ${all.length} puzzles, ${kb}KB, dailyBand=${daily}, openings=${openingsCovered}/${OPENING_TAGS.length}`)
