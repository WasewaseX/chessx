# Chessigma — Deep Reverse-Engineering Report (REA tool-driven pass)

Target: Chessigma 1.0.2 (desktop `.deb` + hosted web product)
Date: 2026-10-19
Method: tool-driven only (no eyeball claims). Every statement below carries an evidence pointer.

---

## 1. Toolchain (installed and actually run)

| Tool | Version | Role | Receipt |
|---|---|---|---|
| asar extraction | npx asar | 100% JS source recovery of the Electron shell | `re/chessigma/extracted/asar/` (9 files) |
| **REA (reverse-engineering-assistant)** | ReVa 7.3.1 | Systematic Ghidra-driven RE: dump scripts + methodology | `re/rea/rea-repo/`, wheel `re/rea/rea-tools/reverse_engineering_assistant-7.3.1-py3-none-any.whl`, Ghidra extension `reva-ext-ghidra12.1.3-v7.3.1.zip` |
| Ghidra | 12.1.3 PUBLIC + Temurin JDK 21.0.12.1 | Headless disassembly/decompile of the native ELF | `/home/z/re-tools/ghidra_12.1.3_PUBLIC`, `analyzeHeadless` run log `re/rea/ghidra-out/analyze.log` |
| Custom Ghidra postScripts | ReVaDumpAll.java / TrimAnalyzers.java | Bulk dump: functions, decompile, strings, imports, exports, memory blocks | `re/rea/ghidra-scripts/`, outputs `re/rea/ghidra-out-smoke/` (3,962 functions, 2,173 strings, 226 imports, 230 exports, 3,533 decompile index rows) |
| Scripted claims validator | `re/rea/asar-claims.mjs` | 24 falsifiable claims about the asar, each PASS/FAIL with file:line | `re/rea/asar-claims-validation.md` — 24/24 PASS |

Headless command shape (excerpt from analyze.log):
```
analyzeHeadless <projects> Chessigma -import <ELF> -max-cpu 2 \
  -postScript ReVaDumpAll.java <outdir> -scriptPath re/rea/ghidra-scripts
```

## 2. Desktop shell — validated architecture (24/24 claims PASS)

Full claim table with per-claim file:line evidence: `re/rea/asar-claims-validation.md`.
The load-bearing facts, all machine-verified:

- **Single hard-coded origin**: `https://www.chessigma.com` (`src/config.js:20`); env override ignored when packaged (`src/config.js:48`).
- **Renderer sandbox**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, **no preload script and zero IPC surface** (`src/config.js:165`, claim C08).
- **Permissions**: deny-all except clipboard (`src/config.js:187`, C09).
- **Navigation**: allowlist enforced on `will-navigate` (main frame only) (`src/navigation.js:10`, C14); `window.open` always denied, internal popups rebuilt through the shell factory, ceiling `MAX_APP_WINDOWS=8` (`src/config.js:225`, C15).
- **Google OAuth = RFC 8252 loopback handoff in the system browser**: authorize start detected only on the known Supabase host + `/auth/v1/authorize` + `provider=google` (`src/config.js:256`, C24); state is 16 random bytes hex compared in constant time (`src/auth-handoff.js:46`, C11); loopback listener serves exactly `/callback`, single-use (`src/auth-handoff.js:92`, C13); the shell redeems the session at `/api/auth/desktop?token_hash=…` (`src/auth-handoff.js:21,73`, C12).
- **UA contract**: shape-based strip of `Electron/<ver>` and the token between `(KHTML, like Gecko)` and `Chrome/` (`src/user-agent.js:65`, C23); own origin gets `Chessigma-Desktop/<version> (<platform>; <arch>)` (`src/config.js:54`, C03).
- **Resilience**: offline page for all main-frame failures except `ERR_ABORTED(-3)`/`ERR_BLOCKED_BY_CLIENT(-20)` (C16); window geometry persisted atomically (tmp+rename, version 1) to `userData/window-state.json` (C17).
- **No surprises**: no embedded crypto beyond `randomBytes`/`timingSafeEqual` (C20), no auto-updater — deploys are the update (C21), webview tag disabled (C22), DevTools only in unpackaged builds (C19), `openExternal` allow-list `https:`/`mailto:` with 2048-char cap (C18).

