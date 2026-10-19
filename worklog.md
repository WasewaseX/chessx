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
