# CHESSX SUCCESSOR HANDOFF — READ THIS FIRST

You are taking over the ChessX project from a predecessor AI. This document is your
complete onboarding. Everything below is verified fact, not aspiration — every claim
was proven live in the sandbox before being written here. Follow it exactly.

---

## 0. WHO YOU ARE AND HOW YOU WORK

- You are continuing a **"never stop"** mandate: keep improving ChessX autonomously,
  never ask the user questions, never stop to ask permission. Execute, verify, commit, push.
- **All user-facing output must be in English.**
- Quality bar: **extremely nitpicky**. Root causes, not symptoms. Live proof, not "should work".
- **Every change must be committed and pushed to GitHub.** The user lost data once
  (Oct 20, the lost-database incident); backups and pushes are non-negotiable.
- **Every change must be verified** server-side (curl) AND in a real browser
  (agent-browser E2E with screenshots). "It compiles" is never done.

## 1. WHAT CHESSX IS

A chess learning app (Next.js 16, App Router, TypeScript 5, Tailwind 4 + shadcn/ui,
Prisma + SQLite at `db/custom.db`, bun runtime) rendered at the `/` route as a
client-shell SPA (`src/components/shell/client-app.tsx`; the page is `force-static`
so the platform's ~2.5s health probes are cache hits). Mini services: game-service
(:3030, socket.io) and mcp-server (:3031), supervised by a platform watchdog
(`mini-services/game-service/watchdog-child.ts` — its liveness probe is `fetch()`-based;
NEVER "fix" it back to `Bun.connect`, that call signature is invalid in this bun
runtime and it blinded the watchdog once, murdering a healthy server every ~10 minutes).

## 2. THE LIGHTWEIGHT ARCHITECTURE (Nov 2 mandate — DO NOT REVERSE IT)

The user said, verbatim: *"the puzzle database is not needed, only use light apis if
possible because it's too heavy, it crashes"* and *"make the app a little more
lightweight, it keeps overloading buffering and crashing, use free apis as much as
possible"*. Executed across commits `2ae1572` + `fd8b1d2`:

- **The 1.5GB `db/puzzles.db` is RETIRED.** If you ever see it on disk again (fresh
  sandbox clones used to restore it), delete it. Never rebuild it, never download it.
- Puzzles come from:
  1. **`db/puzzle-pack.json`** — 542 curated puzzles, ~132KB, IN GIT (every rating
     band 600-2795, all 10 repertoire openings, all themes). The always-there layer.
  2. **The free Lichess puzzle API** (no key, no auth): `/api/puzzle/daily` and
     `/api/puzzle/next`.
- `src/lib/server/lichess-bank.ts` is the single puzzle core. All routes speak its
  dialect. Read its header comment before touching it — it documents the verified
  upstream contract.

### THE VERIFIED LICHESS UPSTREAM CONTRACT (probed live — do not relearn the hard way)
- Anonymous `/api/puzzle/next` returns **ONE puzzle per call** (the `number` param is
  ignored without OAuth) and **NO `fen`**. The position must be derived: replay
  `game.pgn` up to **`initialPly + 1`** plies with chess.js. (Calibrated against the
  daily, which DOES ship the real `fen`: initialPly plies lands one half-move early;
  initialPly+1 matches exactly. A prior session mis-derived this, concluded the
  convention was broken, and fell back to fen-only serving — you now know both facts.)
- The anonymous **`themes` filter is IGNORED** upstream; filter candidates locally.
- The **`opening` filter WORKS** (e.g. `opening=Sicilian_Defense`).
- **Every candidate must replay its full UCI solution** from the derived position
  before being served; unsound candidates are rejected. This is the soundness gate
  in `toLichessPuzzle` — keep it.
- Windows are small parallel batches (≤24 calls), deduped, TTL-cached 10 min,
  inflight-deduped. Rush = 5 rating bands × ≤10 calls. Daily cached 6h (negatively
  10 min on failure).

### THE CROSS-BUNDLE DEV TRAP (caught live twice — do not relearn it)
In Next.js dev, **each API route compiles as its own bundle**. A module-scoped Map in
`/api/puzzles/index` is INVISIBLE to `/api/puzzles/move`'s own module copy. Any
"truth" shared between routes must be either (a) on `globalThis`, (b) on disk
(the chosen solution: `db/served-puzzles.json`, capped 2000, atomic-rename writes),
or (c) in the database. The served store registers every puzzle dealt from the API;
`lichessById()` resolves served → pack. Proof it works: puzzle `LESo0` served by one
bundle was graded by another in 11ms (Nov 2).

### HEALTH SEMANTICS
- `lichessAvailable()` = "the pack exists" — the app always has puzzles. API failures
  degrade to the pack, then to the curated `PUZZLES` pool in the routes. Never a 500.
- The API-level 3-strikes counter (`apiDown()`) fast-paths to the pack during outages
  instead of waiting on 7s timeouts. One 429 inside a batch must NOT flip anything red.
- `/api/health/deep` exercises every subsystem for real (DB round-trip, Stockfish
  probe, live daily fetch, plan/DNA build, both mini services). Keep it honest.

## 3. CURRENT STATE (as of Nov 8, commit series `fd8b1d2 → e8dcd67`, all green)

- tsc clean, `bun run lint` (= `eslint src`) clean.
- Nov 3 re-certification (live): deep health ALL GREEN (db 31ms, Stockfish 19, daily
  live from lichess rating 1900, 556 gradable puzzles on the light source, plan/DNA
  builders, game-service + mcp via gateway); daily/opening-window/rush serving;
  coach-game save/history working; takeback freeze fixed + triple-proven in browser
  (cdffa96); coach engine-first verdicts live-proven (worklog task 8).
- E2E verified signed-in (agent-browser, admin/admin1234 — created at boot unless
  `ADMIN_PASSWORD` overrides): rated puzzles tab renders a live 1274-rated board with
  true theme-chip counts; daily 279ms; rush 3.6s cold → 7ms cached; woodpecker fork
  set built live in 319ms; deep health all green; SSR warm 51ms; dev RSS ~1.9GB
  stable (vs 3.44GB OOM in the bank era); disk freed (`db/` is 1.6MB).
- Boot: `.zscripts/dev.sh` unconditionally deletes stale `.zscripts/dev.stop` (a stale
  flag once bricked boot for 6 minutes), warms up unconditionally, then hands
  supervision to the platform watchdog. `/` is `force-static`.
- **CI GATES (Nov 8, worklog task 10)**: every push and PR runs master-ci v1.11.3
  (run_node=false — bun.lock is the dependency contract) beside the bun build job.
  Green end to end (run e8dcd67): hygiene, secrets, ai-integrity, docs, security,
  scorecard. Zero known dependency vulnerabilities (three lockfiles; upstream-pinned
  stragglers forced via package.json overrides — npm's EOVERRIDE rule requires the
  override string to equal the direct dependency spec). eslint-plugin-react-hooks is
  pinned 7.0.1 on purpose: 7.1.1 adds ~70 compiler-rule findings across core views;
  adopting them is a dedicated refactor pass. The engine binary left git on purpose;
  `gh-restore` step 4 materializes it from the chessx-backups `engine` release when
  missing. A parallel session ships book lessons (tier 7 content) — reconcile by
  content on divergence, and note origin/main was red on tsc once (fixed in 0563e95).

## 4. THE BACKLOG — FULLY CLOSED as of Nov 3 (all ten items landed + live-proven; keep as regression context, do NOT redo them)

1. **Coach intelligence ("ai still so stupid")** — CLOSED (ab21400, worklog task 8).
   The coach consults the engine + `src/lib/server/move-classification.ts` (12-label
   truth) BEFORE speaking; the first answer IS the engine's answer; the claim guard
   verifies best-move claims against the structured dossier and repairs in one pass
   (flip-flop structurally impossible); the POV-inversion bug (opponent-POV eval read
   Qxf7?? as +9 "excellent") is fixed. LIVE-PROVEN: start position -> "e4 is the
   move"; Scholar's mate asked twice -> identical "Qxf7# is the move".
2. **Takeback freeze ("i used take back but i cant move now")** — CLOSED (cdffa96,
   worklog task 9). Four strands rooted out: no-timeout engine fetch (20s abort now),
   un-hangable wasm fallback (10s race), a driver effect that never re-armed after a
   failed attempt (bounded retry + AUTO-TAKEBACK self-heal after the second failure),
   and a takeback that refused to run off-turn/mid-think (now the universal recovery
   hatch with a generation token so stale replies are discarded, never ghost-applied).
   E2E-proven in a real browser: golden path, total engine outage (all paths blocked
   via network interception -> self-heal -> healthy recovery), and mid-think cancel
   vs the depth-20 bot (no ghost move).
3. **Unlimited takebacks + hints** — CLOSED. No quota exists in Play or coach games;
   the takeback button is enabled whenever any player move exists (even mid-think);
   the hint arrow is unlimited.
4. **chess.com import 403** — CLOSED. The panel is browser-first (the user's own
   browser fetches chess.com; the server only stores), the PGN-paste path is FIRST in
   the Game review tab, and server-side bulk honestly 403s with pointer copy from
   datacenter IPs. Paste path E2E-proven (Opera Game -> Philidor Defence detected).
5. **Opening Training (chessreps.com port)** — CLOSED by prior sessions: FSRS-6
   scheduler (0110bd0), depth tiers (4a45d0f), durable progress sync + forget-line
   (f9a795c), per-course high-score economy (4a949bc). Reference: `docs/chessreps-*.md`.
6. **Play with Coach** — CLOSED (coach-game-view.tsx: coach Elo choice, per-move
   badges, honest chat; its chat route shares the hardened claim guard).
7. **Eye Training** — CLOSED. `eye-training-view.tsx` feeds from `/api/puzzles/index`
   (the light pack) via `fetchPuzzleIndex`; bests recorded by `/api/vision/sprint`.
8. **chess.com-style sidebar** — CLOSED (Home/Play/Learn/Puzzles/Tools/More, each
   with sub-tabs, verified across sessions with screenshots).
9. **Account recovery** — CLOSED (worklog task 4). tiktokaltrachel@atomicmail.io was
   NEVER lost (transient empty-db window / wrong password); password is chessx1234;
   sign-in proven. Boot order: restore-from-snapshot BEFORE admin bootstrap.
10. **Deepen REA-based reverse engineering** — ONGOING by nature (see §4b for the
    standing targets). REA 7.3.1 (ReVa) + REA 6.7.0 both in `re/rea/`; chessigma asar
    claims 24/24 validated (`re/rea/asar-claims-validation.md`); the chessigma port
    deltas from `docs/chessigma-re-report-v2.md` §4 are all shipped (games library,
    clock+conversion DNA domains, DNA share link, Elo calculator, coach quota).

## 4b. WHAT TO DO NEXT (open-ended, in the never-stop spirit)

- Keep the hard-won invariants green on every pass: `bunx tsc --noEmit`, `bun run lint`,
  curl the touched routes, agent-browser E2E with screenshots, dev.log tail, commit+push.
  CI now runs the master-ci gates on every push — a red run on GitHub is a bug to fix
  at the root the same hour, not an advisory to ignore.
- AI-integrity ratchet: the gate is advisory by template design, but the tree already
  meets the blocking bar (first-party blocking findings 0, score 23/100 grade B).
  When the slop-score deficit drops below 30 (split the giant view files or prune
  the deficit), flip `fail_on_ai_slop: true` in ci.yml and set
  `ai_slop_max_deficit` to the measured value; a new coach failure mode in the
  wild still goes through the claim-guard first.
- Adopt eslint-plugin-react-hooks 7.1.1's compiler rules (~70 findings across core
  views: ref access during render, setState-in-effect) as a dedicated refactor pass;
  the 7.0.1 pin in package.json overrides is a deliberate, documented hold, not debt
  to forget.
