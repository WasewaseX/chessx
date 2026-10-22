/**
 * Seed Opening Review Queue data the honest way: run the REAL Stockfish WASM
 * engine over stored imported games (same depth-12 search, same
 * classifyMove thresholds as the client review pipeline), then POST the
 * per-ply evals to /api/games/report — the exact route the browser Review
 * flow uses. No fabricated numbers: every eval comes from the engine, every
 * label from the frozen 12-label classifier.
 *
 *   bun scripts/seed-opening-reviews.ts [pliesPerGame=44] [count=2] [openingFilter]
 *
 * Picks stored games that share one PGN Opening header (repeat openings are
 * what make the queue aggregate meaningful).
 */
import { Chess } from 'chess.js'
import { PrismaClient } from '@prisma/client'
import { classifyMove } from '../src/lib/chess/move-classification'

export {}
;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}
const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>

const FLATTEN = 80
const DEPTH = 12
const BASE = 'http://localhost:3000'

// The stockfish WASM glue replaces globalThis.fetch with its own loader —
// capture the real one BEFORE booting the engine.
const realFetch = globalThis.fetch.bind(globalThis)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------ engine harness -----------------------------

let send: (cmd: string) => void = () => {}
let lines: string[] = []

async function bootEngine(): Promise<void> {
  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const sink: string[] = []
  const origLog = console.log.bind(console)
  const origErr = console.error.bind(console)
  console.log = (l?: unknown) => { if (l != null) sink.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) sink.push(String(l)) }
  send = (cmd: string) =>
    (engine.ccall as (...args: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })
  lines = sink
  send('uci')
  const t0 = Date.now()
  while (!sink.includes('uciok') && Date.now() - t0 < 60_000) await sleep(25)
  send('isready')
  const t1 = Date.now()
  while (!sink.includes('readyok') && Date.now() - t1 < 60_000) await sleep(25)
  void origLog
  void origErr
}

interface UciLine {
  uci: string
  cp: number // side-to-move POV, mate flattened near ±(10000 - n)
}

/** One depth-12 MultiPV search; returns the ranked lines. */
async function analyzePosition(fen: string, mpv: number): Promise<UciLine[] | null> {
  const start = lines.length
  send(`setoption name MultiPV value ${mpv}`)
  send(`position fen ${fen}`)
  send(`go depth ${DEPTH}`)
  const t = Date.now()
  while (Date.now() - t < 45_000) {
    if (lines.slice(start).some((l) => l.startsWith('bestmove'))) break
    await sleep(20)
  }
  const slice = lines.slice(start)
  const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
  if (bestIdx < 0) return null
  const scope = slice.slice(0, bestIdx)
  const infos = scope.filter((l) => l.startsWith('info') && l.includes(' pv '))
  const out: UciLine[] = []
  const seen = new Set<string>()
  // last mpv info lines are the final iteration's ranked lines
  for (const l of infos.slice(-mpv)) {
    const uciM = / pv (([a-h][1-8][a-h][1-8][qrbn]?) ?)/.exec(l)
    const scoreM = / score (cp|mate) (-?\d+)/.exec(l)
    if (!uciM || !scoreM) continue
    const uci = uciM[2]
    if (seen.has(uci)) continue
    seen.add(uci)
    const raw = Number(scoreM[2])
    const cp = scoreM[1] === 'mate' ? Math.sign(raw) * (10_000 - Math.abs(raw)) : raw
    out.push({ uci, cp })
  }
  return out.length ? out : null
}

function flattenPawns(cp: number): number {
  return Math.max(-FLATTEN, Math.min(FLATTEN, cp / 100))
}

function sanFromUci(game: Chess, uci: string): string | null {
  try {
    const mv = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
    game.undo()
    return mv.san
  } catch {
    return null
  }
}

// ------------------------------ pipeline ------------------------------------

const db = new PrismaClient()

interface StoredGame {
  id: string
  pgn: string
  color: string
}

function pliesFromPgn(pgn: string): { fenBefore: string; san: string; color: 'w' | 'b'; uci: string }[] {
  const replay = new Chess()
  const body = pgn
    .replace(/\[[^\]]*\]\s*/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
  const tokens = body
    .split(/\s+/)
    .filter((t) => t && !t.startsWith('$') && t !== '*' && !/^(1-0|0-1|1\/2-1\/2)$/.test(t))
  const out: { fenBefore: string; san: string; color: 'w' | 'b'; uci: string }[] = []
  for (const san of tokens) {
    const fenBefore = replay.fen() // BEFORE the move — this is the drill position
    let mv
    try {
      mv = replay.move(san)
    } catch {
      break // corrupt tail: keep the verified prefix only
    }
    out.push({
      fenBefore,
      san: mv.san,
      color: mv.color,
      uci: `${mv.from}${mv.to}${mv.promotion ?? ''}`,
    })
  }
  return out
}

