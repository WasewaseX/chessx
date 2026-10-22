/**
 * Arena + rating module — the chessreps.com mechanics ported from the
 * deep-dive evidence in docs/chessreps-arena-deep-dive.md (P0/P1/P2).
 *
 * Everything here runs client-side on purpose:
 *  - the Elo math is a verbatim port of their `K = 20 + 100 * 0.95^attempts`
 *    formula (chunks/EnTHCXG.js, deep-dive §2),
 *  - opponents are sampled Box–Muller (σ=60) around the student's rating,
 *    clamped 100..2400 and filtered to ±200 (their `H` picker),
 *  - "real players at your level" replies come from the lichess opening
 *    explorer fetched from the STUDENT'S browser (datacenter IPs get blocked
 *    by other chess sites; the explorer is CORS-open and free), with a
 *    Stockfish fallback so an outage never freezes a game.
 */

import type { EngineInfo } from '@/lib/chess/engine-client'

// ---------------------------------------------------------------------------
// P0 — the rating math (verbatim port)
// ---------------------------------------------------------------------------

/** chessreps K-factor: starts near 120, decays to a floor of 20. */
export function kFactor(attempts: number): number {
  return 20 + 100 * Math.pow(0.95, Math.max(0, attempts))
}

export type ArenaResult = 'win' | 'loss' | 'draw'

/** One Elo update. Draws are reported but never move the arena rating. */
export function applyElo(
  elo: number,
  oppRating: number,
  result: ArenaResult,
  attempts: number,
): number {
  const score = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5
  const expected = 1 / (1 + 10 ** ((oppRating - elo) / 400))
  return Math.max(100, Math.round(elo + kFactor(attempts) * (score - expected)))
}

// ---------------------------------------------------------------------------
// Ratings state (single localStorage key; ring buffer of played puzzle ids)
// ---------------------------------------------------------------------------

export interface RatingsState {
  arenaElo: number
  arenaAttempts: number
  playedPuzzleIds: string[]
}

const RATINGS_KEY = 'chessx.ratings.v1'
const PLAYED_CAP = 300

const DEFAULT_RATINGS: RatingsState = { arenaElo: 950, arenaAttempts: 0, playedPuzzleIds: [] }

export function loadRatings(): RatingsState {
  if (typeof window === 'undefined') return { ...DEFAULT_RATINGS }
  try {
    const raw = window.localStorage.getItem(RATINGS_KEY)
    if (!raw) return { ...DEFAULT_RATINGS }
    const p = JSON.parse(raw) as Partial<RatingsState>
    return {
      arenaElo: typeof p.arenaElo === 'number' && p.arenaElo >= 100 ? p.arenaElo : DEFAULT_RATINGS.arenaElo,
      arenaAttempts: typeof p.arenaAttempts === 'number' && p.arenaAttempts >= 0 ? Math.floor(p.arenaAttempts) : 0,
      playedPuzzleIds: Array.isArray(p.playedPuzzleIds) ? p.playedPuzzleIds.map(String).slice(-PLAYED_CAP) : [],
    }
  } catch {
    return { ...DEFAULT_RATINGS }
  }
}