- REA: any new competitive surface the user asks about should go through REA (ReVa)
  first, never ad-hoc grepping.
- Watch the 4GB box: RSS baseline ~1.4-1.9GB dev; if puzzles.db ever reappears on disk,
  DELETE it (the lightweight mandate is final). The sandbox auto-committer runs
  `git add -A` with UUID commit messages — every platform tree (skills/, engine-native/,
  re/, download/, research/) is gitignored now, so it cannot resurrect them; never
  un-ignore those paths.

## 5. OPERATING PROCEDURES

- **Dev server**: already running (`bun run dev`, port 3000, logs in `dev.log` —
  read the TAIL only). Never `bun run build`. Never bind other ports; mini services
  live in `mini-services/` with their own ports and are reached through the Caddy
  gateway using `?XTransformPort=<port>` query params — NEVER absolute URLs/ports in
  frontend fetches; websocket path is always `io("/?XTransformPort=<port>")`.
- **Verify loop**: `bunx tsc --noEmit` → `bun run lint` → `curl` the route(s) →
  agent-browser open/snapshot/click/screenshot → read `dev.log` tail for runtime
  errors → commit + push with a message that explains WHY.
- **GitHub**: remote `origin` = `https://github.com/WasewaseX/chessx.git`. A PAT is
  embedded in the origin remote and falls back through `gh-snapshot.ts`; scheduled
  DB snapshots run every 2h via instrumentation (`boot-maintenance` must restore
  before `admin-bootstrap`). If git complains about diverged history: the sandbox
  clones can roll back the local branch — `git fetch`, compare with `origin/main`,
  and re-apply deltas on top (this happened twice already; the disk often holds the
  newer tree while git holds the older one — resolve by content, not by memory).
