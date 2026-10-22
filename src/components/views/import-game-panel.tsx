'use client'

/**
 * Chessigma-style "review an online game" import.
 *
 * NETWORK REALITY (verified from the sandbox): both api.chess.com and
 * lichess.org game export are CORS-open for browsers, so the player's own
 * browser talks to them DIRECTLY — never through this app's datacenter IP,
 * which both providers block. The only server help is a tiny lichess-only
 * fallback proxy (/api/import/lichess) tried once when a direct browser fetch
 * fails. chess.com has no fallback: when the direct fetch is blocked we say so
 * honestly and point at the PGN / file tab, which always works.
 */

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertTriangle, Crown, FileUp, Globe, Link2, Loader2, Search, Swords, Upload, Users } from 'lucide-react'

// ---------------------------------------------------------------------------
// PGN helpers (text-level only — the real parse lives in GameReview)
// ---------------------------------------------------------------------------

interface GameMeta {
  pgn: string
  white: string
  black: string
  result: string
  dateLabel: string
  tcLabel: string
  plies: number
  source: string
}

class HttpError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const PGN_ACCEPT = { Accept: 'application/x-chess-pgn' }

function pgnHeaderValue(pgn: string, name: string): string {
  const m = new RegExp(`\\[${name}\\s+"([^"]*)"\\]`).exec(pgn)
  return m?.[1] ?? ''
}

/** True when the text plausibly carries PGN headers or SAN movetext. */
function looksLikePgn(text: string): boolean {
  return /^\s*\[Event\s+"/.test(text) || /1\.\s*[a-zA-Z]/.test(text)
}

/** Split a multi-game PGN export into single-game chunks. */
function splitGames(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  // Games are separated by a blank line right before the next [Event header
  // (lichess + chess.com exports), or by 2+ blank lines in any export.
  const chunks = t
    .split(/\n\s*\n(?=\[Event\s)|\n{3,}/g)
    .map((c) => c.trim())
    .filter(Boolean)
  return chunks.length > 0 ? chunks : [t]
}

/** Attribution for the review note: "Imported from lichess game abc123". */
function sourceOf(pgn: string): string {
  const site = pgnHeaderValue(pgn, 'Site')
  const id = site.split('/').filter(Boolean).pop() ?? ''
  if (/lichess\.org/i.test(site)) return id ? `lichess game ${id}` : 'lichess'
  if (/chess\.com/i.test(site)) return id ? `chess.com game ${id}` : 'chess.com'
  return 'pasted PGN'
}

function tcLabel(pgn: string): string {
  const tc = pgnHeaderValue(pgn, 'TimeControl')
  if (!tc || tc === '-' || tc === '?') return 'Unlimited'
  const [baseRaw, incRaw] = tc.split('+')
  const base = Number(baseRaw)
  const inc = Number(incRaw) || 0
  if (!Number.isFinite(base) || base <= 0) return ''
  const est = base + inc * 40
  if (est < 180) return 'Bullet'
  if (est < 480) return 'Blitz'
  if (est < 1500) return 'Rapid'
  return 'Classical'
}

function dateLabel(pgn: string): string {
  const raw = pgnHeaderValue(pgn, 'UTCDate') || pgnHeaderValue(pgn, 'Date')
  if (!raw) return ''
  const iso = raw.replace(/\./g, '-')
  const time = pgnHeaderValue(pgn, 'UTCTime') || '12:00:00'
  const d = new Date(`${iso}T${time}Z`)
  if (Number.isFinite(d.getTime())) {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return iso
}

/** Count SAN tokens without a full chess.js parse (fast enough for 30 games). */
function countPlies(pgn: string): number {
  let body = pgn.replace(/^\[[^\]]*\][ \t]*$/gm, ' ')
  for (;;) {
    const stripped = body.replace(/\([^()]*\)/g, ' ')
    if (stripped === body) break
    body = stripped
  }
  body = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  let n = 0
  for (const token of body.split(/\s+/)) {
    // strip glued move numbers ("1.e4" → "e4", "3...Nf6" → "Nf6")
    const s = token.replace(/^\d+\.(\.\.)?/, '')
    if (!s) continue
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s)) continue
    if (/^\$\d+$/.test(s)) continue
    n += 1
  }
  return n
}

