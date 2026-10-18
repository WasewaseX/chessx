import 'server-only'
import { createHash } from 'crypto'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { detectOpening } from '@/lib/chess/openings'

/**
 * Username-based bulk game import from chess.com and lichess (the Chessigma
 * "Works with Chess.com · Lichess" loop): given a public username, pull the
 * most recent finished games, validate each PGN by replaying it with chess.js,
 * and store the ones the profile does not have yet as GameRecord rows
 * (botLevel 0 marks imported games — every in-app path that consumes botLevel
 * clamps it to the 1..14 bot ladder, so 0 never breaks anything).
 *
 * Endpoint shapes verified against the live providers:
 * - chess.com: GET /pub/player/{name}/games/archives → { archives: [monthly
 *   URLs .../games/{YYYY}/{MM}] }; each month → { games: [{ pgn, time_class,
 *   time_control, white: { username, rating, result }, black: { ... },
 *   end_time, url }] }. chess.com REQUIRES a User-Agent header (else 403) and
 *   additionally blocks many datacenter IPs outright — callers must surface
 *   that honestly instead of hiding it.
 * - lichess: GET /api/games/user/{name}?max=100&pgnInJson=false&opening=true
 *   &clocks=false&evals=false&since={epoch-ms} with Accept:
 *   application/x-chess-pgn → raw multi-game PGN text. 404 = unknown user,
 *   429 = rate limit, empty 200 = no games in the window.
 */

const USER_AGENT = 'ChessX/1.0 (+https://github.com)'
/** Hard cap per upstream HTTP call. */
const FETCH_TIMEOUT_MS = 15_000
/** Whole-import budget handed to callers; the route never blocks past ~25s. */
export const TOTAL_BUDGET_MS = 22_000
export const MAX_MONTHS = 6
export const MAX_GAMES_STORE = 200
/** Mirrors the 20k PGN cap the games POST applies; oversize PGNs are skipped. */
const MAX_PGN_CHARS = 20_000
const LICHESS_MAX_BYTES = 3_000_000
/** How many recent stored PGNs take part in dedupe (in-memory, per request). */
const DEDUPE_SCAN = 400

/** An upstream failure worth its own honest status code (404/429/502/504). */
export class ImportUpstreamError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

function timeoutError(provider: string): ImportUpstreamError {
  return new ImportUpstreamError(
    `${provider} did not answer in time from the server. Try again, or paste the PGN instead.`,
    504,
  )
}

/**
 * fetch() under a shared deadline: every call gets at most FETCH_TIMEOUT_MS
 * or what is left of the budget, so a route handler can never block past its
 * stated total.
 */
async function deadlineFetch(url: string, init: RequestInit, deadline: number, provider: string): Promise<Response> {
  const remaining = deadline - Date.now()
  if (remaining < 1_000) throw timeoutError(provider)
  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remaining)),
    })
  } catch (e) {
    if (isTimeout(e)) throw timeoutError(provider)
    throw new ImportUpstreamError(`Could not reach ${provider} from the server: ${e instanceof Error ? e.message : String(e)}`, 502)
  }
}

// ---------------------------------------------------------------------------
// PGN splitting (same boundaries as the client panel: blank line before the
// next [Event header, or 3+ newlines in any export)
// ---------------------------------------------------------------------------

export function splitPgnGames(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  const chunks = t
    .split(/\n\s*\n(?=\[Event\s)|\n{3,}/g)
    .map((c) => c.trim())
    .filter(Boolean)
  return chunks.length > 0 ? chunks : [t]
}

// ---------------------------------------------------------------------------
// chess.com
// ---------------------------------------------------------------------------

interface ChessComSide {
  username?: unknown
  rating?: unknown
  result?: unknown
}

interface ChessComGame {
  pgn?: unknown
  time_class?: unknown
  time_control?: unknown
  end_time?: unknown
  url?: unknown
  white?: ChessComSide | null
  black?: ChessComSide | null
}

const CHESSCOM_BLOCKED =
  'chess.com refused the server request (HTTP 403). It often blocks automated traffic from datacenter IPs even with a proper User-Agent. The single-game tabs fetch chess.com from your own browser instead — or paste the PGN in the PGN / file tab; that path always works.'

function normName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/^@/, '').trim().toLowerCase() : ''
}

function playedBy(g: ChessComGame, name: string): boolean {
  return normName(g.white?.username) === name || normName(g.black?.username) === name
}

/**
 * The user's PGNs from the most recent `months` chess.com monthly archives,
 * newest first. Each archive request that fails (e.g. a 404 for an empty
 * month) is skipped — only a broken archives index or a hard block fails the
 * whole call.
 */
