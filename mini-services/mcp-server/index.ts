// ChessX MCP server — an independent mini-service exposing 7 read-only chess
// tools to any MCP client (Claude, etc.) as JSON-RPC 2.0 over HTTP. No auth.
//
//   POST /mcp   initialize | tools/list | tools/call   (JSON-RPC 2.0)
//   GET  /mcp   human-readable status + tool names
//   OPTIONS     CORS preflight
//
// Run: bun run dev (hardcoded port 3031). Through the sandbox gateway the
// endpoint is  /mcp?XTransformPort=3031  relative to the app origin.
import { Chess } from 'chess.js'
import { engine, findBinary } from './engine'
import { dailyPuzzle, puzzleBankPath } from './puzzle-bank'
import { canonicalLine, identifyEco } from './eco-table'
import { ToolError, reviewGame, reviewOnlineGames } from './game-review'
import { OPENING_GUIDES, OPENING_GUIDE_BY_SLUG } from '../../src/content/opening-guides'

const PORT = 3031 // hardcoded by design: the gateway maps ?XTransformPort=3031 here
const MAX_BODY_BYTES = 2_000_000
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const GAME_BUDGET_MS = 240_000

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (v === undefined || v === null) return dflt
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : v === undefined || v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function toolGetOpeningGuide(args: Record<string, unknown>) {
  const slug = asString(args.slug).trim()
  if (!slug) {
    return {
      count: OPENING_GUIDES.length,
      guides: OPENING_GUIDES.map((g) => ({ slug: g.slug, name: g.name, eco: g.eco, side: g.side })),
    }
  }
  const guide = OPENING_GUIDE_BY_SLUG.get(slug)
  if (!guide) {
    throw new ToolError(
      `Unknown opening guide slug "${slug}". Available slugs: ${OPENING_GUIDES.map((g) => g.slug).join(', ')}`,
    )
  }
  return { guide }
}

async function toolIdentifyOpening(args: Record<string, unknown>) {
  const pgn = asString(args.pgn)
  const moves = asString(args.moves)
  const movesList = Array.isArray(args.moves) ? args.moves.map(String) : null
  if (!pgn && !moves && !movesList) {
    throw new ToolError('Provide "pgn" (a full PGN text) or "moves" (a SAN sequence such as "e4 e5 Nf3 Nc6")')
  }
  let tokens: string[]
  if (pgn) {
    const g = new Chess()
    try {
      g.loadPgn(pgn)
    } catch {
      throw new ToolError('That PGN could not be parsed by chess.js')
    }
    tokens = g.history()
  } else if (movesList) {
    tokens = movesList.slice(0, 240)
  } else {
    tokens = moves.trim().split(/\s+/).slice(0, 240)
  }
  const line = canonicalLine(tokens)
  if (line.length === 0) {
    throw new ToolError('None of those moves could be replayed from the starting position')
  }
  const { eco, name, movesMatched } = identifyEco(line)
  return { eco, name, movesMatched, totalMoves: line.length }
}

async function toolAnalyzePosition(args: Record<string, unknown>) {
  const fen = asString(args.fen).trim()
  if (!fen) throw new ToolError('Provide a "fen" string')
  let g: Chess
  try {
    g = new Chess(fen)
  } catch {
    throw new ToolError(`Invalid FEN: ${fen.slice(0, 100)}`)
  }
  const normalized = g.fen()
  const depth = clampInt(args.depth, 6, 26, 14)
  const timeoutMs = Math.min(120_000, Math.max(30_000, 15_000 + depth * 4_000))
  const ev = await engine.analyze(normalized, depth, timeoutMs)
  return {
    fen: normalized,
    depth: ev.depth,
    bestMove: { uci: ev.bestMoveUci, san: ev.bestMoveSan },
    scoreCp: ev.scoreCp,
    mate: ev.mate,
    pvSan: ev.pvSan,
    elapsedMs: ev.elapsedMs,
    stoppedEarly: ev.stoppedEarly,
  }
}