function metaFromPgn(pgn: string, tcFallback?: string): GameMeta {
  const tc = tcLabel(pgn)
  return {
    pgn,
    white: pgnHeaderValue(pgn, 'White') || 'White',
    black: pgnHeaderValue(pgn, 'Black') || 'Black',
    result: pgnHeaderValue(pgn, 'Result') || '*',
    dateLabel: dateLabel(pgn),
    tcLabel: tc || (tcFallback ?? ''),
    plies: countPlies(pgn),
    source: sourceOf(pgn),
  }
}

/** Accept usernames or pasted profile URLs ("@user", lichess.org/@/user, chess.com/member/User). */
function cleanUsername(raw: string, provider: 'lichess' | 'chesscom'): string {
  let s = raw.trim()
  if (s.includes('/')) {
    const parts = s.split('/').filter(Boolean)
    s = parts[parts.length - 1] ?? ''
  }
  s = s.replace(/^@/, '')
  return provider === 'chesscom' ? s.toLowerCase() : s
}

// ---------------------------------------------------------------------------
// Provider calls — direct from the browser, lichess with one server retry
// ---------------------------------------------------------------------------

const LICHESS_USER_URL = (name: string) =>
  `https://lichess.org/api/games/user/${encodeURIComponent(name)}?max=30&opening=true&clocks=true&evals=false`
const LICHESS_EXPORT_URL = (id: string) => `https://lichess.org/game/export/${encodeURIComponent(id)}?clocks=true`

async function fetchPgnText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: PGN_ACCEPT })
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status)
  const text = await res.text()
  if (!looksLikePgn(text)) throw new HttpError('no PGN in the answer', res.status)
  return text
}

/** Single retry through the app's tiny lichess-only proxy (see the route file). */
async function fetchLichessViaProxy(url: string): Promise<string> {
  const res = await fetchWithTimeout('/api/import/lichess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = (await res.json().catch(() => null)) as { pgn?: unknown; error?: unknown } | null
  if (!res.ok || !data || typeof data.pgn !== 'string') {
    const msg = data && typeof data.error === 'string' ? data.error : `proxy answered HTTP ${res.status}`
    throw new HttpError(msg, res.status)
  }
  return data.pgn
}

/**
 * Lichess: browser first; retry ONCE through the proxy for network-level
 * failures. A clean 404 (unknown player) or 429 (rate limit) skips the proxy —
 * it would only get the same answer from the server.
 */
async function fetchLichessPgn(url: string): Promise<{ text: string; viaProxy: boolean; lastStatus: number | null }> {
  try {
    return { text: await fetchPgnText(url), viaProxy: false, lastStatus: null }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : null
    if (status === 404 || status === 429) throw e
    const text = await fetchLichessViaProxy(url)
    return { text, viaProxy: true, lastStatus: null }
  }
}

function lichessFailureMessage(name: string, direct: unknown, viaProxy: unknown): string {
  const status = (err: unknown): number | null => (err instanceof HttpError ? err.status : null)
  const s = status(direct) ?? status(viaProxy)
  if (s === 404) return `lichess has no player named “${name}”.`
  if (s === 429) return 'lichess is rate-limiting these requests right now — wait a minute and try again.'
  return `Could not reach lichess — not from your browser, and not through our server either (lichess blocks game export from some datacenter IPs). Paste the PGN in the PGN / file tab; that path always works.`
}

interface ChessComArchiveGame {
  pgn?: unknown
  end_time?: unknown
  time_class?: unknown
}

const CHESSCOM_BLOCKED =
  'chess.com would not answer this request (HTTP 403). It often blocks automated traffic from some networks — and unlike lichess there is no server fallback. Copy the PGN from the chess.com game page and paste it in the PGN / file tab; that path always works.'

/**
 * Bulk flow, browser-first: the user's own browser fetches the games (chess.com
 * blocks the server's datacenter IP, not the user), the server only stores.
 * Each monthly archive that fails is skipped; a total failure throws for the
 * server-side fallback.
 */
async function fetchChessComArchivePgn(name: string, monthsBack: number): Promise<string[]> {
  const clean = cleanUsername(name, 'chesscom')
  const cursor = new Date()
  const months: string[] = []
  for (let i = 0; i < monthsBack; i++) {
    months.push(`${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  const settled = await Promise.allSettled(
    months.map(async (ym) => {
      const res = await fetchWithTimeout(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}/games/${ym}`)
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status)
      const data = (await res.json().catch(() => null)) as { games?: ChessComArchiveGame[] } | null
      return (data?.games ?? []).map((g) => (typeof g?.pgn === 'string' ? g.pgn : '')).filter(Boolean)
    }),
  )
  const ok = settled.filter((s): s is PromiseFulfilledResult<string[]> => s.status === 'fulfilled').flatMap((s) => s.value)
  if (ok.length === 0 && settled.every((s) => s.status === 'rejected')) {
    const statuses = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => (s.reason instanceof HttpError ? s.reason.status : null))
    if (statuses.includes(403)) throw new HttpError(CHESSCOM_BLOCKED, 403)
    throw new HttpError('Could not reach chess.com from your browser.', null)
  }
  return ok.slice(0, 250)
}

