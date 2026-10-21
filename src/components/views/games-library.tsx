'use client'
/**
 * Games Library (REA chessigma port item 1 — "Imported games history").
 *
 * A browsable store of every game this account ever imported from
 * chess.com / lichess: summary strip (total, W-L-D, sources, most-played
 * openings), filters, pagination, and per-game actions:
 *  - Analyze: hands the PGN + game id to the Analysis review pipeline
 *    (the same setReviewPgn/setReviewGameId handoff the rest of the app uses,
 *    so a run report lands in Insights against this exact game).
 *  - PGN: fetch the full PGN and copy it.
 *
 * Honesty rules: rows come from the server without PGNs (the list stays
 * small); empty states say exactly why ("nothing imported yet" vs "no games
 * match these filters"); accuracy only shows when a review actually ran.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RefreshCw,
  Loader2,
  LineChart,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  LibraryBig,
  Upload,
} from 'lucide-react'
import { ImportGamePanel } from '@/components/views/import-game-panel'
import { cn } from '@/lib/utils'
import { readJson } from '@/lib/api-client'
import { useApp } from '@/lib/store'

interface LibraryGame {
  id: string
  color: 'w' | 'b'
  botName: string
  result: 'win' | 'loss' | 'draw'
  reason: string
  opening: string | null
  moveCount: number
  acc: number | null
  analyzedAt: string | null
  source: string | null
  createdAt: string
}

interface LibraryResponse {
  games: LibraryGame[]
  page: number
  pageSize: number
  filteredTotal: number
  summary: {
    total: number
    win: number
    loss: number
    draw: number
    sources: Record<string, number>
    openings: { name: string; count: number }[]
  }
}

type ResultFilter = 'all' | 'win' | 'loss' | 'draw'
type SourceFilter = 'all' | 'chesscom' | 'lichess'

const SOURCE_LABEL: Record<string, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  unknown: 'Imported',
}

const PAGE_SIZE = 25

export function GamesLibrary() {
  const navigate = useApp((s) => s.navigate)
  const setReviewPgn = useApp((s) => s.setReviewPgn)
  const setReviewGameId = useApp((s) => s.setReviewGameId)

  const [result, setResult] = useState<ResultFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [opening, setOpening] = useState('')
  const [openingInput, setOpeningInput] = useState('')
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<LibraryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Debounce the two text filters; any filter change resets to page 1.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setOpening(openingInput.trim())
      setQ(qInput.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(t)
  }, [openingInput, qInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (result !== 'all') sp.set('result', result)
      if (source !== 'all') sp.set('source', source)
      if (opening) sp.set('opening', opening)
      if (q) sp.set('q', q)
      const res = await fetch(`/api/library?${sp.toString()}`, { cache: 'no-store' })
      const d = await readJson<LibraryResponse>(res)
      if (!res.ok) throw new Error((d as unknown as { error?: string }).error ?? `Request failed (${res.status})`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the library.')
    } finally {
      setLoading(false)
    }
  }, [page, result, source, opening, q])

  useEffect(() => {
    void load()
  }, [load])

  const summary = data?.summary

  async function fetchPgn(id: string): Promise<string> {
    const res = await fetch(`/api/library?game=${encodeURIComponent(id)}`, { cache: 'no-store' })
    const d = await readJson<{ game?: { pgn?: string }; error?: string }>(res)
    if (!res.ok || !d.game?.pgn) throw new Error(d.error ?? 'Game not found.')
    return d.game.pgn
  }

  async function analyze(g: LibraryGame) {
    setBusyId(g.id)
    setError(null)
    try {
      const pgn = await fetchPgn(g.id)
      setReviewPgn(pgn)
      setReviewGameId(g.id)
      navigate('analysis')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that game.')
    } finally {
      setBusyId(null)
    }
  }

  async function copyPgn(g: LibraryGame) {
    setBusyId(g.id)
    try {
      const pgn = await fetchPgn(g.id)
      await navigator.clipboard?.writeText(pgn)
      setCopiedId(g.id)
      window.setTimeout(() => setCopiedId((c) => (c === g.id ? null : c)), 1600)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy the PGN.')
    } finally {
      setBusyId(null)
    }
  }

  const total = summary?.total ?? 0
  const totalPages = data ? Math.max(1, Math.ceil(data.filteredTotal / data.pageSize)) : 1
  const hasFilters = result !== 'all' || source !== 'all' || Boolean(opening) || Boolean(q)

  return (
    <section aria-labelledby="games-library-title" className="rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LibraryBig className="h-5 w-5 text-primary" aria-hidden />
        <h2 id="games-library-title" className="font-display text-xl font-extrabold">
          Game library
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
          every game you ever imported
        </span>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => void load()}
            aria-label="Refresh library"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          </Button>
          <ImportGamePanel
            signedIn
            onImport={(pgn) => {
              // Single-game imports promise "the review starts right after
              // import" — hand the PGN to the Analysis review pipeline.
              if (pgn) {
                setReviewPgn(pgn)
                navigate('analysis')
              }
            }}
            className="w-auto"
          />
        </div>
      </div>

      {/* Summary strip */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-background p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Imported games</div>
          <div className="mt-1 font-display text-2xl font-extrabold">{total}</div>
          {summary && (
            <div className="mt-1 text-xs text-muted-foreground">
              {summary.win}W · {summary.loss}L · {summary.draw}D
              {total > 0 && <span> · {Math.round((summary.win / total) * 100)}% won</span>}
            </div>
          )}
          {summary && total > 0 && (
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div className="bg-primary" style={{ width: `${(summary.win / total) * 100}%` }} />
              <div className="bg-destructive" style={{ width: `${(summary.loss / total) * 100}%` }} />
              <div className="bg-muted-foreground/50" style={{ width: `${(summary.draw / total) * 100}%` }} />
            </div>
          )}
        </div>
        <div className="rounded-lg bg-background p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Sources</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {summary ? (
              (['chesscom', 'lichess', 'unknown'] as const)
                .filter((k) => summary.sources[k] > 0)
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      if (k === 'unknown') return
                      setSource((s) => (s === k ? 'all' : (k as SourceFilter)))
                      setPage(1)
                    }}
                    disabled={k === 'unknown'}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
                      source === k ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
                      k === 'unknown' && 'cursor-default',
                    )}
                    title={k === 'unknown' ? 'Older imports without a provider tag' : `Filter by ${SOURCE_LABEL[k]}`}
                  >
                    {SOURCE_LABEL[k]} · {summary.sources[k]}
                  </button>
                ))
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
            {summary && summary.sources.chesscom === 0 && summary.sources.lichess === 0 && summary.sources.unknown === 0 && (
              <span className="text-xs text-muted-foreground">Nothing imported yet</span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-background p-3 sm:col-span-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Most-played openings</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {summary && summary.openings.length > 0 ? (
              summary.openings.map((o) => (
                <button
                  key={o.name}
                  onClick={() => {
                    setOpeningInput((v) => (v === o.name ? '' : o.name))
                    setPage(1)
                  }}
                  className={cn(
                    'max-w-[14rem] truncate rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
                    opening === o.name ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                  title={`Filter games of the ${o.name}`}
                >
                  {o.name} · {o.count}
                </button>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">
                Openings appear once games are imported
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Library filters">
        <Select
          value={result}
          onValueChange={(v) => {
            setResult(v as ResultFilter)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by result" className="min-h-11 w-full">
            <SelectValue placeholder="All results" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All results</SelectItem>
            <SelectItem value="win">Wins</SelectItem>
            <SelectItem value="loss">Losses</SelectItem>
            <SelectItem value="draw">Draws</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={source}
          onValueChange={(v) => {
            setSource(v as SourceFilter)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by source" className="min-h-11 w-full">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="chesscom">Chess.com</SelectItem>
            <SelectItem value="lichess">Lichess</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={openingInput}
          onChange={(e) => setOpeningInput(e.target.value)}
          placeholder="Opening contains…"
          aria-label="Filter by opening"
          className="min-h-11"
        />
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Opponent contains…"
          aria-label="Filter by opponent"
          className="min-h-11"
        />
      </div>
      {hasFilters && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs font-bold text-muted-foreground hover:text-foreground"
            onClick={() => {
              setResult('all')
              setSource('all')
              setOpeningInput('')
              setQInput('')
              setPage(1)
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* List */}
      <div className="mt-3">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading library…
          </div>
        ) : data && data.games.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
            <p className="font-semibold">{total === 0 ? 'No imported games yet' : 'No games match these filters'}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {total === 0
                ? 'Use Import online game → By username to pull your recent chess.com or lichess games into the library.'
                : 'Loosen or clear the filters to see the rest of the library.'}
            </p>
          </div>
        ) : data ? (
          <ul className="divide-y divide-border/60">
            {data.games.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                <span
                  className={cn(
                    'w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
                    g.result === 'win'
                      ? 'bg-primary text-primary-foreground'
                      : g.result === 'loss'
                        ? 'bg-destructive text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'} as {g.color === 'w' ? 'White' : 'Black'}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="max-w-[10rem] truncate text-sm font-bold" title={g.botName}>
                    vs {g.botName}
                  </span>
                  {g.opening && (
                    <span className="max-w-[12rem] truncate rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground" title={g.opening}>
                      {g.opening}
                    </span>
                  )}
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    {SOURCE_LABEL[g.source ?? 'unknown'] ?? 'Imported'}
                  </span>
                  <span className="text-xs text-muted-foreground">{g.moveCount} plies</span>
                  {g.acc != null && (
                    <span className="text-xs font-bold text-primary" title="Player accuracy from the last review run">
                      {g.acc.toFixed(1)}% acc
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground sm:hidden">
                    {new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden w-14 text-end text-xs text-muted-foreground sm:inline">
                    {new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    onClick={() => void copyPgn(g)}
                    disabled={busyId === g.id}
                    aria-label={`Copy PGN of the game vs ${g.botName}`}
                    title="Copy PGN"
                  >
                    {copiedId === g.id ? <Check className="h-4 w-4 text-primary" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => void analyze(g)}
                    disabled={busyId === g.id}
                  >
                    {busyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LineChart className="h-4 w-4" aria-hidden />}
                    Analyze
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Pagination */}
      {data && data.filteredTotal > data.pageSize && (
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-10"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
          </Button>
          <span className="text-xs font-bold text-muted-foreground" aria-live="polite">
            Page {data.page} of {totalPages} · {data.filteredTotal} games
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-10"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </section>
  )
}
