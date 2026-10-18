'use client'
// The Tools view: chessigma-class side tools, chess.com grade.
//  - Elo calculator: standard Elo with the FIDE / chess.com / Lichess K rules.
//  - Opening guide: 18 curated openings, main line + variations + plans.
//  - Opening trainer: drill those main lines from memory (device-local progress).
//  - Identify opening: paste moves/PGN, get the ECO code and the deviation.
//  - Next Move Finder teaser: hands over to the free Analysis board.
//  - Public API card: documents the key-less rate-limited endpoints with
//    copyable curl examples.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, ArrowRight, Search, Wand2, Calculator, BookOpen, GraduationCap, Code2, Copy, Check, Compass } from 'lucide-react'
import { OpeningTrainer } from '@/components/views/opening-trainer'
import { OpeningExplorer } from '@/components/views/opening-explorer'
import { cn } from '@/lib/utils'
import { readJson } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { OpeningGuide } from '@/content/opening-guides'

// ---------------------------------------------------------------------------
// Elo math — exact standard formulas with each federation's K-factor rules.
// ---------------------------------------------------------------------------

type Outcome = 'win' | 'draw' | 'loss'

function expectedScore(me: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - me) / 400))
}

function eloDelta(me: number, opponent: number, outcome: Outcome, k: number): number {
  const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
  return Math.round(k * (score - expectedScore(me, opponent)))
}

/** K factors by federation, resolved per the published rules. */
function kFactors(me: number, gamesPlayed: number): { fide: number; chesscom: number; lichess: number } {
  const fide = gamesPlayed < 30 ? 40 : me < 2400 ? 20 : 10
  const chesscom = me < 2100 ? 32 : me < 2400 ? 16 : 8
  const lichess = gamesPlayed < 10 ? 32 : me < 2400 ? 32 : 16 // lichess scales down only at the very top
  return { fide, chesscom, lichess }
}

