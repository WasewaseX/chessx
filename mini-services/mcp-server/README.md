# ChessX MCP Server

A chessigma-parity **MCP (Model Context Protocol) server** for the ChessX app: 7 **read-only** chess tools that any MCP client (Claude, etc.) can call over plain **JSON-RPC 2.0 on HTTP**. No auth, no state mutation, honest errors.

Independent bun mini-service — port **3031** (hardcoded), entry `index.ts`, auto-restarts on file change via `bun --hot`.

## Run

```bash
cd mini-services/mcp-server
bun install          # chess.js only
bun run dev          # bun --hot index.ts  (writes mcp.log)
```

The service starts with the other mini-services; verify it is alive:

```bash
curl http://localhost:3031/mcp
```

## Endpoint (through the app gateway)

The sandbox exposes only one HTTP port, so the endpoint is reached **relative to the app origin** through the gateway:

```
POST /mcp?XTransformPort=3031      # JSON-RPC 2.0: initialize | tools/list | tools/call
GET  /mcp?XTransformPort=3031      # human-readable status + tool names
OPTIONS /mcp?XTransformPort=3031   # CORS preflight (Access-Control-Allow-Origin: *)
```

Direct (inside the host): `http://localhost:3031/mcp`.

## Example session (curl)

```bash
BASE='http://localhost:81/mcp?XTransformPort=3031'   # app-origin gateway

# 1) initialize
curl -s -X POST "$BASE" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2024-11-05", "capabilities": {},
              "clientInfo": { "name": "claude", "version": "1.0" } }
}'

# 2) tools/list
curl -s -X POST "$BASE" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3) tools/call — analyze a position
curl -s -X POST "$BASE" -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params": { "name": "analyze_position",
              "arguments": { "fen": "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", "depth": 10 } }
}'

# 4) tools/call — today's daily puzzle
curl -s -X POST "$BASE" -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":4,"method":"tools/call",
  "params": { "name": "get_daily_puzzle", "arguments": {} }
}'

# 5) notifications (no id) are answered with 202 and an empty body
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

## Protocol notes

- `initialize` → `protocolVersion "2024-11-05"`, `serverInfo { name: "chessx-mcp", version: "1.0.0" }`.
- `tools/list` → all 7 tools with JSON-Schema `inputSchema`s.
- `tools/call` → `result.content = [{ type: "text", text: <pretty JSON> }]`; tool-domain failures return `result.isError: true` with an honest message (no fabricated data). Protocol failures use JSON-RPC errors: `-32700` parse, `-32600` invalid request (batches unsupported), `-32601` method not found, `-32602` unknown tool, `-32000` rate limited.
- Rate limit: **60 requests/min per IP** on `/mcp` (429 + `Retry-After`).
- Body limit 2 MB. Long analyses need silent minutes: server `idleTimeout` is 255s and analyses are serialized (one Stockfish process).

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `get_opening_guide` | `slug?` | No slug: all 18 curated guides (name/eco/side/slug). With slug: the full guide (main moves, idea, variations, strategy, strengths/weaknesses). |
| `identify_opening` | `pgn?` or `moves?` (SAN) | `{ eco, name, movesMatched, totalMoves }` — longest-prefix match against a ~130-line compact ECO table. |
| `analyze_position` | `fen`, `depth?` (6–26, default 14) | `{ fen, depth, bestMove: {uci, san}, scoreCp (side-to-move POV), mate, pvSan (≤8), elapsedMs, stoppedEarly }` — native Stockfish 19. |
| `analyze_game` | `pgn`, `depth?` (6–14, default 10) | Per-ply eval before/after each move (Stockfish); classification best/good/inaccuracy (>70cp) /mistake (>150cp) /blunder (>300cp); returns `{ plies, summary {white,black}, worstMove, averageLossCp, pliesDetail, elapsedMs }`. Games >200 plies are rejected. |
| `review_online_game` | `username`, `source: "lichess"\|"chesscom"`, `max?` (1–10, default 5) | Fetches the player's latest games (lichess game export PGN / chess.com monthly archives) and reviews each like `analyze_game`. Unreachable providers return an honest error — never fake data. |
| `get_daily_puzzle` | `date?` ("YYYY-MM-DD", default today UTC) | `{ date, id, fen, rating, themes, moveCount }` — the SAME deterministic puzzle the app serves (FNV-1a date seed, 1000–2000 band of the 5.77M-row Lichess bank). **Solution moves are never returned.** |
| `calculate_elo` | `ratingA`, `ratingB`, `scoreA (0\|0.5\|1)`, `k?` (default 20) | `{ expectedA, deltaA, deltaB, expectedB }` — standard Elo update. |

## Architecture

- `index.ts` — HTTP/JSON-RPC layer, CORS, rate limiter, tool registry.
- `engine.ts` — lazy **native Stockfish 19** singleton (`engine-native/stockfish/stockfish-linux-x86-64-universal`): UCI handshake once, kept warm, restarted on death; searches serialized by a mutex; soft timeout → `stop` + deepest completed info; hard timeout → kill + respawn on next call.
- `eco-table.ts` — the compact ECO table + canonical-line matcher (ported from the app's opening identifier).
- `game-review.ts` — per-ply review core shared by `analyze_game` and `review_online_game`, plus lichess/chess.com fetchers (12s timeouts).
- `puzzle-bank.ts` — read-only `bun:sqlite` access to `db/puzzles.db` (FNV-1a seed ported verbatim from the app).

## Honest limitations

- chess.com's API is **not reachable from this host** right now (egress-blocked) — `review_online_game(chesscom)` returns an honest error; lichess works.
- Depth is clamped (26 / 14) and games are capped at 200 plies; the whole analyze request has a ~4-minute budget, after which the result is returned with a truncation note.
- The classification is intentionally crude (single depth, mate-score conversion is approximate); per-move losses reported are capped at 1500cp.
- The daily puzzle response deliberately withholds the solution (spoiler policy).