/** Lichess multi-game PGN export, split into individual games. */
async function fetchLichessUserPgn(name: string, max: number): Promise<string[]> {
  const clean = cleanUsername(name, 'lichess')
  const res = await fetchWithTimeout(
    `https://lichess.org/api/games/user/${encodeURIComponent(clean)}?max=${max}&opening=true&clocks=false&evals=false`,
    { headers: { Accept: 'application/x-chess-pgn' } },
  )
  if (res.status === 404) throw new HttpError(`lichess has no player named “${clean}”.`, 404)
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status)
  const text = await res.text()
  if (!looksLikePgn(text)) throw new HttpError('no PGN in the answer', res.status)
  return text.split(/\n\s*\n(?=\[Event )/).map((g) => g.trim()).filter((g) => g.length > 20)
}

async function fetchChessComRecent(username: string): Promise<{ games: ChessComArchiveGame[]; months: string[] }> {
  const name = cleanUsername(username, 'chesscom')
  // The two most recent calendar months, today-based.
  const cursor = new Date()
  const months: string[] = []
  for (let i = 0; i < 2; i++) {
    months.push(`${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  const settled = await Promise.allSettled(
    months.map(async (ym) => {
      const res = await fetchWithTimeout(`https://api.chess.com/pub/player/${encodeURIComponent(name)}/games/${ym}`)
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status)
      const data = (await res.json().catch(() => null)) as { games?: unknown } | null
      const games = data && Array.isArray(data.games) ? data.games : []
      return games.filter((g): g is ChessComArchiveGame => {
        if (!g || typeof g !== 'object') return false
        const pgn = (g as ChessComArchiveGame).pgn
        return typeof pgn === 'string' && pgn.trim().length > 0
      })
    }),
  )
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
  if (ok.length === 0) {
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (rejected.length === settled.length) {
      const statuses = rejected.map((r) => (r.reason instanceof HttpError ? r.reason.status : null))
      if (statuses.includes(403)) throw new HttpError(CHESSCOM_BLOCKED, 403)
      if (statuses.every((s) => s === 404)) {
        throw new HttpError(`chess.com has no player archive for “${name}” — check the spelling.`, 404)
      }
      throw new HttpError('Could not reach chess.com from your network. Try again, or paste the PGN in the PGN / file tab.', null)
    }
    throw new HttpError(`No games found for “${name}” in ${months.join(' + ')}. Try an earlier month on chess.com, or paste a PGN.`, null)
  }
  ok.sort((a, b) => (Number(b.end_time) || 0) - (Number(a.end_time) || 0))
  return { games: ok.slice(0, 30), months }
}

// ---------------------------------------------------------------------------
// Shared UI pieces
// ---------------------------------------------------------------------------