function EloCalculator() {
  const [me, setMe] = useState('1500')
  const [opp, setOpp] = useState('1650')
  const [outcome, setOutcome] = useState<Outcome>('win')
  const meN = Math.max(100, Math.min(3500, Math.round(Number(me) || 1500)))
  const oppN = Math.max(100, Math.min(3500, Math.round(Number(opp) || 1500)))
  const ks = kFactors(meN, 50) // 50 games: past provisional for FIDE
  const rows = [
    { name: 'FIDE', k: ks.fide, delta: eloDelta(meN, oppN, outcome, ks.fide) },
    { name: 'Chess.com', k: ks.chesscom, delta: eloDelta(meN, oppN, outcome, ks.chesscom) },
    { name: 'Lichess', k: ks.lichess, delta: eloDelta(meN, oppN, outcome, ks.lichess) },
  ]
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Elo calculator</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Your rating</span>
          <Input inputMode="numeric" value={me} onChange={(e) => setMe(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className="mt-1 min-h-11 font-mono" aria-label="Your rating" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Opponent rating</span>
          <Input inputMode="numeric" value={opp} onChange={(e) => setOpp(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className="mt-1 min-h-11 font-mono" aria-label="Opponent rating" />
        </label>
      </div>
      <div className="mt-3 flex overflow-hidden rounded-lg border" role="group" aria-label="Game result">
        {(['win', 'draw', 'loss'] as Outcome[]).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOutcome(o)}
            aria-pressed={outcome === o}
            className={cn(
              'min-h-11 flex-1 px-4 py-2 text-sm font-bold capitalize transition',
              outcome === o ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {o}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-secondary/60 p-3">
        <div className="font-mono text-3xl font-extrabold tabular-nums">
          {meN + rows[1].delta}{' '}
          <span className={rows[1].delta >= 0 ? 'text-primary' : 'text-destructive'}>
            ({rows[1].delta >= 0 ? '+' : ''}{rows[1].delta})
          </span>
        </div>
        <div className="text-xs text-muted-foreground">chess.com K-factor {ks.chesscom}</div>
      </div>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Rating change by federation</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-1 font-bold">Rating pool</th>
            <th scope="col" className="py-1 font-bold">K</th>
            <th scope="col" className="py-1 text-right font-bold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border/40">
              <td className="py-1.5 font-semibold">{r.name}</td>
              <td className="py-1.5 font-mono text-xs tabular-nums text-muted-foreground">{r.k}</td>
              <td className={cn('py-1.5 text-right font-mono font-bold tabular-nums', r.delta >= 0 ? 'text-primary' : 'text-destructive')}>
                {r.delta >= 0 ? '+' : ''}{r.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Opening guide: list -> detail. Identify: paste moves -> ECO code.
// ---------------------------------------------------------------------------

function OpeningGuideTool() {
  const [guides, setGuides] = useState<{ slug: string; name: string; eco: string; side: string }[]>([])
  const [active, setActive] = useState<OpeningGuide | null>(null)
  const [query, setQuery] = useState('')
  const [pgn, setPgn] = useState('')
  const [identified, setIdentified] = useState<{ eco: string; name: string; plies: number } | null>(null)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [identifying, setIdentifying] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/tools/opening', { cache: 'no-store' })
        const d = await readJson<{ guides?: { slug: string; name: string; eco: string; side: string }[] }>(res)
        setGuides(d?.guides ?? [])
      } catch {
        /* the list stays empty; the panel shows the empty state */
      }
    })()
  }, [])

  const open = useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/tools/opening?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      const d = await readJson<{ guide?: OpeningGuide }>(res)
      if (d?.guide) setActive(d.guide)
    } catch {
      /* keep the previous pane */
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return guides
    return guides.filter((g) => g.name.toLowerCase().includes(q) || g.eco.toLowerCase().includes(q))
  }, [guides, query])

  const identify = useCallback(async () => {
    setIdentifying(true)
    setIdentifyError(null)
    setIdentified(null)
    try {
      const res = await fetch('/api/tools/opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn }),
      })
      const d = await readJson<{ eco?: string; name?: string; plies?: number; error?: string }>(res)
      if (!res.ok || !d?.eco) {
        setIdentifyError(d?.error ?? 'That line could not be identified.')
        return
      }
      setIdentified({ eco: d.eco, name: d.name ?? '', plies: d.plies ?? 0 })
    } catch {
      setIdentifyError('The identification service is unreachable.')
    } finally {
      setIdentifying(false)
    }
  }, [pgn])

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Opening guide</span>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Search openings</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 18 guides — name or ECO…" className="min-h-11 pl-9" aria-label="Search openings" />
        </div>
      </label>

      <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto pr-1 scroll-slim" aria-label="Opening guides">
        {filtered.map((g) => (
          <li key={g.slug}>
            <button
              type="button"
              onClick={() => void open(g.slug)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent',
                active?.slug === g.slug && 'bg-accent',
              )}
              aria-pressed={active?.slug === g.slug}
            >
              <span className="truncate font-semibold">{g.name}</span>
              <span className="ml-2 shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">{g.eco}</span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No guide matches that search.</li>}
      </ul>

      {active && (
        <article className="mt-3 rounded-lg border border-border/40 bg-background p-3" aria-label={`${active.name} guide`}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-extrabold">{active.name}</h3>
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">{active.eco}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1 font-mono text-xs">
            {active.moves.map((m, i) => (
              <span key={i} className={cn('rounded px-1.5 py-0.5', i % 2 === 0 ? 'bg-secondary font-bold text-foreground' : 'bg-secondary/60 text-muted-foreground')}>
                {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}{m}
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{active.idea}</p>
          <div className="mt-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Key variations</div>
            <ul className="mt-1 space-y-1.5">
              {active.variations.map((v) => (
                <li key={v.name} className="rounded-md bg-secondary/40 px-2 py-1.5">
                  <div className="text-xs font-bold">{v.name} · <span className="font-mono font-normal text-muted-foreground">{v.moves.join(' ')}</span></div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{v.idea}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md bg-secondary/40 px-2 py-1.5"><span className="font-bold">White&apos;s plan: </span><span className="text-muted-foreground">{active.whiteStrategy}</span></div>
            <div className="rounded-md bg-secondary/40 px-2 py-1.5"><span className="font-bold">Black&apos;s plan: </span><span className="text-muted-foreground">{active.blackStrategy}</span></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {active.strengths.map((s) => (
              <span key={s} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">+ {s}</span>
            ))}
            {active.weaknesses.map((w) => (
              <span key={w} className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">− {w}</span>
            ))}
          </div>
        </article>
      )}

      <div className="mt-4 border-t border-border/40 pt-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Identify an opening</span>
        </div>
        <Textarea
          value={pgn}
          onChange={(e) => setPgn(e.target.value)}
          placeholder="1. e4 c5 2. Nf3 d6 3. d4 cxd4 … (moves or a PGN)"
          className="mt-2 min-h-20 font-mono text-xs"
          aria-label="Paste moves or PGN to identify the opening"
        />
        <Button onClick={identify} disabled={identifying || !pgn.trim()} variant="secondary" className="mt-2 min-h-11">
          {identifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Identify
        </Button>
        {identified && (
          <div className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm" role="status">
            <span className="font-mono font-bold">{identified.eco}</span> · <span className="font-bold">{identified.name}</span>
            <span className="ml-1 text-xs text-muted-foreground">— matched after {identified.plies} pl{identified.plies === 1 ? 'y' : 'ies'}</span>
          </div>
        )}
        {identifyError && <p className="mt-2 text-sm font-semibold text-destructive">{identifyError}</p>}
      </div>
    </div>
  )
}

// Tabbed shell around the opening tools: keeps the existing guide reader
// and identifier untouched, and slots the Opening trainer and the community
// Opening explorer in beside them. `initialTab` lets deep links open the
// right one directly (the router carries the arg in the hash: #/tools/trainer).
function OpeningToolsSection({ initialTab }: { initialTab?: 'guide' | 'trainer' | 'explorer' }) {
  const [tab, setTab] = useState<'guide' | 'trainer' | 'explorer'>(
    initialTab === 'trainer' || initialTab === 'explorer' ? initialTab : 'guide',
  )
  const tabs = [
    { id: 'guide' as const, label: 'Opening guide', icon: BookOpen },
    { id: 'trainer' as const, label: 'Opening trainer', icon: GraduationCap },
    { id: 'explorer' as const, label: 'Explorer', icon: Compass },
  ]
  return (
    <div>
      <div className="flex overflow-hidden rounded-lg border" role="tablist" aria-label="Opening tools">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-2 px-4 py-2 text-sm font-bold transition',
              tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3" role="tabpanel" aria-label={tab === 'guide' ? 'Opening guide' : tab === 'trainer' ? 'Opening trainer' : 'Opening explorer'}>
        {tab === 'guide' ? <OpeningGuideTool /> : tab === 'trainer' ? <OpeningTrainer /> : <OpeningExplorer />}
      </div>
    </div>
  )
}

function NextMoveFinder() {
  const navigate = useApp((s) => s.navigate)
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Next move finder</span>
      <p className="mt-1 text-sm text-muted-foreground">
        Drop any position and get the engine&apos;s best move instantly — Stockfish 19, running at full depth in the free analysis board.
      </p>
      <Button onClick={() => navigate('analysis')} className="mt-3 min-h-11">
        Open the analysis board <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public API docs: the key-less, rate-limited read surface over the engine
// and puzzle bank. One card, five endpoints, copyable curl per endpoint.
// ---------------------------------------------------------------------------

const PUBLIC_ENDPOINTS: { method: 'GET' | 'POST'; path: string; desc: string; curl: string }[] = [
  {
    method: 'GET',
    path: '/api/public/puzzles/daily',
    desc: "Today's deterministic daily puzzle — FEN, rating, themes, move count. Spoiler-free: no solution, no title.",
    curl: 'curl http://localhost:3000/api/public/puzzles/daily',
  },
  {
    method: 'GET',
    path: '/api/public/puzzles?rating=1200&themes=mate,fork',
    desc: 'Ten sanitized puzzles around a rating (600-2800), optionally filtered by up to five theme ids. The first call for a fresh rating/theme combo scans the bank; repeats are cached for ~10 minutes.',
    curl: 'curl "http://localhost:3000/api/public/puzzles?rating=1200&themes=mate,fork"',
  },
  {
    method: 'POST',
    path: '/api/public/position/eval',
    desc: 'Stockfish 19 evaluation of a FEN — best move, score (side to move), mate, PV. Depth 6-18, default 12.',
    curl: `curl -X POST http://localhost:3000/api/public/position/eval -H 'Content-Type: application/json' -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","depth":12}'`,
  },
  {
    method: 'GET',
    path: '/api/public/opening/identify?moves=e4,e5,Nf3,Nc6,Bb5',
    desc: 'Match a move list against the ECO table. A POST with { "pgn": "…" } works too.',
    curl: 'curl "http://localhost:3000/api/public/opening/identify?moves=e4,e5,Nf3,Nc6,Bb5"',
  },
  {
    method: 'GET',
    path: '/api/public/leaderboard',
    desc: 'Top 20 puzzle solvers — public display names only, no account metadata.',
    curl: 'curl http://localhost:3000/api/public/leaderboard',
  },
]

function PublicApiCard() {
  const [copied, setCopied] = useState<number | null>(null)
  const copy = (i: number, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(i)
    window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1600)
  }
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <Code2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Public API</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">30 requests per minute, no key required</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A small read-only JSON API over this app&apos;s engine and puzzle bank — build bots, dashboards or study scripts on it. CORS is open and every response carries <code className="font-mono text-xs">X-RateLimit</code> headers. Examples point at a local dev server; replace the origin with yours.
      </p>
      <ul className="mt-3 space-y-2.5">
        {PUBLIC_ENDPOINTS.map((e, i) => (
          <li key={e.method + e.path} className="rounded-lg border border-border/40 bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold', e.method === 'GET' ? 'bg-primary/10 text-primary' : 'bg-secondary text-foreground')}>{e.method}</span>
              <code className="min-w-0 break-all font-mono text-xs font-bold">{e.path}</code>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{e.desc}</p>
            <div className="mt-2 flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-secondary/60 p-2 font-mono text-[11px] leading-relaxed scroll-slim" aria-label={`curl example for ${e.path}`}><code>{e.curl}</code></pre>
              <Button variant="secondary" size="icon" className="h-11 w-11 shrink-0" onClick={() => copy(i, e.curl)} aria-label={`Copy curl example for ${e.path}`}>
                {copied === i ? <Check className="h-4 w-4 text-primary" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ToolsView() {
  // Deep-link arg from the hash (#/tools/trainer): open the requested tool
  // tab directly. Anything unrecognized falls back to the guide.
  const arg = useApp((s) => s.view.lessonId)
  const initialTab = arg === 'trainer' || arg === 'explorer' ? arg : undefined
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="font-display text-2xl font-extrabold">Tools</h1>
      <p className="mt-1 text-sm text-muted-foreground">Free, unlimited, no account needed. The same engine the rest of the app runs on.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EloCalculator />
        <NextMoveFinder />
        <div className="lg:col-span-2">
          <OpeningToolsSection key={initialTab ?? 'guide'} initialTab={initialTab} />
        </div>
        <PublicApiCard />
      </div>
    </div>
  )
}
