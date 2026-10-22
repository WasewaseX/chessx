# ChessX Feature Inventory — Evidence-Based

Every line below is backed by a file that exists in the repo at the time of
writing (commit `9a4927a`). No guesses, no plans, no "coming soon" — if it is
not shipping here, it is not listed.

## Scale numbers (verifiable receipts)

| What | Where to verify |
| --- | --- |
| 58 API route handlers under `src/app/api/**/route.ts` | `find src/app/api -name route.ts \| wc -l` |
| 25 Prisma models | `grep -cE '^model ' prisma/schema.prisma` |
| 5,768,701 puzzles in the puzzle bank | `GET /api/puzzles/bank-status` |
| 24 view components under `src/components/views/` | `ls src/components/views/` |
| 3 mini services (`edge-proxy`, `game-service`, `mcp-server`) | `ls mini-services/` |
| 2 databases (`db/custom.db` app data, `db/puzzles.db` puzzle bank) | `ls db/` |

## API surface (58 routes, grouped)

**Auth & account (10)** — `api/auth/login`, `api/auth/signup`, `api/auth/logout`,
`api/auth/me`, `api/auth/ticket` (single-use session tickets for the desktop
shell / mini services), `api/auth/desktop`, `api/auth/google/start`,
`api/auth/google/callback`, `api/auth/google/status` (deployment probe that
lets the sign-in screen hide an unconfigured Google button),
`api/profile` (GET/PATCH).

**Games & play (6)** — `api/games` (GET history, POST result), `api/games/report`
(v2 game report: per-side label counts, cpl curves, accuracy, opening theory),
`api/engine/eval`, `api/engine/move` (Stockfish), `api/globe/live` (live games
globe), `api/activity` (daily active-minute streaks).

**Puzzles (11)** — `api/puzzles/index` (anti-spoiler pool: positions +
ratings only), `api/puzzles/move` (server-side grading — solutions never
cross the wire before the solve), `api/puzzles/reveal`, `api/puzzles/attempt`,
`api/puzzles/daily`, `api/puzzles/bank-status`, `api/puzzles/rush`,
`api/puzzles/battle` (live 1v1 puzzle battle), `api/puzzles/theme-stats`,
`api/puzzles/woodpecker` (spaced-repetition Woodpecker cycles),
`api/leaderboard` + `api/public/leaderboard`.

**Import-first pipeline (2)** — `api/import/username` (chess.com public API),
`api/import/lichess` (lichess.org API). Pulls the player's real games into
GameRecord rows; the whole coach loop is built on this data.

**Chess DNA (1)** — `api/dna` (five-domain skill report: tactics,
consistency, opening, aggression, endgame; percentile pool with honest
"pool building" state; per-domain drill deep links; daily snapshots feeding
trend sparklines — `DnaSnapshot`, max one row per UTC day).

**Daily plan (1)** — `api/plan` (GET today, POST rebuild): Blunder Fix slots
from the player's own misses, Blunder Shield from recurring traps, Woodpecker
sets, daily puzzle — sections shrink honestly when there is nothing to train.

**Coach & review (6)** — `api/review` (game review pipeline), `api/coach/artifacts`
(GET/DELETE), `api/coach/artifacts/attempt` (drill attempts),
`api/drills` (Mistake Corrector: replay-until-mastered from the player's own
blunders), `api/insights`, `api/wrapped` (year-in-review).

**AI (3)** — `api/ai/chat` (coach chat, built-in or BYO key), `api/ai/generate`,
`api/tts` (coach voice), plus `api/agent/task` + `api/agent/stream` (agentic
tasks with SSE streaming).

**Openings & tools (2)** — `api/tools/opening` (18 curated guides + trainer +
identifier), `api/tools/explorer` (community explorer), and public unauth'd
`api/public/opening/identify`, `api/public/position/eval`, `api/public/puzzles`,
`api/public/puzzles/daily`.

**Misc (5)** — `api/opponents` (opponent tracking from analyzed games),
`api/positions` (saved positions), `api/progress` (lessons),
`api/changelog` + reactions + suggestions + voting (public roadmap),
`api/vision/sprint` (board vision training).

## Mini services

- `mini-services/game-service` — real-time rated online play (socket.io;
  the web app reaches it through the gateway with `?XTransformPort=`).
- `mini-services/mcp-server` — MCP (Streamable HTTP) so external agents can
  drive puzzles/analysis.
- `mini-services/edge-proxy` — gateway edge helpers.

## Views (24)

`auth-view` (email-first sign-in; Google button only when the deployment
probe says it is configured), `home-view` (Today's Plan, Chess DNA, daily
puzzle, play, coach, lessons), `play-view` (bots + rated online + sparring
personas), `puzzles-view` (rated/daily/rush/battle/vision/woodpecker tabs,
deep-linkable `#/puzzles/<tab>`), `lessons-view` + `lesson-player` (120
lessons with interactive coaching), `coach-view` + `coach-drawer`,
`analysis-view` + `import-game-panel` (import-first analysis), `review-view`
(insights + spaced review), `profile-view` (Elo/potential, **Chess DNA skill
report with trend sparklines**, Wrapped, opponents, streak calendar, game
history), `chess-dna-card`, `wrapped-card`, `opponents-card`,
`woodpecker-view`, `rush-view`, `battle-view`, `vision-view`,
`tools-view` (Elo calculator, next-move finder, opening guide/trainer/
explorer — deep-linkable `#/tools/<tab>`), `opening-trainer`,
`opening-explorer`, `whatsnew-view`, `settings-view`.

## Honest-by-construction rules that outlive any single feature

- Server-side grading everywhere: puzzle solutions, woodpecker cycles and
  rush scoring never trust the client.
- Anti-spoiler data flow: the puzzle pool carries positions + ratings only;
  themes/titles/solutions arrive after the solve.
- A domain that cannot be measured says so ("not enough data", "pool
  building", "trend from 2nd day") — no invented numbers anywhere.
- One Elo moved only by rated games (Glicko-style math), seeded at the level
  the player picks; bot play feeds a clearly-labeled estimate instead.
- Percentiles print their pool size; trends print their measurement count.
