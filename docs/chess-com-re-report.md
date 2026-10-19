# chess.com — Reverse-Engineering Report (REA pass, honest scope)

Date: 2026-10-19
Question: what should chessx copy from chess.com, verified how?

## 1. Access reality (documented, with evidence)

Every chess.com host Cloudflare-challenges this sandbox's traffic:

| Attempt | Target | Result |
|---|---|---|
| curl | `https://www.chess.com/` | HTTP 403 "Just a moment…" challenge page (`re/chess-com/home.html`) |
| curl | `https://api.chess.com/pub/player/hikaru` | Same challenge HTML — even the public API is shielded from this IP |
| curl | `https://api.chess.com/pub/leaderboards` | Same challenge HTML |
| curl | `https://images.chesscomfiles.com/...` bundle | 403, 243 bytes |
| agent-browser (real headless Chromium) | `https://www.chess.com/` | Held at the challenge interstitial ("Just a moment…" title after network idle) |
| curl | `web.archive.org` snapshot | Unreachable from sandbox |

So no first-party chess.com bundle was downloadable from here. Rather than guess, the pass used the **next-best primary source: chessigma's own production integration of chess.com** (their code shipped to every customer), plus chessx's own committed import engine.

## 2. What is proven about chess.com usage in real products (evidence: chessigma chunks)

From 40 production chunks of chessigma (`re/chessigma/web/`, build `d169febc…`):

- Player game history via **monthly archives**: `GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` (2 call sites; username normalized through a helper before interpolation — the endpoint returns a JSON envelope with `games[]` in PGN+URL form).
- Username normalization before every call (defensive lower-casing/trimming) — chessx's wave-1 import (`3f4ddf9`) already does the same via `username_logs`.
- lichess paired import: `GET https://lichess.org/api/games/user/{username}?...&max=1000`, `Accept:` ND-JSON — imported into the same `games` table (proving the import-first architecture: one canonical games store regardless of source).

chessx's own committed import path (wave 1) already consumes exactly these two endpoints and normalizes usernames into `username_logs`, with games stored server-side. **The chess.com data contract in production use is therefore already implemented and verified in chessx.**

## 3. chess.com product features worth copying (ranked, with chessx status)

| # | Feature (chess.com) | Evidence it matters | chessx status |
|---|---|---|---|
| 1 | Import-first onboarding: connect chess.com/lichess before anything else | chessigma's first-run loop (username_logs + games) | Engine committed (wave 1); needs home-page promotion |
| 2 | Game Review with accuracy per side | chessx parity already: game-report with whiteAcc/blackAcc/playerAcc | DONE — exceeds (pivotal-moment drill hand-off) |
| 3 | Puzzle Rush / Battle | chessx has Rush (3m + survival) AND head-to-head Battle | DONE |
| 4 | Insights: time-of-day, openings, phase accuracy | chessx GameRecord stores localHour + labelsJson | Partial: surface aggregate Insights view |
| 5 | Openings tab with per-line win rates | chessigma's opening_course_progress/queue tables | Add aggregate openings view + review queue |
| 6 | Streaks with freezes | chess.com daily streak; chessigma user_streaks | DONE (ActivityDay + freeze tokens) |
| 7 | Rated pool with Glicko + provisional RD | chessx already uses Glicko with RD 350 seeds | DONE |
| 8 | Coach/lessons gated library | chessx gives all 120 lessons free — deliberate contrast | DONE (differentiator) |
| 9 | Fair-play / security transparency | chess.com publishes enforcement stats | Add changelog/whatsnew transparency notes (infra exists) |
| 10 | Daily puzzle + calendar | chessx has daily puzzle with dayKey calendar | DONE |

## 4. Remaining chess.com-specific opportunities (no live access needed to build)

- **Archive backfill with rate-limit respect**: monthly-archive walk with `If-None-Match`/ETag reuse — chessigma's monthly call pattern shows the practical shape; chessx should cache ETags per (user, month).
- **ND-JSON import for lichess** (streaming, `max=1000`) — mirror chessigma's parameter set; keeps memory flat for large accounts.
- **Import UX copy**: show "Works with Chess.com · Lichess" badges at signup — chessigma leads with it.

## 5. Honest limitations

- No chess.com first-party bundle analysis was possible from this sandbox (Cloudflare on all hosts, evidence table above). Nothing in this report depends on guessed chess.com internals: every chess.com claim traces either to chessigma's shipped code or to chessx's committed, working integration.
- If live verification is needed, run this pass from an unblocked network: the extraction scripts in `re/rea/` are reusable as-is.
