# ChessX Worklog

Shared work journal. Every agent: read this first, append your section after finishing.
Format: `---` header line, Task ID, Agent, Task, Work Log, Stage Summary.

---
Task ID: 1
Agent: main
Task: Restore lost user data path (tiktokaltrachel + admin accounts) and make data survive sandbox rebuilds

Work Log:
- Diagnosed: sandbox volume rebuilt Oct 19 20:43-20:46; old custom.db + db/backups/ gone. puzzles.db (1.57GB) survived/restored.
- Found tiktokaltrachel@atomicmail.io re-registered by the user at 20:54 (own password, role user). Old data unrecoverable (no prior backup existed).
- Created scripts/restore-accounts.ts — idempotent guaranteed accounts: admin@chessx.local/admin1234 (role admin) + tiktokaltrachel legacy account (only created if missing, never overwrites).
- Created src/lib/server/gh-snapshot.ts — GitHub-backed snapshots: VACUUM INTO local copy, gzip, push latest.db.gz + daily-YYYY-MM-DD.db.gz to private repo WasewaseX/chessx-backups (Contents API), rolling 7 local / 30 remote.
- Created scripts/gh-backup.ts (CLI) + scripts/gh-restore.ts (boot guard: restore from GitHub if DB empty, then restore-accounts).
- Wired dev script: bun scripts/gh-restore.ts && next dev...
- instrumentation-node.ts schedules runBackup every 2h (min 1h gap), token-gated.
- CRITICAL pattern honored: node builtins loaded via eval('require') in gh-snapshot.ts (webpack multi-runtime constraint, see bank-bootstrap.ts comment). A dynamic import('fs') broke every route with "Can't resolve 'fs'" 500s — fixed with nodeRequire.
- .env.local: GH_BACKUP_TOKEN (user PAT), GH_BACKUP_REPO. Gitignored (.env*).
- Updated git remote with the new PAT.

Stage Summary:
- Verified: backup push OK (8 KB gz snapshot on GitHub), restore-on-empty OK (scratch DB test: snapshot restored + admin created), live admin/admin1234 login 200 via API.
- tiktokaltrachel keeps the user's own password (they re-registered; correct behavior).
- From now on every session has: boot-time auto-restore + 2h rolling snapshots on GitHub.
- git remote updated to user-provided PAT.

---
---
Task ID: 2
Agent: main
Task: Chess.com-style sidebar + Play with Coach + the "render errors" fix + chessigma version check

Work Log:
- Found and fixed the user-visible breakage: /api/ai/chat had a corrupted line
  (matchesatches -> matches[matches.length-1]) that 500'd every coach chat;
  prisma client regenerated + db pushed (Profile.dnaShareToken, DnaSnapshot);
  USERNAME_MSG un-exported from the signup route (Next route export hygiene).