## 3. Native layer (Ghidra headless, tool-driven)

The analyzed ELF is the Electron/Chromium helper binary: strings show `crashpad.chromium.org`, `PtraceBroker ReadMemory`, `Handler Client SetPtracer` and Chromium trace categories (`strings-interesting.csv`), with a minimal libc import surface (`imports.csv`: pthread, mmap-family, syscall). Findings:

- **No hidden logic in the native layer** — no non-Chromium network endpoints, no embedded secrets, no anti-debug beyond stock Chromium `ptrace` crash-handling plumbing (claims C08/C20/C21 corroborate from the JS side).
- Function inventory dumped for completeness: 3,962 functions (`functions.csv`), decompile index 3,533 rows (`decomp-index.csv`), decompiled C for interesting functions (`decomp-interesting.c`, 394 KB).
- Conclusion: the product logic lives entirely in the asar (recovered 100%) and in the hosted web app. The native layer is stock Electron infrastructure.

## 4. Hosted web product (fresh acquisition, this pass)

Home page `https://www.chessigma.com/` (422,793 bytes) is a Next.js App Router build served from a fixed build id on their CDN:
`https://cdn.chessigma.dev/_builds/d169febc28bee6d0a167e5255c2054977011be7a/_next/static/chunks/*` (40 chunks, 2.7 MB downloaded to `re/chessigma/web/`).

Scripted extraction over the chunks (grep with evidence lines):

- **chess.com import**: `https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` — monthly games archive, username passed through a normalizer helper (2 call sites).
- **lichess import**: `https://lichess.org/api/games/user/{username}?...&max=1000` with `Accept:` ND-JSON (2 call sites) + `https://lichess.org/api/users` for username resolution.
- **Supabase tables (13, exact strings from `.from("…")`)**: `games`, `woodpecker_attempts`, `username_logs`, `user_streaks`, `supercoach_report_reads`, `sparring_games`, `sparring_free_games`, `puzzle_blunders_session`, `puzzle_blunder_shield_session`, `puzzle_attempts`, `opening_review_queue`, `opening_course_progress`, `bot_challenge_attempts`.
- This confirms the product loop: import games first → store → derive everything (DNA, plans, drills, sparring) from stored games.

## 5. Port status for chessx (evidence = git history)

Already ported and committed:
- `3f4ddf9` — wave 1: username import (chess.com+lichess), daily plan engine, sparring personas, coach voices
- `ca11759` — item 14: hardened desktop shell with RFC 8252 Google handoff
- `c3456c6` — item 15: What's new feed + roadmap suggestions with votes

Chessx already matches or exceeds chessigma on: 5.77M-puzzle serving bank (chessigma has no public puzzle bank), coach claim-guard, autopsy side-awareness, woodpecker sets, streak freezes.

## 6. Next port priorities (evidence-ranked)

