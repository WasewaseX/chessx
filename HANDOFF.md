# ChessX — HANDOFF (Nov 10, 2026)

The living handoff. Read this top to bottom before touching anything.

## What ChessX is

A full-stack chess training app (Next.js 16 App Router + TypeScript + Tailwind 4 +
shadcn/ui + Prisma/SQLite + socket.io mini-services), deliberately built as "the
study, not the arcade". Owner: WasewaseX (GitHub PAT embedded in origin remote).

## Repo law (violating these costs days)

1. **Every change: lint (`bun run lint`), `bun run typecheck`,
   `bun run validate:content` for any curriculum/puzzle touch, commit + push,
   then verify IN THE BROWSER with agent-browser before claiming done.**
   Screenshots live in .zscratch/shots/ (tracked).
   typecheck has caught real shipping errors (daily-pick.ts was broken on
   master for two commits unnoticed).
2. **A parallel session may be pushing to main at any moment.** Fetch + rebase
   before push; never force-push. Conflicts on artifact files (screenshots,
   dev.stop) resolve by taking upstream's DELETION. If your working line
   collides with a parallel session's better architecture, reset to upstream
   and re-implement only what is genuinely unique (this happened twice).
3. **webpack multi-runtime constraint**: server-only modules reached from
   instrumentation/layout must not drag `node:*` into edge/client graphs
   (UnhandledSchemeError = every page 500s). The current server modules use
   static `node:fs` imports but are ONLY imported from API routes + the
   NEXT_RUNTIME-guarded instrumentation chunk. Keep that shape.
4. **Dev-mode module isolation**: a module-scoped Map in one route bundle is
   INVISIBLE to another route's bundle. Any cross-route shared truth must be
   durable (small JSON file on disk, atomic rename): see lichess-bank.ts
   served-puzzles store and daily-pick.ts served-daily.json.
5. **Unlock invariant**: level.n must equal arrayIndex+1 inside its tier
   (validate:content enforces it; unlock chains via levels[n-2]).
6. **Prisma schema**: no primitive list types; business DB is db/custom.db.
   db/puzzle-pack.json (132KB) is the puzzle truth, committed. db/served-*.json
   are runtime state, gitignored.

## Architecture map

- `src/content/tiers/*.ts` — curriculum: 6 tiers → levels → steps
  (text/demo/quiz/exercise/playout/gtm), built with src/content/kit.ts helpers.
  **151 levels** (Newbie 24 / Beginner 28 / Intermediate 29 / Advanced 25 /
  Master 23 / Grandmaster 22), graduations always LAST in a tier. Structure
  authority: How to Win at Chess (Levy Rozman) — book-derived levels inlined at
  book-correct positions (no separate book module anymore; src/content/book/
  was deleted in 157bde1). Cross-audited against Capablanca's Chess
  Fundamentals (1921) and Nimzowitsch's My System (1925) — see bg-kbn,
  adv-qvr, ms-op, gm-tempo. Quotable doctrine comes ONLY from public-domain
  works (1921/1925), always with attribution; never copy copyrighted text.
- `src/content/validate.ts` (`bun run validate:content`) — the content CI:
  replays every FEN/SAN with chess.js, enforces SAN suffix truth, mate endings,
  concept tags, n-invariant.
- `src/lib/server/lichess-bank.ts` — puzzle core: 132KB in-git pack + live
  Lichess API (daily + windows), durable served store. The 1.5GB disk bank era
  is over; do not resurrect it.
- `src/lib/server/daily-pick.ts` — THE daily-puzzle source of truth (live
  Lichess daily → pack pick → curated rotation) + the served-id registry the
  attempt route validates against.
- `src/lib/server/htwac-doctrine.ts` — the book-method doctrine lines fed into
  coach chat + in-game coach.
- `src/lib/chess/move-classification.ts` — the 12-label claim guard
  (coerceLabel = unique truth) used by game-report, drill-harvest,
  position-dossier. Coach claims must pass through it.
- `mini-services/game-service/` (port 3030, socket.io) + watchdog-child.ts —
  the ONE supervisor (loopback-fetch liveness probes, hung-kill). Do NOT add a
  second restarter.
- Boot: `.zscripts/dev.sh` (heap cap 1536MB, warm-up, mini-services).
  dev.log at repo root.

## Hard-won history (do not re-learn these)

- OOM era: next-server died at 3.3GB RSS (kernel OOM) from the 1.5GB bank +
  546MB self-heal download + boot warm-up scans. Root cause class: process
  living at the V8 heap cap. Anything heavy must stay OUT of the boot path.
- Account-loss era (Oct 20): backups died with the volume → GitHub snapshots
  every 2h (gh-snapshot.ts, token from env or origin PAT), boot-maintenance
  restores BEFORE admin-bootstrap.
- Blind-watchdog era: a watchdog that kills without a liveness probe murders
  the server mid-compile. watchdog-child.ts probes both loopbacks first.
- Daily-puzzle mismatch (fixed e0b70a1): two sources of truth for the daily id
  meant solved dailies never registered. One resolver owns it now.
- Tablebase discipline (2026-11-10, handbooks round): every endgame win/draw
  claim in lesson content is probed against the Lichess tablebase
  (tablebase.lichess.ovh) BEFORE shipping — several "obvious" teaching
  positions turned out to be draws (kings d3/d5 + Pd2 with White to move is a
  draw; the parity flip is the actual lesson). Chess.js proves legality;
  the tablebase proves the RESULT. Never assert an endgame verdict from memory.
- KBN stalemate trap: with Kf7+Nf6 fencing g8/h7, any quiet bishop move is
  stalemate. The bg-kbn drill position (bishop f8) is built around this.

## Open threads (priority order)

1. chessreps.com deep port: remaining items in docs/chessreps-arena-deep-dive.md
   (FSRS-6 + depth tiers done; see repo for the rest).
2. Play with Coach: expand in-game coaching depth (doctrine lines exist).
3. Eye Training + REA (github.com/crosstable/REA) — use the repo, do NOT
   reverse-engineer sloppily (user instruction).
4. chess.com-style sidebar UI polish.
5. Account-loss diagnosis for tiktokaltrachel@atomicmail.io (the user's real
   account; admin is a separate seeded account).
6. Google sign-in: env-gated copy already ships; wire the provider when env
   exists.

## Closed threads (verified, do not reopen without new evidence)

- **Takeback** (9749dbd): rewind + unlimited + hint interplay all verified in
  a live bot game. No code change needed; the earlier freeze fix holds.
- **chess.com import 403**: already browser-first (import-game-panel.tsx
  fetches api.chess.com from the USER's browser and posts PGNs to
  /api/import/username flow 2). The sandbox browser shares the datacenter IP,
  so a sandbox test still 403s — that is the environment, not a bug. Honest
  error copy points to the PGN paste tab.

## Verification recipe (the "done" standard)

1. `bun run lint` clean; `bun run validate:content` clean when content moved.
2. Commit + push (fetch/rebase first).
3. `agent-browser open http://127.0.0.1:3000/` → screenshot → log in (admin /
   admin1234 unless ADMIN_PASSWORD env; or sign up a throwaway) → exercise
   the exact flow you touched → screenshot each step → check dev.log tail
   for compile errors. To fast-forward lesson prerequisites, POST
   {lessonId, stepsDone, done:true} to /api/progress from the signed-in
   session (agent-browser eval fetch).
4. Report what the browser SAW, not what the build promised.