async function toolAnalyzeGame(args: Record<string, unknown>) {
  const pgn = asString(args.pgn)
  if (!pgn.trim()) throw new ToolError('Provide a "pgn" string')
  const depth = clampInt(args.depth, 6, 14, 10)
  return reviewGame(pgn, depth, Date.now() + GAME_BUDGET_MS)
}

async function toolReviewOnlineGame(args: Record<string, unknown>) {
  const username = asString(args.username).trim()
  const source = asString(args.source).trim()
  if (!/^[A-Za-z0-9_-]{2,25}$/.test(username)) {
    throw new ToolError('Provide a "username" (2-25 characters: letters, digits, "-" or "_")')
  }
  if (source !== 'lichess' && source !== 'chesscom') {
    throw new ToolError('"source" must be "lichess" or "chesscom"')
  }
  const max = clampInt(args.max, 1, 10, 5)
  return reviewOnlineGames(source, username, max, 10, Date.now() + GAME_BUDGET_MS)
}

async function toolGetDailyPuzzle(args: Record<string, unknown>) {
  const date = asString(args.date).trim() || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ToolError(`Invalid date "${date}" — use YYYY-MM-DD`)
  }
  const puzzle = dailyPuzzle(date)
  if (!puzzle) {
    throw new ToolError('The puzzle bank (db/puzzles.db) is not readable on this host')
  }
  return { date, ...puzzle } // spoiler policy: the solution moves are never returned
}

async function toolCalculateElo(args: Record<string, unknown>) {
  const ratingA = asNumber(args.ratingA)
  const ratingB = asNumber(args.ratingB)
  if (ratingA === null || ratingB === null) {
    throw new ToolError('"ratingA" and "ratingB" must be numbers')
  }
  const kRaw = args.k === undefined ? 20 : asNumber(args.k)
  if (kRaw === null || kRaw <= 0 || kRaw > 200) {
    throw new ToolError('"k" must be a number between 0 and 200 (default 20)')
  }
  const scoreA = asNumber(args.scoreA)
  if (scoreA !== 0 && scoreA !== 0.5 && scoreA !== 1) {
    throw new ToolError('"scoreA" must be 0, 0.5 or 1 — the result for player A')
  }
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
  const deltaA = kRaw * (scoreA - expectedA)
  return {
    expectedA: round4(expectedA),
    deltaA: round2(deltaA),
    deltaB: round2(-deltaA),
    expectedB: round4(1 - expectedA),
  }
}