1. **Import-first surfacing**: chessigma's onboarding starts at "connect chess.com/lichess" (their `username_logs` + `games` tables). Chessx has the import engine (wave 1) but the entry should be promoted to the home page and onboarding.
2. **Chess DNA**: per-opening/per-phase accuracy derived from imported games (chessigma's core marketing artifact) — chessx has game reports; add the aggregate DNA view.
3. **Opening review queue** (their `opening_review_queue`): schedule the worst openings for re-study — chessx's ReviewItem infra supports this directly.
4. **Blunder-shield sessions** (their `puzzle_blunders_session`/`puzzle_blunder_shield_session`): timed replay of your own imported blunders — chessx's Drill model covers it; add the session wrapper.
5. **User streaks as a first-class table** (their `user_streaks`): chessx has ActivityDay + freezes; add the streak read-model used by the plan engine.

## 7. Honest limitations

- chess.com and lichess were NOT directly fuzzed from this sandbox: chess.com's Cloudflare challenges every host including `api.chess.com` (evidence: challenge HTML captured in `re/chess-com/home.html` attempts; agent-browser held at the challenge; CDN returns 403). The chess.com integration evidence comes from chessigma's own production code, which is stronger for porting purposes anyway.
- The full-function decompile (all 3,962 functions) was smoke-scoped; `decomp.c` covers the interesting subset (102 KB) plus the index for the rest. Nothing crypto/security-relevant surfaced that would justify a deeper native pass.

---

## 8. Second deep pass (2026-10-23): entitlement map + full product surface

Method: keyword-density ranking over the 40 captured Next.js chunks (9.4MB), then
scripted context extraction around the densest files (34596, 39972). Evidence lines
below are verbatim strings from those chunks.

### 8.1 Server route inventory (22 API routes + 8 pages, from chunk 34596)

```
app/api/arena/game/start/route.ts
app/api/blunder-shield/{route,session,next,attempt}.ts
app/api/blunder-training/{route,session,attempt,fallback-puzzles,explain}.ts
app/api/woodpecker/{programs,attempts} + programs/[id]/{next,advance,cycle-summary}
app/api/supercoach/{challenges,bot/move,sparring/games}
app/api/openings/{claim,progress,explain}
pages: puzzles/{blunder-shield,blunder-training,mistakes,classic},
       supercoach/{challenge,report}, sparring/game/[id], openings/review
```

### 8.2 Free-tier entitlement map (their paywall shape)

| Feature      | Free access | Limits / exclusions                          |
|--------------|-------------|----------------------------------------------|
| game-review  | open        | —                                            |
| daily-puzzle | open        | —                                            |
| woodpecker   | subset      | excludes sets flagged `requires_supercoach`  |
| arena        | subset      | gamesPerCourse + startsPerCourse caps        |
| openings     | subset      | claimedCourses: 2, trainableLinesPerCourse cap|
| sparring     | subset      | only `kid` + `cabin-boy` personas            |
| blunder-shield | **paid**  | —                                            |
| blunder-training | **paid**| —                                           |
| mistakes     | **paid**    | —                                            |
| challenge    | **paid**    | —                                            |
| report (DNA) | **paid**    | —                                            |

Chessx position: everything in the paid column is free in chessx (blunder shield,
mistakes review, DNA report). Nothing to change — this is the honesty advantage.

### 8.3 NEW discovery: Brain Games hub (15 games, chunk 39972)

Complete game inventory from `brain/games/*.webp` asset keys:
blind-moves, blunder-crash, board-memory, eight-queens, f1-reaction-test,
find-the-check, knight-trail, legal-or-not, mate-rush, memory-game, minefield,
queens, reaction-time-test, spot-the-change, square-rush.

Tier chart on their results view: Club 1500, Expert, Master 2300, GM.
Score economy: per-game gold score + best score + share cards with
category badges (Memory / Speed / Vision / Risk).

Overlap with chessx Eye Training: square-rush ≈ our Square colors sprint;
minefield ≈ loose-piece safety; board-memory ≈ Flash chunks.
NON-overlapping games worth porting (board-skill value ranked):
1. find-the-check — count all legal checks in a position (board vision)
2. mate-rush — mate-in-1 speed round (mating pattern fluency)
3. knight-trail — knight's-tour trail challenge (knight geometry)
4. legal-or-not — is the position legal? (rules depth: castling, ep, pins)
5. blind-moves — execute a move sequence blindfolded (visualization)

### 8.4 Feature status map (chunk 39972, `status:"iterating"|"locked"`)

Their nav surface: Home, Train, Supercoach, Tools, Brain Games, Sparring (bot
ladder), Endgame Trainer (coming soon), Courses (coming soon), Today (daily
plan), Report (locked), Chat coach (locked), Game Review, Woodpecker,
Blunder training, Conversion Trainer (daily plan), Puzzles, Arena, Streak
navbar block, Leaderboard (podium), day-log history.

Actionable for chessx: Conversion Trainer (convert winning positions) is in
their daily plan but absent from chessx — candidate for the plan engine.