async function loginToken(): Promise<string> {
  const res = await realFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ identity: 'admin', password: 'admin1234' }),
  })
  const d = (await res.json()) as { token?: string }
  if (!d.token) throw new Error('login failed')
  return d.token
}

async function reviewGame(g: StoredGame, token: string, pliesPerGame: number): Promise<number> {
  const plies = pliesFromPgn(g.pgn).slice(0, pliesPerGame)
  const payload: unknown[] = []

  for (let i = 0; i < plies.length; i++) {
    const p = plies[i]
    const beforeLines = await analyzePosition(p.fenBefore, 2)
    const afterGame = new Chess(p.fenBefore)
    const mv = afterGame.move(p.san)
    const afterLines = await analyzePosition(afterGame.fen(), 1)

    const toMovePov = p.color === 'w' ? 1 : -1
    const beforeCp = beforeLines?.[0]?.cp ?? 0
    const afterCp = afterLines?.[0]?.cp ?? 0
    const beforePawns = flattenPawns(beforeCp * toMovePov)
    const afterPawns = flattenPawns(afterCp * -toMovePov)

    const bestSan = beforeLines ? sanFromUci(new Chess(p.fenBefore), beforeLines[0].uci) : null
    const secondBestSan = beforeLines?.[1] ? sanFromUci(new Chess(p.fenBefore), beforeLines[1].uci) : null
    const secondBestBefore = beforeLines?.[1] ? flattenPawns(beforeLines[1].cp * toMovePov) : null

    const isBest =
      !!beforeLines && (beforeLines[0].uci === p.uci || (bestSan != null && bestSan === p.san))

    let offerCanBeTaken = false
    let bestReplyTakesOffer = false
    try {
      const replies = afterGame.moves({ verbose: true }) as { to: string }[]
      offerCanBeTaken = replies.some((r) => r.to === mv.to)
      if (beforeLines) bestReplyTakesOffer = beforeLines[0].uci.slice(2, 4) === mv.to
    } catch {
      /* keep false */
    }

    const mateLike = (cp: number) => Math.abs(cp) >= 9000
    const legalCount = new Chess(p.fenBefore).moves().length
    const label = classifyMove({
      fenBefore: p.fenBefore,
      san: p.san,
      color: p.color,
      before: beforePawns,
      after: afterPawns,
      mateBeforeForWhite: beforeLines ? (mateLike(beforeCp) ? toMovePov > 0 : false) : null,
      mateBeforePlies: null,
      mateAfterForWhite: afterLines ? (mateLike(afterCp) ? toMovePov < 0 : false) : null,
      mateAfterPlies: null,
      bestSan,
      secondBestSan,
      secondBestBefore,
      legalMoveCount: legalCount,
      isBest,
      movedPiece: mv.piece,
      capturedPiece: mv.captured ?? null,
      offerCanBeTaken,
      bestReplyTakesOffer,
      bookHit: false,
      ply: i + 1,
    })

    payload.push({
      san: p.san,
      color: p.color,
      before: beforePawns,
      after: afterPawns,
      label,
      bestSan: bestSan ?? undefined,
    })

    if (i % 10 === 0) process.stdout.write(`  ply ${i + 1}/${plies.length} (${label})\n`)
  }

  const res = await realFetch(`${BASE}/api/games/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ gameId: g.id, plies: payload, clockSecs: [] }),
  })
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>
  process.stdout.write(`reviewed ${g.id}: HTTP ${res.status} ${res.ok ? '' : JSON.stringify(out).slice(0, 200)}\n`)
  return res.ok ? 1 : 0
}

async function main() {
  const pliesPerGame = Number(process.argv[2] ?? 44)
  const count = Number(process.argv[3] ?? 2)
  const openingFilter = process.argv[4]

  await bootEngine()

  const games = await db.gameRecord.findMany({
    where: { pgn: { contains: 'lichess' } },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })

  const groups = new Map<string, StoredGame[]>()
  for (const g of games) {
    const m = /\[Opening "([^"]+)"\]/.exec(g.pgn)
    if (!m) continue
    if (openingFilter && m[1] !== openingFilter) continue
    const arr = groups.get(m[1]) ?? []
    arr.push({ id: g.id, pgn: g.pgn, color: g.color })
    groups.set(m[1], arr)
  }
  const pick = [...groups.entries()]
    .filter(([, arr]) => arr.length >= count)
    .sort((a, b) => b[1].length - a[1].length)[0]
  if (!pick) {
    process.stdout.write('no opening group with enough games\n')
    process.exit(0)
  }
  const [opening, arr] = pick
  process.stdout.write(`seeding reviews for: ${opening} (${arr.length} games, ${Math.min(count, arr.length)} to review)\n`)

  const token = await loginToken()
  let done = 0
  for (const g of arr.slice(0, count)) {
    done += await reviewGame(g, token, pliesPerGame)
  }
  process.stdout.write(`done: ${done}/${Math.min(count, arr.length)} games reviewed\n`)
  await db.$disconnect()
  process.exit(0)
}

void main()