- Sidebar rebuilt as chess.com's two-level rail: Home / Play / Learn / Puzzles /
  Tools / More; every tab opens sub-tabs inside the rail (All tabs back row),
  deep links (#/puzzles/rush, #/play/online, #/play/bots) preselect sections;
  mobile bottom bar mirrors the groups.
- Play with Coach shipped under Learn: coach picker (4 personas), Elo slider
  400-2400 mapped to Stockfish skill/depth/blunder, color choice.
  - /api/coach-game/analyze reuses the game-review evalPlies pipeline so
    labels/evals/reasons can never drift from review surfaces
  - coach card (chess.com game-review style) with label badge, eval before ->
    after, reason, Show line arrow, Explain more
  - auto "why" chat for inaccuracy/mistake/blunder/missedwin
  - chat sidebar grounded in position dossier + trail, claim-guard extended:
    verifyClaims(text, fen, historyFens, phraseFens) - a move legal anywhere in
    the game's real history is not a hallucination; phrase checks validate
    against the pre-final board in finished games
  - CoachGame prisma table stores the full trail; recent games on the setup
    screen
- Fixed Show Line (fenBefore must be captured BEFORE applying the move).
- chessigma download page re-checked: still v1.0.2 (same artifacts we already
  fully reversed) - no Oct 18 release exists; RE report remains current.
- Verified end-to-end in the browser: login (admin/admin1234), sidebar sub-tabs,
  coach setup, live game vs Nina ~1200, e4 graded "book" with evals, coach
  replied c5, chat teaching answer, Show line arrow, mobile bottom bar.

Stage Summary:
- Commits: 0bcfd0d (render fix), 2c90297 (sidebar + coach game), 9d40530 (show line)
- All pushed to github.com/WasewaseX/chessx with the user PAT (remote updated).
- GitHub backup repo WasewaseX/chessx-backups holds latest.db.gz + daily-*

---
Task ID: 3
Agent: main (session continuation, Oct 20)
Task: Re-verify prior session work after sandbox rebuild; restore backup pipeline; browser-verify sidebar + coach game end-to-end

Work Log:
- Fast-forwarded stale local checkout to origin/main (19 commits: sidebar, coach game, durable user data, render fixes).
- Found .env.local lost in the Oct 20 sandbox rebuild (same class of event that killed custom.db on Oct 19). Recreated GH_BACKUP_TOKEN + GH_BACKUP_REPO; chmod 600.
- Fixed `bun run backup` crash: nodeRequire's eval('require') works only under webpack; plain-bun ESM threw "require is not defined". Fallback now builds require via process.getBuiltinModule('module').createRequire — no static imports, webpack constraint preserved (src/lib/server/gh-snapshot.ts).
- Manual backup pushed OK (8 KB gz); remote verified: latest.db.gz + daily-2026-10-19 + daily-2026-10-20.
- DB state: admin@chessx.local (admin) + tiktokaltrachel@atomicmail.io (user) both present, re-created by boot maintenance; legacy password chessx1234 unless LEGACY_RESTORE_PASSWORD set.
- Browser-verified end-to-end (agent-browser, screenshots in download/verify-*-1020.png): login, two-level sidebar (Learn -> Lessons/Play with Coach/Game Review/Analysis), coach setup (4 personas, Elo 400-2400 slider, color), live game vs Nina ~1200 (e4 graded "book" +0.3->+0.3 with reason + Show line + Explain more), coach replied f5 (+1.9 "?"), chat answered "why is e4 good but f5 suspicious" honestly. Zero console/page errors.

Stage Summary:
- Backup pipeline fully operational again after env restore + runtime fix; accounts guaranteed at boot.
- All user-facing features from Tasks 1-2 verified working in this sandbox, evidence screenshots saved.
- tiktokaltrachel sign-in works with chessx1234 (user's own re-registered password was lost with the rebuilt volume; honest note for the user).

---
Task ID: 4
Agent: main (session continuation, Oct 20)
Task: Diagnose and fix the stuck deployment (user: "latest deployment is oct 18")

Work Log:
- Added .github/workflows/ci.yml (install -> prisma generate/db push on scratch db -> lint -> next build) so every push is build-gated and any GitHub-connected deploy gets a real check.
- Run 1 failed: next build defaults to Turbopack in Next 16; the project's custom webpack config (memory guard + eval-require node builtins) is incompatible -> "Call retries were exceeded". Fix: build with --webpack (same flag dev uses).
- Run 2 failed: fresh installs never generate the Prisma client (no postinstall), so typecheck died on `Prisma` / `coachGame` / `dnaShareToken` / `dnaSnapshot` missing — reproduced locally (stale client in this sandbox, tsc errors identical). Fix: `prisma generate` is now the first step of the `build` script, so ANY deploy target generates before typechecking.
- Run 3 (284086e): GREEN. Repo is provably buildable from a clean checkout.

Stage Summary:
- Root cause of the stuck deployment: two build breakers introduced after Oct 18 (Turbopack default + stale-client type errors). Both fixed in-repo; CI green proves clean-checkout builds.
- Local sandbox also recovered: prisma client regenerated, `bun run typecheck` exit 0.
- The 1.57GB puzzle bank is NOT the deployment problem: it is not in git, lives on the persistent volume, and is load-bearing (rush 250-batches, woodpecker rating windows, deterministic daily history — none offered by the Lichess API).

---
Task ID: 5
Agent: main (session continuation, Oct 20)
Task: Never-stop quality loop — password change feature, move-specific coach reasons, full sidebar sweep

Work Log:
- Shipped Settings > Password: POST /api/auth/password (re-verifies current password via bcrypt, 5/10min rate limit, honest 409 for Google-only accounts, rejects no-op same-password) + Security card in settings-view.tsx. Verified end-to-end in browser: wrong-current rejected inline ("Current password is incorrect"), change works, login with new password works, reverted via API. Evidence: download/verify-password-settings-1020.png.
- Coach reasons upgraded: buildReason (game-report.ts) now composes move-specific "why" for best/excellent/good tiers — captures name the piece+square, best names development/center/castle/check, good/excellent name the engine's better move ("Playable, but Nf3 kept more of the advantage"). Verified live: exd5 shows "Takes the pawn on d5 — the engine's top choice." No more one generic sentence for every move.
- Full two-level sidebar sweep (desktop + mobile 390px): Home; Play (Online with time controls / Sparring Bots); Learn (Lessons / Play with Coach / Game Review / Analysis); Puzzles (Rated w/ live theme counts / Daily / Rush / Battle / Vision / Woodpecker); Tools (Coach Chat / Import & Records / What's New); More (Profile / Settings). Mobile bottom bar renders chess.com-style. Zero console/page errors.
- Trusted-input note: the coach board needs real (trusted) pointer events for drag-to-move; synthetic dispatchEvent storms bypass pointer-capture semantics and can leave phantom selection state. Real mice/touch are unaffected (verified via CDP trusted input).

Stage Summary:
- Commits 7d11e12 (password), 13cbb2c (coach reasons) pushed; CI green pipeline intact.
- The user can now replace the restored emergency password (chessx1234) themselves — closes the account-recovery loop.
- Coach "why" now meets the chess.com-beating bar the user asked for: honest, move-specific, names the better move.

---
Task ID: 6
Agent: main (session continuation, Oct 20)
Task: chess.com RE report items + honest port-status sync + full-surface verification round 2

Work Log:
- chess.com RE report item 4.1 DONE: chess.com monthly-archive backfill now ETag-cached (new ImportCache table, If-None-Match per platform/user/month, 304 skips the month; cache write failures never fail an import). Schema pushed additively.
- chess.com RE report item 4.3 DONE: "Works with Chess.com · Lichess" chips on the signup card (whitespace-nowrap, verified render — download/verify-signup-badges-1020.png).
- RE report statuses synced honestly: Insights (#4) and openings per-line W/D/L (#5) were already built — marked DONE; lichess ND-JSON streaming demoted to nice-to-have (max=100 already bounds memory).
- Full-surface verification round 2: Game Review on the real Opera Game (Morphy 1858) — Philidor Defence detected, 89.5%/76.4% accuracy per side, best move Nxb5 (the sacrifice) with cliff reason, turning point Nxd7?? — all historically correct (download/verify-gamereview-opera-1020.png). Free analysis board evals the pasted PGN. Coach game: Ke2 graded Inaccuracy (+0.3 -> -0.7) with move-specific reason naming Nf3 (download/verify-coach-inaccuracy-1020.png). Auto-why chat confirmed to fire for mistake/blunder/missedwin only (inaccuracy gets the card note — by design).
- False alarm investigated: apparent `eaders` syntax errors in analysis-view.tsx were terminal display mangling of `[h` sequences; python byte-read + tsc exit 0 prove the file is intact. No change made.
- CI: success on 7646ab3 (import ETag + badges); pipeline green.

Stage Summary:
- All chess.com RE report actionable items are now DONE or explicitly dispositioned; repo builds green from clean checkout; every user-facing flow verified twice this session.
- The Opera Game review result doubles as the strongest honest benchmark: real master game, historically-correct verdicts.

---
Task ID: 7
Agent: main (session continuation, Oct 20)
Task: Security & fairness card + puzzle-loop verification + mini-services recovery

Work Log:
- chess.com RE report #9 DONE: Settings > Security & fairness card publishing real behavior (rated pool is bot-free per game-service source; engine always labeled; claim-guarded coach; bcrypt/hashed sessions; rate limits). Verified render + evidence screenshot. All five claims read from source before publishing.
- System status card exposed two dead mini-services (Live games service, MCP server) — both restarted (game-service :3030, mcp-server :3031); re-run shows "responding" for every subsystem.
- Daily puzzle verified end-to-end with the real bank row (Yc77Z, 1409): hint reveals the moving piece, Bxg5 accepted, auto-reply Rhh5, Be3 completes the line -> "Solved. Rating +49", streak 1, Glicko rating seeded 849, themes + lichess source attribution shown honestly. Evidence screenshots saved.

Stage Summary:
- Every headline flow has now been verified live this session: auth (login/signup/password), two-level sidebar (6 groups, mobile+desktop), coach game (grading + move-specific reasons + chat), game review (Opera Game benchmark), free analysis, daily puzzle (real solve + rating), system status (all green).
- Commits: 6133f5c (fairness card), b1a78fa (round-2 evidence), ae0c6cc (report sync), 7646ab3 (badges nowrap), 427b10b (ETag+badges) — all pushed; CI green.