// ---------------------------------------------------------------------------
// Tool registry (MCP tools/list payloads)
// ---------------------------------------------------------------------------
interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_opening_guide',
    description:
      'Curated chess opening guides (18 lines with ECO code, side, main-line SAN moves, ideas, key variations and strategy notes). Without a slug: lists all guides (name, eco, side, slug). With a slug: returns the full guide.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Guide slug, e.g. "sicilian-defense". Omit to list all guides.' },
      },
    },
    handler: toolGetOpeningGuide,
  },
  {
    name: 'identify_opening',
    description:
      'Identify the chess opening (ECO code + name) from a move sequence. Replay the SAN line from the start and match the longest prefix against a compact ECO table (~130 common lines).',
    inputSchema: {
      type: 'object',
      properties: {
        pgn: { type: 'string', description: 'Full PGN text (used if present).' },
        moves: { type: 'string', description: 'SAN move sequence, e.g. "1. e4 e5 2. Nf3 Nc6 3. Bb5" (move numbers are stripped).' },
      },
    },
    handler: toolIdentifyOpening,
  },
  {
    name: 'analyze_position',
    description:
      'Analyze one FEN position with native Stockfish 19 (UCI). Returns the best move (UCI + SAN), the score in centipawns from the side-to-move POV (or mate distance) and the principal variation in SAN (up to 8 plies).',
    inputSchema: {
      type: 'object',
      properties: {
        fen: { type: 'string', description: 'The position to analyze.' },
        depth: { type: 'integer', description: 'Search depth 6-26 (default 14). Higher is slower.' },
      },
      required: ['fen'],
    },
    handler: toolAnalyzePosition,
  },
  {
    name: 'analyze_game',
    description:
      'Review a chess game from PGN: every ply is evaluated before and after the played move (Stockfish, depth 6-14) and classified as best/good/inaccuracy (70-150cp)/mistake (150-300cp)/blunder (>300cp) from the eval drop. Returns per-side error counts, the worst move, average loss per side and the full per-ply detail. Games are capped at 200 plies.',
    inputSchema: {
      type: 'object',
      properties: {
        pgn: { type: 'string', description: 'The game in PGN format.' },
        depth: { type: 'integer', description: 'Per-position search depth 6-14 (default 10).' },
      },
      required: ['pgn'],
    },
    handler: toolAnalyzeGame,
  },
  {
    name: 'review_online_game',
    description:
      'Fetch a player\'s most recent online games from lichess.org or chess.com and run the same per-ply review as analyze_game on each (depth 10). No auth. If the provider is unreachable from this host, an honest error is returned — no fake data.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'The player username on the chosen site.' },
        source: { type: 'string', enum: ['lichess', 'chesscom'], description: 'Where to fetch games from.' },
        max: { type: 'integer', description: 'How many recent games to review (1-10, default 5).' },
      },
      required: ['username', 'source'],
    },
    handler: toolReviewOnlineGame,
  },
  {
    name: 'get_daily_puzzle',
    description:
      'The deterministic daily puzzle from the app\'s 5.77M-row Lichess puzzle bank — the SAME position the ChessX app serves for that date (FNV-1a date seed, 1000-2000 rating band). Spoiler policy: the solution moves are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'UTC date "YYYY-MM-DD" (default: today).' },
      },
    },
    handler: toolGetDailyPuzzle,
  },
  {
    name: 'calculate_elo',
    description:
      'Standard Elo update: given two ratings and player A\'s result, return the expected score for both players and the rating deltas (K-factor, default 20).',
    inputSchema: {
      type: 'object',
      properties: {
        ratingA: { type: 'number', description: 'Rating of player A.' },
        ratingB: { type: 'number', description: 'Rating of player B.' },
        scoreA: { type: 'number', enum: [0, 0.5, 1], description: 'Result for player A: 1 win, 0.5 draw, 0 loss.' },
        k: { type: 'number', description: 'K-factor (default 20).' },
      },
      required: ['ratingA', 'ratingB', 'scoreA'],
    },
    handler: toolCalculateElo,
  },
]

const INSTRUCTIONS =
  'ChessX MCP server: 7 read-only chess tools — curated opening guides, opening identification (ECO), native Stockfish 19 position analysis, per-ply game review from PGN, online game review from lichess/chess.com usernames, a deterministic daily puzzle (solutions withheld), and Elo math. All tools are read-only; analysis depth is bounded and honest errors are returned when data or network access is unavailable.'

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 dispatch (MCP conventions)
// ---------------------------------------------------------------------------
interface RpcMessage {
  jsonrpc?: string
  id?: unknown
  method?: unknown
  params?: Record<string, unknown>
}

function rpcOk(id: unknown, result: unknown) {
  return { payload: { jsonrpc: '2.0', id, result }, status: 200 }
}

function rpcErr(id: unknown, code: number, message: string, status = 200) {
  return { payload: { jsonrpc: '2.0', id, error: { code, message } }, status }
}