export function saveRatings(s: RatingsState): void {
  try {
    window.localStorage.setItem(RATINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: session-only play still works */
  }
}

export function rememberPuzzlePlayed(id: string): void {
  const s = loadRatings()
  if (s.playedPuzzleIds.includes(id)) return
  s.playedPuzzleIds = [...s.playedPuzzleIds, id].slice(-PLAYED_CAP)
  saveRatings(s)
}

// ---------------------------------------------------------------------------
// P1 — the opponent generator (verbatim math, our own name pool)
// ---------------------------------------------------------------------------

/**
 * Persona pool. chessreps maps pool index → nominal strength with
 * `elo_i = round(100 + i/(N-1)*2300)`; we do the same over our own names so
 * an 1800-rated opponent never introduces themselves as "Baby Mango".
 */
const PERSONA_NAMES = [
  'Ava', 'Noah', 'Mia', 'Leo', 'Zoe', 'Max', 'Ivy', 'Sam', 'Elsa', 'Omar',
  'Nina', 'Felix', 'Rosa', 'Hugo', 'Lena', 'Kofi', 'Anya', 'Bruno', 'Cleo', 'Dario',
  'Edith', 'Farid', 'Greta', 'Hana', 'Igor', 'Juno', 'Kira', 'Lars', 'Mona', 'Nael',
  'Olga', 'Pavel', 'Quinn', 'Rania', 'Sven', 'Tara', 'Umar', 'Vera', 'Wes', 'Ximena',
  'Yara', 'Zane', 'Alba', 'Boris', 'Cara', 'Dmitri', 'Esme', 'Frank', 'Gia', 'Hassan',
  'Ines', 'Jonas', 'Karin', 'Luca', 'Marta', 'Niklas', 'Opal', 'Pia', 'Ruben', 'Selma',
  'Tomas', 'Uma', 'Viktor', 'Wanda', 'Xander', 'Yusuf', 'Zora', 'Agnes', 'Ezra', 'Freya',
  'Gideon', 'Harriet', 'Ivan', 'Josephine', 'Kai', 'Lorena', 'Marcus', 'Noor', 'Oscar', 'Petra',
  'Ravi', 'Sonia', 'Thea', 'Ursula', 'Vince', 'Wilma', 'Xavi', 'Yoland', 'Ziggy', 'Arlo',
  'Bianca', 'Casper', 'Delia', 'Emil', 'Faye', 'Gustav', 'Hazel', 'Iris', 'Jasper', 'Katya',
  'Leif', 'Maribel', 'Nils', 'Oksana', 'Pablo', 'Renata', 'Stellan', 'Tessa', 'Ulrich', 'Valentina',
  'Wren', 'Ximena', 'Yvette', 'Zelda', 'Anton', 'Bea', 'Cyrus', 'Dora', 'Elio', 'Fern',
  'Gwen', 'Hollis', 'Imre', 'Jolanda', 'Kirsten', 'Lior', 'Milena', 'Nadia', 'Ottavia', 'Pim',
] as const

export interface Persona {
  name: string
  elo: number
  initials: string
}

function initialsOf(name: string): string {
  return name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

/**
 * Box–Muller sample around the student's Elo (σ=60), clamped to 100..2400,
 * filtered to the ±200 pool band, nearest name-index wins (their `H`).
 */
export function pickOpponent(userElo: number, rng: () => number = Math.random): Persona {
  const n = PERSONA_NAMES.length
  // Standard normal via Box–Muller.
  const u1 = Math.max(rng(), 1e-9)
  const u2 = rng()
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  let elo = Math.round(userElo + gauss * 60)
  elo = Math.max(100, Math.min(2400, elo))
  // Nearest index whose nominal elo is within ±200; widen if the pool is thin.
  let bestIdx = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const nominal = Math.round(100 + (i / (n - 1)) * 2300)
    const d = Math.abs(nominal - elo)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  const name = PERSONA_NAMES[bestIdx]
  const nominal = Math.round(100 + (bestIdx / (n - 1)) * 2300)
  return { name, elo: Math.max(100, Math.min(2400, nominal + (elo - nominal))), initials: initialsOf(name) }
}

// ---------------------------------------------------------------------------
// P2 — the reply engine: "moves real players made at your level"
// ---------------------------------------------------------------------------

/** Persona/person Elo → lichess explorer rating bands (fixed buckets). */
export function eloToBands(elo: number): number[] {
  if (elo < 1000) return [1000, 1200, 1400]
  if (elo < 1400) return [1200, 1400, 1600]
  if (elo < 1800) return [1400, 1600, 1800]
  if (elo < 2100) return [1600, 1800, 2000, 2200]
  return [1800, 2000, 2200, 2500]
}

export function eloToSpeeds(elo: number): string {
  return elo < 1600 ? 'blitz,rapid' : 'blitz,rapid,classical'
}

export type ExplorerReply =
  | { status: 'move'; san: string; totalGames: number; moveGames: number; source: 'explorer' }
  | { status: 'unavailable'; reason: 'no-data' | 'fetch_error'; source: 'none' }

interface ExplorerMove {
  san: string
  white: number
  draws: number
  black: number
}

const explorerCache = new Map<string, Promise<ExplorerReply>>()
const EXPLORER_TTL_MS = 10 * 60_000
const cacheStamps = new Map<string, number>()

function cacheKey(fen: string, elo: number): string {
  return `${fen}|${eloToBands(elo).join('-')}`
}

function pruneCache(): void {
  const now = Date.now()
  for (const [k, t] of cacheStamps) {
    if (now - t > EXPLORER_TTL_MS) {
      cacheStamps.delete(k)
      explorerCache.delete(k)
    }
  }
}

function fetchExplorer(fen: string, elo: number): Promise<ExplorerReply> {
  const bands = eloToBands(elo).join(',')
  const speeds = eloToSpeeds(elo)
  const url = `https://explorer.lichess.ovh/lichess?variant=standard&fen=${encodeURIComponent(fen)}&speeds=${speeds}&ratings=${bands}&topGames=0&recentGames=0&moveOrder=games`
  return (async (): Promise<ExplorerReply> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      try {
        const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
        clearTimeout(timer)
        if (!res.ok) continue
        const data = (await res.json()) as { moves?: ExplorerMove[]; total?: number }
        const moves = (data.moves ?? []).filter((m) => m && typeof m.san === 'string')
        const total = moves.reduce((a, m) => a + (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0), 0)
        if (moves.length === 0 || total === 0) {
          return { status: 'unavailable', reason: 'no-data', source: 'none' }
        }
        // Games-weighted random: popular club moves happen, refutations appear
        // exactly as often as real players find them.
        let roll = Math.random() * total
        for (const m of moves) {
          roll -= (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0)
          if (roll <= 0) {
            return { status: 'move', san: m.san, totalGames: total, moveGames: (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0), source: 'explorer' }
          }
        }
        const last = moves[moves.length - 1]
        return { status: 'move', san: last.san, totalGames: total, moveGames: (last.white ?? 0) + (last.draws ?? 0) + (last.black ?? 0), source: 'explorer' }
      } catch {
        clearTimeout(timer)
        // one retry, then give up (the caller falls back to the engine)
      }
    }
    return { status: 'unavailable', reason: 'fetch_error', source: 'none' }
  })()
}