export async function fetchChessComGames(
  username: string,
  months: number,
  deadline: number = Date.now() + TOTAL_BUDGET_MS,
): Promise<string[]> {
  const name = username.toLowerCase()
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' }

  let archiveUrls: string[]
  try {
    const res = await deadlineFetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(name)}/games/archives`,
      { headers },
      deadline,
      'chess.com',
    )
    if (res.status === 404) {
      throw new ImportUpstreamError(`chess.com has no player named “${username}” — check the spelling.`, 404)
    }
    if (res.status === 403) throw new ImportUpstreamError(CHESSCOM_BLOCKED, 502)
    if (!res.ok) throw new ImportUpstreamError(`chess.com answered HTTP ${res.status}.`, 502)
    const data = (await res.json().catch(() => null)) as { archives?: unknown } | null
    archiveUrls = data && Array.isArray(data.archives) ? data.archives.filter((u): u is string => typeof u === 'string') : []
  } catch (e) {
    if (e instanceof ImportUpstreamError) throw e
    throw isTimeout(e) ? timeoutError('chess.com') : new ImportUpstreamError(`Could not reach chess.com from the server: ${e instanceof Error ? e.message : String(e)}`, 502)
  }

  // Newest last in the API response → sort by the YYYY/MM in the URL, desc.
  const monthly = archiveUrls
    .map((u) => ({ u, m: /\/games\/(\d{4})\/(\d{2})$/.exec(u) }))
    .filter((x): x is { u: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(b.m[1] + b.m[2]) - Number(a.m[1] + a.m[2]))
    .slice(0, Math.max(1, Math.min(MAX_MONTHS, months)))

  if (monthly.length === 0) return []

  const settled = await Promise.allSettled(
    monthly.map(async ({ u }) => {
      const res = await deadlineFetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, deadline, 'chess.com')
      if (!res.ok) return [] // an empty/blocked month must not sink the import
      const data = (await res.json().catch(() => null)) as { games?: unknown } | null
      const games = data && Array.isArray(data.games) ? (data.games as ChessComGame[]) : []
      return games.filter((g) => g && typeof g.pgn === 'string' && (g.pgn as string).trim().length > 0 && playedBy(g, name))
    }),
  )

  const pgns = settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .map((g) => g.pgn as string)
  // end_time arrives from the archive entries; use the PGN's UTCTime header
  // order as a stable fallback (newest last inside a month) — sort desc.
  return pgns.reverse()
}

// ---------------------------------------------------------------------------
// lichess
// ---------------------------------------------------------------------------

/**
 * The user's finished games from lichess as individual PGN strings, newest
 * first (the export is newest-first already). Empty array = the account
 * exists but has no games in the window.
 */
export async function fetchLichessGames(
  username: string,
  months: number,
  deadline: number = Date.now() + TOTAL_BUDGET_MS,
): Promise<string[]> {
  const since = Date.now() - Math.max(1, Math.min(MAX_MONTHS, months)) * 31 * 86400_000
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=100&pgnInJson=false&opening=true&clocks=false&evals=false&since=${since}`
  // deadlineFetch classifies timeouts (504) and network failures (502) already.
  const res = await deadlineFetch(
    url,
    { headers: { Accept: 'application/x-chess-pgn', 'User-Agent': USER_AGENT } },
    deadline,
    'lichess',
  )
  if (res.status === 404) {
    throw new ImportUpstreamError(`lichess has no player named “${username}” — check the spelling.`, 404)
  }
  if (res.status === 429) {
    throw new ImportUpstreamError('lichess is rate-limiting these requests right now — wait a minute and try again.', 429)
  }
  if (!res.ok) throw new ImportUpstreamError(`lichess answered HTTP ${res.status}.`, 502)
  const text = await res.text()
  if (text.length > LICHESS_MAX_BYTES) {
    throw new ImportUpstreamError('That lichess export is too large to import in one go — pick fewer months.', 502)
  }
  return splitPgnGames(text)
}

// ---------------------------------------------------------------------------
// Parsing + signature
// ---------------------------------------------------------------------------

export interface ParsedImportGame {
  pgn: string
  color: 'w' | 'b'
  result: 'win' | 'loss' | 'draw'
  reason: string
  opponent: string
  finalFen: string
  moveCount: number
  opening: string
  localHour: number | null
  signature: string
}

/**
 * Stable identity of a game across imports and platforms of origin: sha1 over
 * both player names, the UTC date+time, the result and the normalized
 * (lowercase, check/mate-suffix-stripped) SAN move list. Computed the exact
 * same way for fresh PGNs and for GameRecord rows already in the DB, so a
 * re-import of the same game can never duplicate.
 */