- **Database**: `db/custom.db` via `import { db } from '@/lib/db'`; schema in
  `prisma/schema.prisma`; push with `bun run db:push`. SQLite WAL is already enabled.
- **UI rules**: shadcn/ui components only (`src/components/ui`), no indigo/blue,
  mobile-first responsive, sticky footer (`min-h-screen flex flex-col` + `mt-auto`),
  loading/error states everywhere, `max-h-96 overflow-y-auto` for long lists.
- **AI skills**: z-ai-web-dev-sdk is backend-only. Available: LLM (chat), VLM
  (image understanding), image generation, TTS, ASR, web search, web reader.

## 6. LANDMINES (things that will bite you — allbit me or a predecessor before)

1. `Bun.connect({hostname, port})` — invalid signature in this runtime; blinds the
   watchdog. Use `fetch()` probes.
2. Webpack + static `node:*` imports in shared graphs → UnhandledSchemeError, every
   page 500s. Node builtins go behind lazy `eval('require')` in server-only modules.
3. `chmod -R 755` at boot flips git modes → `git config core.fileMode false` is set;
   keep it.
4. Root-owned dirs (`research/`, some `skills/*`) — unreadable to you; eslint ignores
   `research/`; never `git add` the platform skills tree (untracked on purpose).
5. The platform watchdog kills servers unresponsive for 600s and respawns them;
   during boot, warm-up must be unconditional or the first visitor hits a cold shell.
6. 4GB box: pip parallel installs can OOM-kill next-server; the 1.5GB bank era is
   over — do not reintroduce heavy disk or heavy downloads at boot.
7. Lichess is a free shared resource: keep batches small, caches hot, UA honest
   (`chessx-app (puzzle feed; lightweight client)`). Never loop-fetch without dedup.

## 7. THE DOCTRINE

Root causes over symptoms. Live proof over assumption. Honest degradation over fake
data (count 0 renders as "unknown", never fabricated). The user is a learner, not a
wallet: takebacks and hints are free. The app must stay LIGHT: no multi-GB anything,
no boot-time downloads, bounded memory, cached upstream calls. When in doubt, make
it smaller, make it honest, verify in the browser, push to GitHub, and continue —
never stop.