async function dispatch(msg: RpcMessage): Promise<{ payload: unknown; status: number } | null> {
  // Notifications (no id) are acknowledged with 202 and no body.
  if (msg.id === undefined || msg.id === null) return null
  if (typeof msg.method !== 'string') {
    return rpcErr(msg.id, -32600, 'Invalid request: "method" must be a string', 400)
  }
  switch (msg.method) {
    case 'initialize':
      return rpcOk(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'chessx-mcp', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return rpcOk(msg.id, {})
    case 'tools/list':
      return rpcOk(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      })
    case 'tools/call': {
      const name = typeof msg.params?.name === 'string' ? (msg.params.name as string) : ''
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) {
        return rpcErr(
          msg.id,
          -32602,
          `Unknown tool: "${name}". Available tools: ${TOOLS.map((t) => t.name).join(', ')}`,
        )
      }
      const toolArgs =
        msg.params?.arguments && typeof msg.params.arguments === 'object' && !Array.isArray(msg.params.arguments)
          ? (msg.params.arguments as Record<string, unknown>)
          : {}
      const t0 = Date.now()
      try {
        const payload = await tool.handler(toolArgs)
        console.log(`[mcp] tools/call ${name} ok ${Date.now() - t0}ms`)
        return rpcOk(msg.id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] })
      } catch (e) {
        const message =
          e instanceof ToolError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Internal error while running the tool'
        if (!(e instanceof ToolError)) console.error(`[mcp] tools/call ${name} failed ${Date.now() - t0}ms:`, e)
        else console.log(`[mcp] tools/call ${name} error ${Date.now() - t0}ms: ${e.message}`)
        return rpcOk(msg.id, { content: [{ type: 'text', text: message }], isError: true })
      }
    }
    default:
      return rpcErr(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

// ---------------------------------------------------------------------------
// HTTP layer: CORS, per-IP rate limit, /mcp
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

function json(payload: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
  })
}

const rateBuckets = new Map<string, { n: number; start: number }>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { n: 1, start: now })
    return true
  }
  bucket.n++
  if (rateBuckets.size > 4_000) {
    for (const [key, b] of rateBuckets) {
      if (now - b.start >= RATE_WINDOW_MS) rateBuckets.delete(key)
    }
  }
  return bucket.n <= RATE_LIMIT
}

Bun.serve({
  port: PORT,
  // Long analyses keep the connection silent for minutes; allow up to 4m15s.
  idleTimeout: 255,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/mcp') {
      return json({ error: 'Not found — this server only exposes /mcp' }, 404)
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' } })
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct'
    if (!rateLimit(ip)) {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Rate limit exceeded: ${RATE_LIMIT} requests per minute per IP` } },
        429,
        { 'Retry-After': '60' },
      )
    }
    if (req.method === 'GET') {
      return json({
        status: 'ok',
        name: 'chessx-mcp',
        version: '1.0.0',
        tools: TOOLS.map((t) => t.name),
        usage:
          'POST JSON-RPC 2.0 to /mcp (XTransformPort=3031 through the app gateway): initialize -> tools/list -> tools/call.',
      })
    }
    if (req.method !== 'POST') {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use GET or POST on /mcp' } }, 405)
    }
    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large (2 MB limit)' } }, 413)
    }
    let msg: RpcMessage
    try {
      msg = JSON.parse(body) as RpcMessage
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: body is not valid JSON' } }, 400)
    }
    if (Array.isArray(msg)) {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported; send one JSON-RPC message' } },
        400,
      )
    }
    try {
      const out = await dispatch(msg)
      if (out === null) return new Response(null, { status: 202, headers: CORS_HEADERS })
      return json(out.payload, out.status)
    } catch (e) {
      console.error('[mcp] dispatch crashed:', e)
      return json({ jsonrpc: '2.0', id: (msg as RpcMessage).id ?? null, error: { code: -32603, message: 'Internal error' } }, 500)
    }
  },
})

console.log(`[mcp] chessx-mcp v1.0.0 listening on http://localhost:${PORT}/mcp (gateway: /mcp?XTransformPort=${PORT})`)
console.log(`[mcp] engine binary: ${findBinary()}`)
console.log(`[mcp] puzzle bank:   ${puzzleBankPath() ?? 'NOT FOUND (get_daily_puzzle will error honestly)'}`)
console.log(`[mcp] opening guides: ${OPENING_GUIDES.length} loaded`)