function Micro({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</div>
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold leading-relaxed text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function GameList({
  games,
  selected,
  onSelect,
  label,
}: {
  games: GameMeta[]
  selected: number
  onSelect: (i: number) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="scroll-slim mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
      {games.map((g, i) => (
        <button
          key={`${g.source}-${i}`}
          type="button"
          role="radio"
          aria-checked={selected === i}
          disabled={g.plies === 0}
          onClick={() => onSelect(i)}
          className={cn(
            'min-h-11 w-full rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            selected === i ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold">
              {g.white} <span className="font-normal text-muted-foreground">vs</span> {g.black}
            </span>
            <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{g.result}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {[g.dateLabel, g.tcLabel, g.plies > 0 ? `${g.plies} plies` : 'no moves'].filter(Boolean).join(' · ')}
          </span>
        </button>
      ))}
    </div>
  )
}

function ReviewButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button className="btn-hero mt-3 min-h-11 w-full" onClick={onClick} disabled={disabled}>
      <Swords className="h-4 w-4" /> Review this game
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function LichessTab({ commit }: { commit: (pgn: string, source?: string) => void }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [games, setGames] = useState<GameMeta[]>([])
  const [selected, setSelected] = useState(0)

  const load = useCallback(async () => {
    const name = cleanUsername(username, 'lichess')
    if (!name) {
      setError('Enter a lichess username (or paste your lichess profile link).')
      return
    }
    setLoading(true)
    setError(null)
    setGames([])
    setSelected(0)
    const url = LICHESS_USER_URL(name)
    try {
      const { text } = await fetchLichessPgn(url)
      const metas = splitGames(text)
        .map((g) => metaFromPgn(g))
        .filter((m) => m.plies > 0)
      if (metas.length === 0) {
        setError(`No games came back for “${name}”. Brand-new accounts and privacy-restricted profiles return nothing.`)
      } else {
        setGames(metas)
      }
    } catch (direct) {
      try {
        const text = await fetchLichessViaProxy(url)
        const metas = splitGames(text)
          .map((g) => metaFromPgn(g))
          .filter((m) => m.plies > 0)
        if (metas.length === 0) {
          setError(`No games came back for “${name}”.`)
        } else {
          setGames(metas)
        }
      } catch (viaProxy) {
        setError(lichessFailureMessage(name, direct, viaProxy))
      }
    } finally {
      setLoading(false)
    }
  }, [username])

  const chosen = games[selected] ?? null
  return (
    <div>
      <Micro>Lichess username</Micro>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. DrNykterstein"
          aria-label="Lichess username"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) void load()
          }}
        />
        <Button variant="secondary" className="min-h-11 shrink-0" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Load recent games
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Fetches the 30 most recent games, with clocks and openings.</p>
      {loading && <p className="mt-3 text-xs font-semibold text-muted-foreground">Talking to lichess from your browser…</p>}
      {!loading && games.length === 0 && !error && (
        <p className="mt-3 text-xs text-muted-foreground">Your recent games appear here — pick one and send it to the review.</p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {games.length > 0 && <GameList games={games} selected={selected} onSelect={setSelected} label="Recent lichess games" />}
      {chosen && <ReviewButton onClick={() => commit(chosen.pgn, chosen.source)} />}
    </div>
  )
}

function ChessComTab({ commit }: { commit: (pgn: string, source?: string) => void }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState<string[] | null>(null)
  const [games, setGames] = useState<GameMeta[]>([])
  const [selected, setSelected] = useState(0)

  const load = useCallback(async () => {
    const name = cleanUsername(username, 'chesscom')
    if (!name) {
      setError('Enter a chess.com username (or paste your chess.com profile link).')
      return
    }
    setLoading(true)
    setError(null)
    setGames([])
    setSelected(0)
    setMonths(null)
    try {
      const { games: raw, months: ms } = await fetchChessComRecent(name)
      const metas = raw.map((g) => metaFromPgn(typeof g.pgn === 'string' ? g.pgn : '', typeof g.time_class === 'string' ? g.time_class : undefined))
      const playable = metas.filter((m) => m.plies > 0)
      if (playable.length === 0) {
        setError(`No games came back for “${name}”.`)
      } else {
        setMonths(ms)
        setGames(playable)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach chess.com. Paste the PGN in the PGN / file tab instead.')
    } finally {
      setLoading(false)
    }
  }, [username])

  const chosen = games[selected] ?? null
  return (
    <div>
      <Micro>Chess.com username</Micro>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. hikaru"
          aria-label="Chess.com username"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) void load()
          }}
        />
        <Button variant="secondary" className="min-h-11 shrink-0" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Load recent games
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Checks the two most recent monthly archives (chess.com public API).</p>
      {loading && <p className="mt-3 text-xs font-semibold text-muted-foreground">Talking to chess.com from your browser…</p>}
      {!loading && games.length === 0 && !error && (
        <p className="mt-3 text-xs text-muted-foreground">Your latest games appear here — pick one and send it to the review.</p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {games.length > 0 && (
        <>
          {months && <p className="mt-3 text-[11px] text-muted-foreground">Latest {games.length} games from {months.join(' + ')}.</p>}
          <GameList games={games} selected={selected} onSelect={setSelected} label="Recent chess.com games" />
        </>
      )}
      {chosen && <ReviewButton onClick={() => commit(chosen.pgn, chosen.source)} />}
    </div>
  )
}

type ParsedLink =
  | { provider: 'lichess'; gameId: string }
  | { provider: 'chesscom'; gameId: string }
  | { provider: 'profile'; providerName: string }
  | null

function parseGameLink(raw: string): ParsedLink {
  const s = raw.trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const seg = u.pathname.split('/').filter(Boolean)
  if (host === 'lichess.org' || host === 'lichess.dev') {
    // game/export/{id}, game/{id}[/{color}], embed/game/{id}, {id}[/{color}]
    const parts = seg.filter((p) => p !== 'embed')
    if (parts[0] === 'game') parts.shift()
    if (parts[0] === 'export') parts.shift()
    const first = parts[0]
    if (first && /^[A-Za-z0-9]{4,12}$/.test(first)) return { provider: 'lichess', gameId: first }
    return null
  }
  if (host === 'chess.com' || host === 'api.chess.com') {
    if (seg[0] === 'pub' && seg[1] === 'game' && seg[2] === 'export' && seg[3]) return { provider: 'chesscom', gameId: seg[3] }
    if ((seg[0] === 'game' || seg[0] === 'games') && seg[1] === 'view' && seg[2]) return { provider: 'chesscom', gameId: seg[2] }
    if (seg[0] === 'game' && seg[1] === 'live' && seg[2]) return { provider: 'chesscom', gameId: seg[2] }
    if (seg[0] === 'play' && seg[1] === 'online' && seg[2]) return { provider: 'chesscom', gameId: seg[2] }
    if (seg[0] === 'live') {
      const g = /g=([A-Za-z0-9]+)/.exec(u.hash) ?? /g=([A-Za-z0-9]+)/.exec(u.search)
      if (g) return { provider: 'chesscom', gameId: g[1] }
    }
    if (seg[0] === 'member' && seg[1]) return { provider: 'profile', providerName: 'chess.com' }
    return null
  }
  return null
}

function LinkTab({ commit }: { commit: (pgn: string, source?: string) => void }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState<GameMeta | null>(null)

  const load = useCallback(async () => {
    const parsed = parseGameLink(url)
    if (!parsed) {
      setError('That does not look like a lichess.org or chess.com game link.')
      return
    }
    if (parsed.provider === 'profile') {
      setError(`That is a ${parsed.providerName} profile link — use the ${parsed.providerName === 'chess.com' ? 'Chess.com' : 'Lichess'} tab with the username instead.`)
      return
    }
    setLoading(true)
    setError(null)
    setReady(null)
    try {
      if (parsed.provider === 'lichess') {
        const exportUrl = LICHESS_EXPORT_URL(parsed.gameId)
        try {
          setReady(metaFromPgn(await fetchPgnText(exportUrl)))
        } catch (direct) {
          const status = direct instanceof HttpError ? direct.status : null
          if (status === 404) {
            setError(`lichess has no game “${parsed.gameId}” (or it is private).`)
          } else {
            const text = await fetchLichessViaProxy(exportUrl)
            setReady(metaFromPgn(text))
          }
        }
      } else {
        const res = await fetchWithTimeout(`https://api.chess.com/pub/game/export/${encodeURIComponent(parsed.gameId)}`)
        if (!res.ok) {
          setError(
            `chess.com refused the export for game ${parsed.gameId} (HTTP ${res.status}). chess.com blocks many export requests — open the game on chess.com, copy its PGN, and paste it in the PGN / file tab.`,
          )
          return
        }
        const text = await res.text()
        let pgn = ''
        const type = res.headers.get('content-type') ?? ''
        if (type.includes('json') || text.trim().startsWith('{')) {
          const data = JSON.parse(text) as { pgn?: unknown }
          pgn = typeof data.pgn === 'string' ? data.pgn : ''
        } else {
          pgn = text
        }
        if (!looksLikePgn(pgn)) {
          setError('chess.com answered, but not with a readable PGN. Copy the PGN from the game page and paste it in the PGN / file tab.')
          return
        }
        setReady(metaFromPgn(pgn))
      }
    } catch {
      setError(
        parsed.provider === 'lichess'
          ? 'Could not reach lichess — not from your browser, and not through our server either. Paste the PGN in the PGN / file tab; that path always works.'
          : 'Could not reach chess.com from your network. Copy the PGN from the game page and paste it in the PGN / file tab; that path always works.',
      )
    } finally {
      setLoading(false)
    }
  }, [url])

  return (
    <div>
      <Micro>Game link</Micro>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="lichess.org/abc123 or chess.com/games/view/12345"
          aria-label="Game URL"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) void load()
          }}
        />
        <Button variant="secondary" className="min-h-11 shrink-0" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          Fetch
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Works with lichess.org/game/… and chess.com/games/view/… links. The provider is detected from the hostname.
      </p>
      {loading && <p className="mt-3 text-xs font-semibold text-muted-foreground">Fetching the game…</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {ready && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/50 p-3">
          <div className="text-sm font-bold">
            {ready.white} <span className="font-normal text-muted-foreground">vs</span> {ready.black}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {[ready.result, ready.dateLabel, ready.tcLabel, ready.plies > 0 ? `${ready.plies} plies` : null].filter(Boolean).join(' · ')}
          </div>
          <ReviewButton onClick={() => commit(ready.pgn, ready.source)} />
        </div>
      )}
    </div>
  )
}