function signatureOf(sans: string[], h: Record<string, string>): string {
  const moves = sans.map((s) => s.replace(/[+#]/g, '').toLowerCase()).join(' ')
  const date = h.UTCDate || h.Date || ''
  const time = h.UTCTime || ''
  return createHash('sha1').update(`${h.White}|${h.Black}|${date}|${time}|${h.Result}|${moves}`).digest('hex')
}

/** Signature of any stored PGN (GameRecord rows), or null if unparseable. */
export function gameSignature(pgn: string): string | null {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
  } catch {
    return null
  }
  const sans = chess.history()
  if (sans.length === 0) return null
  return signatureOf(sans, chess.getHeaders())
}

/**
 * Validate one PGN chunk by replaying it, and pull out everything the
 * GameRecord row needs. Returns null for anything not worth storing: an
 * illegal/unparseable PGN, a game with no moves, an unfinished game
 * (Result '*'), or a game the requested user did not play in.
 */
export function parseImportedGame(chunk: string, username: string): ParsedImportGame | null {
  const pgn = chunk.trim()
  if (!pgn || pgn.length > 100_000) return null
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
  } catch {
    return null
  }
  const sans = chess.history()
  if (sans.length === 0) return null
  const h = chess.getHeaders()
  const resultRaw = (h.Result ?? '*').trim()
  if (resultRaw !== '1-0' && resultRaw !== '0-1' && resultRaw !== '1/2-1/2') return null

  const target = username.trim().toLowerCase()
  const white = (h.White ?? '').trim()
  const black = (h.Black ?? '').trim()
  const isWhite = white.toLowerCase() === target
  const isBlack = black.toLowerCase() === target
  if (!isWhite && !isBlack) return null
  const color: 'w' | 'b' = isWhite ? 'w' : 'b'
  const result: 'win' | 'loss' | 'draw' =
    resultRaw === '1/2-1/2' ? 'draw' : (resultRaw === '1-0') === isWhite ? 'win' : 'loss'

  // Termination: chess.js gives the facts for free; the PGN tag only supplies
  // "abandoned" (everything else — "Normal", "Time forfeit" — is not in the
  // schema's reason vocabulary, so we leave reason honest and empty).
  const termination = h.Termination ?? ''
  let reason = ''
  if (/abandon/i.test(termination)) reason = 'abandoned'
  else if (chess.isCheckmate()) reason = 'checkmate'
  else if (chess.isStalemate()) reason = 'stalemate'
  else if (chess.isInsufficientMaterial()) reason = 'insufficient'
  else if (chess.isThreefoldRepetition()) reason = 'repetition'

  // Player's local hour: the schema comment wants the hour the game ended;
  // the PGN only pins down UTC, so that is what we store (0-23).
  const iso = (h.UTCDate || h.Date || '').replace(/\./g, '-')
  const time = h.UTCTime || ''
  let localHour: number | null = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && /^\d{2}:\d{2}/.test(time)) {
    const d = new Date(`${iso}T${time.slice(0, 8)}Z`)
    if (Number.isFinite(d.getTime())) localHour = d.getUTCHours()
  }

  const opponent = (color === 'w' ? black : white) || 'unknown'

  return {
    pgn,
    color,
    result,
    reason,
    opponent,
    finalFen: chess.fen(),
    moveCount: sans.length,
    opening: detectOpening(sans),
    localHour,
    signature: signatureOf(sans, h),
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface ImportStats {
  /** Valid games for this user that were considered for storage. */
  fetched: number
  /** Rows actually written. */
  imported: number
  /** Duplicates skipped (already in the profile's history or in this batch). */
  skipped: number
}

/**
 * Parse, validate, dedupe against the profile's most recent stored games and
 * insert as GameRecord rows. botLevel 0 marks imported games; ratingDelta and
 * accuracy stay null because imported games are unanalyzed and Elo pools do
 * not apply.
 */
export async function storeImportedGames(
  profileId: string,
  username: string,
  platform: 'chesscom' | 'lichess',
  pgns: string[],
): Promise<ImportStats> {
  void platform // kept in the signature for logging symmetry; the PGN self-identifies
  const parsed: ParsedImportGame[] = []
  const batchSigs = new Set<string>()
  for (const chunk of pgns) {
    if (parsed.length >= MAX_GAMES_STORE) break
    const g = parseImportedGame(chunk, username)
    if (!g || batchSigs.has(g.signature)) continue
    batchSigs.add(g.signature)
    parsed.push(g)
  }
  const fetched = parsed.length
  if (fetched === 0) return { fetched: 0, imported: 0, skipped: 0 }

  const existing = await db.gameRecord.findMany({
    where: { profileId },
    select: { pgn: true },
    orderBy: { createdAt: 'desc' },
    take: DEDUPE_SCAN,
  })
  const seen = new Set<string>()
  for (const row of existing) {
    const sig = gameSignature(row.pgn)
    if (sig) seen.add(sig)
  }
  const toInsert = parsed.filter((g) => {
    if (seen.has(g.signature)) return false
    seen.add(g.signature)
    return true
  })
  if (toInsert.length === 0) return { fetched, imported: 0, skipped: fetched }

  await db.gameRecord.createMany({
    data: toInsert.map((g) => ({
      profileId,
      color: g.color,
      botLevel: 0, // imported: outside the 1..14 bot ladder; consumers clamp
      botName: g.opponent.slice(0, 40),
      rated: true,
      result: g.result,
      reason: g.reason.slice(0, 30),
      pgn: g.pgn,
      finalFen: g.finalFen,
      moveCount: g.moveCount,
      opening: g.opening,
      localHour: g.localHour,
      ratingDelta: null,
      accuracy: null,
    })),
  })
  return { fetched, imported: toInsert.length, skipped: fetched - toInsert.length }
}