/**
 * Cached, single-flight explorer reply. Concurrent asks for the same
 * position share one request (their prefetch behaves the same way).
 */
export function explorerReply(fen: string, elo: number): Promise<ExplorerReply> {
  pruneCache()
  const key = cacheKey(fen, elo)
  const hit = explorerCache.get(key)
  if (hit) return hit
  const p = fetchExplorer(fen, elo).finally(() => cacheStamps.set(key, Date.now()))
  explorerCache.set(key, p)
  return p
}

/** Drop every cached reply (new game = fresh prefetch window). */
export function clearExplorerCache(): void {
  explorerCache.clear()
  cacheStamps.clear()
}

// ---------------------------------------------------------------------------
// Eval-delta scoring (their `Mc`, ported) — final eval vs book-exit eval
// ---------------------------------------------------------------------------

/**
 * Convert a side-to-move-POV engine info into a White-POV centipawn score.
 * Mate scores map onto a large cp so a forced mate always outranks any
 * material swing (mate in n = ±(10000 - n)).
 */
export function whitePovCp(info: EngineInfo, turn: 'w' | 'b'): number {
  if (info.mate != null && info.mate !== 0) {
    const raw = 10_000 - Math.min(9_999, Math.abs(info.mate))
    const stm = info.mate > 0 ? 1 : -1 // side to move delivers mate
    return turn === 'w' ? stm * raw : -stm * raw
  }
  const cp = Math.max(-1_500, Math.min(1_500, info.scoreCp ?? 0))
  return turn === 'w' ? cp : -cp
}

/**
 * Their rule: delta > 0 → win, delta ≥ −50cp → draw, else loss (from the
 * player's side). Draws keep the arena Elo untouched.
 */
export function arenaResultFromDelta(deltaCpFromPlayer: number): ArenaResult {
  if (deltaCpFromPlayer > 0) return 'win'
  if (deltaCpFromPlayer >= -50) return 'draw'
  return 'loss'
}