function PgnTab({ commit }: { commit: (pgn: string, source?: string) => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      setError('That file is over 2 MB. Save the single game you want to review as its own .pgn file.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const s = typeof reader.result === 'string' ? reader.result : ''
      setText(s)
      setFileName(file.name)
      setError(null)
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }, [])

  const load = useCallback(() => {
    const t = text.trim()
    if (!t) {
      setError('Paste a PGN or choose a .pgn file first.')
      return
    }
    // A multi-game export would choke the single-game parser downstream; the
    // first game (usually the newest) is what gets reviewed.
    const games = splitGames(t)
    const first = games[0] ?? t
    const site = sourceOf(first)
    commit(first, site !== 'pasted PGN' ? site : (fileName ?? 'pasted PGN'))
  }, [text, fileName, commit])

  return (
    <div>
      <Micro>Paste a PGN</Micro>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 …'}
        aria-label="PGN text"
        className="mt-1.5 min-h-[140px] font-mono text-xs"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,.txt"
          className="sr-only"
          aria-label="Choose a PGN file"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button variant="secondary" className="min-h-11" onClick={() => fileRef.current?.click()}>
          <FileUp className="h-4 w-4" /> Choose .pgn file
        </Button>
        {fileName && <span className="truncate text-xs text-muted-foreground">{fileName}</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button className="btn-hero mt-3 min-h-11 w-full" onClick={load} disabled={!text.trim()}>
        <Upload className="h-4 w-4" /> Load
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        The most reliable path — works even when lichess or chess.com block the direct fetch. For a multi-game file, the first game is loaded.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bulk import by username (server-side; saves to the history, no review)
// ---------------------------------------------------------------------------

type BulkPlatform = 'chesscom' | 'lichess'

interface BulkResult {
  ok?: unknown
  fetched?: unknown
  imported?: unknown
  skipped?: unknown
  error?: unknown
}

function BulkTab({ signedIn }: { signedIn: boolean }) {
  const [platform, setPlatform] = useState<BulkPlatform>('chesscom')
  const [username, setUsername] = useState('')
  const [months, setMonths] = useState<'1' | '3' | '6'>('3')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ imported: number; fetched: number; skipped: number; user: string; empty: boolean } | null>(null)

  const run = useCallback(async () => {
    const name = username.trim()
    if (!name) {
      setError(`Enter a ${platform === 'chesscom' ? 'chess.com' : 'lichess'} username.`)
      return
    }
    setLoading(true)
    setError(null)
    setSummary(null)
    // Path 1 (primary): the BROWSER fetches the PGNs, the server only stores.
    // chess.com blocks datacenter IPs, so the server path cannot be trusted
    // for it; the user's own browser is the honest transport.
    try {
      const pgns = platform === 'chesscom' ? await fetchChessComArchivePgn(name, Number(months)) : await fetchLichessUserPgn(name, 250)
      if (pgns.length === 0) {
        setSummary({ imported: 0, fetched: 0, skipped: 0, user: name, empty: true })
        return
      }
      const res = await fetchWithTimeout(
        '/api/import/username',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, username: name, pgns }),
        },
        35_000,
      )
      const data = (await res.json().catch(() => null)) as BulkResult | null
      if (!res.ok) {
        setError(data && typeof data.error === 'string' ? data.error : `Import failed (HTTP ${res.status}).`)
        return
      }
      const imported = typeof data?.imported === 'number' ? data.imported : 0
      const fetched = typeof data?.fetched === 'number' ? data.fetched : 0
      const skipped = typeof data?.skipped === 'number' ? data.skipped : 0
      setSummary({ imported, fetched, skipped, user: name, empty: fetched === 0 })
      return
    } catch (browserErr) {
      // Path 2 (fallback): the old server-side fetch. Works for lichess;
      // chess.com usually answers 403 there, with an honest message.
      try {
        const res = await fetchWithTimeout(
          '/api/import/username',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, username: name, months: Number(months) }),
          },
          35_000,
        )
        const data = (await res.json().catch(() => null)) as BulkResult | null
        if (!res.ok) {
          setError(data && typeof data.error === 'string' ? data.error : `Import failed (HTTP ${res.status}).`)
          return
        }
        const imported = typeof data?.imported === 'number' ? data.imported : 0
        const fetched = typeof data?.fetched === 'number' ? data.fetched : 0
        const skipped = typeof data?.skipped === 'number' ? data.skipped : 0
        setSummary({ imported, fetched, skipped, user: name, empty: fetched === 0 })
        return
      } catch {
        setError(browserErr instanceof HttpError && browserErr.status === 404 && platform === 'lichess' ? browserErr.message : 'Could not reach the import service. Check your connection and try again.')
        return
      }
    } finally {
      setLoading(false)
    }
  }, [platform, username, months])

  return (
    <div>
      <Micro>Platform</Micro>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <Select value={platform} onValueChange={(v) => setPlatform(v as BulkPlatform)}>
          <SelectTrigger className="min-h-11 w-full" aria-label="Platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chesscom">Chess.com</SelectItem>
            <SelectItem value="lichess">Lichess</SelectItem>
          </SelectContent>
        </Select>
        <Select value={months} onValueChange={(v) => setMonths(v as '1' | '3' | '6')}>
          <SelectTrigger className="min-h-11 w-full" aria-label="How far back to import">
            <SelectValue placeholder="Months" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 1 month</SelectItem>
            <SelectItem value="3">Last 3 months</SelectItem>
            <SelectItem value="6">Last 6 months</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Micro className="mt-3">Username</Micro>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={platform === 'chesscom' ? 'e.g. hikaru' : 'e.g. DrNykterstein'}
          aria-label={`${platform === 'chesscom' ? 'Chess.com' : 'Lichess'} username for bulk import`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) void run()
          }}
        />
      </div>
      <Button className="btn-hero mt-3 min-h-11 w-full" onClick={() => void run()} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />}
        {loading ? 'Importing games…' : 'Import games'}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Saves the most recent finished games to your history, insights and coach. Already-imported games are skipped automatically.
        {!signedIn && ' Sign in first — the server needs an account to save into.'}
      </p>
      {loading && <p className="mt-3 text-xs font-semibold text-muted-foreground">Fetching the games from {platform === 'chesscom' ? 'chess.com' : 'lichess'} in your browser — this can take a few seconds…</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {summary && !error && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold leading-relaxed text-primary"
        >
          {summary.empty
            ? `No games found for ${summary.user} in the selected months.`
            : `Imported ${summary.imported} of ${summary.fetched} games from ${summary.user} (${summary.skipped} duplicates skipped).`}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel: trigger button + dialog
// ---------------------------------------------------------------------------

export function ImportGamePanel({
  onImport,
  disabled,
  className,
  signedIn = true,
}: {
  onImport: (pgn: string, source?: string) => void
  disabled?: boolean
  className?: string
  /** When false, the bulk tab explains that sign-in is required (the server 401s anyway). */
  signedIn?: boolean
}) {
  const [open, setOpen] = useState(false)

  const commit = useCallback(
    (pgn: string, source?: string) => {
      onImport(pgn, source)
      setOpen(false)
    },
    [onImport],
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={disabled} className={cn('min-h-11 w-full', className)}>
          <Upload className="h-4 w-4" /> Import online game
        </Button>
      </DialogTrigger>
      <DialogContent className="scroll-slim max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import an online game</DialogTitle>
          <DialogDescription>
            Pull a recent game from lichess or chess.com, paste a game link, or drop in a PGN. The review starts right after import. “By username” bulk-imports recent games into your history instead.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="lichess">
          <TabsList className="grid h-auto w-full grid-cols-5 gap-1">
            <TabsTrigger value="lichess" className="min-h-9 gap-1 px-1.5 text-[11px] sm:text-xs">
              <Globe className="hidden h-3.5 w-3.5 sm:block" aria-hidden /> Lichess
            </TabsTrigger>
            <TabsTrigger value="chesscom" className="min-h-9 gap-1 px-1.5 text-[11px] sm:text-xs">
              <Crown className="hidden h-3.5 w-3.5 sm:block" aria-hidden /> Chess.com
            </TabsTrigger>
            <TabsTrigger value="link" className="min-h-9 gap-1 px-1.5 text-[11px] sm:text-xs">
              <Link2 className="hidden h-3.5 w-3.5 sm:block" aria-hidden /> Game link
            </TabsTrigger>
            <TabsTrigger value="pgn" className="min-h-9 gap-1 px-1.5 text-[11px] sm:text-xs">
              <FileUp className="hidden h-3.5 w-3.5 sm:block" aria-hidden /> PGN / file
            </TabsTrigger>
            <TabsTrigger value="bulk" className="min-h-9 gap-1 px-1.5 text-[11px] sm:text-xs">
              <Users className="hidden h-3.5 w-3.5 sm:block" aria-hidden /> By username
            </TabsTrigger>
          </TabsList>
          <TabsContent value="lichess">
            <LichessTab commit={commit} />
          </TabsContent>
          <TabsContent value="chesscom">
            <ChessComTab commit={commit} />
          </TabsContent>
          <TabsContent value="link">
            <LinkTab commit={commit} />
          </TabsContent>
          <TabsContent value="pgn">
            <PgnTab commit={commit} />
          </TabsContent>
          <TabsContent value="bulk">
            <BulkTab signedIn={signedIn} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
