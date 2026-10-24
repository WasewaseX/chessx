# Chessreps.com — Reverse-Engineering Report (Opening Trainer)

Task ID: 12-a · Agent: general-purpose (chessreps RE) · Date: 2026-10-22
Target: https://www.chessreps.com/ · Method: direct fetch (no blocks encountered) + SvelteKit bundle analysis
Artifacts: /tmp/chessreps.html, /tmp/cr-*.js, /tmp/cr-chunks/*.js (135 chunks, 5.6 MB), /tmp/cr-london-inline-data.txt

Verbatim-fetched pages: `/`, `/opening/london`, `/about`, `/plans`, `/dojo`, `/leaderboards`, `/community`, `/love`, `/robots.txt`, `/sitemap.xml`, `/api/openapi.json`, `/api/health`, `/api/agent/openings`, `/api/agent/community-courses`. **No fetch failures — everything below is from primary evidence unless marked UNVERIFIED.**

---

## 1. Overview

**What it is.** Chessreps is a chess *opening repertoire trainer* ("think Duolingo for chess"). The product promise, from the meta description: *"Learn chess openings by playing them: interactive courses from titled players, drills against the moves real opponents make, and spaced repetition."* The founder (Ethan Netz) positions it as "reps" = **Rep**etitions + **Rep**ertoire: burn opening patterns in through short, game-like drills instead of reading theory.

**Tech stack.** SvelteKit (Vite) SPA with SSR payloads, Supabase as backend (`api.chessreps.com` is a Supabase instance), Stripe + PayPal subscriptions, Mux video for course intros, custom WebAudio sound engine, dicebear-style generated avatars, chessground-like custom board (`cm-chessboard` assets) with chess.js for legality. Ships iOS + Android apps; web is installable (PWA manifest). 10 locales (en/es/fr/de/tr/it/pl/el/pt/id).

**Content.** Sitemap contains **393 official opening courses** (`/opening/<slug>`) + ~900+ total courses claimed on the pricing page (including community). 57 courses from titled coaches (13 GMs, e.g. GM Mitrabha Guha's London System with 64 lines and per-position GM commentary). Players get profile pages (`/player/<name>`), a global `/leaderboards`, and a `/community` page where user-created courses are published and ranked (Hot/New/Top, coverage score, upvotes). There is a full course-creator flow (`/course-creator/new`) and a public Agent Discovery API.

**Business model.**
- 7-day free trial (no payment today) → **$34.99/year** ($2.92/mo equivalent). Older copy mentions $4.99/mo or $34.99/yr. JSON-LD `offers: {price:"0"}` "Free to start with optional premium membership".
- **Trial gating (verified in code):** an anonymous/trial user gets exactly **1 line per course** (`getIsTrial() → lines.slice(0,1)`); after completing that first line a paywall modal becomes eligible — event literally logs `trial_gate_eligible {gate_surface:"modal", presentation_mode:"deferred_until_learn_click", trigger_reason:"first_line_completed", eligible_after_completed_lines:1}`.
- Paywall covers: all lines, Drill/Time/Puzzles/Arena/Dojo modes, titled courses, community publishing. Learn mode with hints is the free hook.
- Paid course industry comparison is explicit in their about page: "Other places charge anywhere from $40 to $350 for a single course."

**Key differentiator vs ChessX's current coach-opening feature:** chessreps drills *against the moves real opponents actually play* (a game-database reply model, not just "best theory"), schedules *line reviews with FSRS*, and wraps it in seven sharply-tuned modes.

---

## 2. Training loop

### Modes (verified enum + marketing copy)
| Mode | Color (per about page) | Purpose | Hints? |
|---|---|---|---|
| **Learn** | violet | Play a line move-by-move with hints and GM/course commentary on new positions | Yes (hint reveals FROM square) |
| **Practice** | — | Repeat learned lines **without hints**; "shakiest lines first" | No |
| **Drill** | red | Streak mode: how many lines in a row; **one mistake (or hint) resets score to 0** | No (hint = reset) |
| **Time Trial** | blue | 60 s clock; complete as many lines as possible; **+floor(lineLen/2) seconds per line; clock speeds up** | No |
| **Puzzles** | green | Tactical puzzles from **real games** in that opening (batch API, Elo-targeted) | Elo-tracked |
| **Arena** | — | Play the course line vs a named bot near your Elo that picks replies **real players made at your level**; Elo K-factor update after game | No |
| **Dojo** | — | Random drills across the user's **entire enabled repertoire** (multi-course session) | Configurable |

### One drill session, step by step (from code paths `Aa→Oa/Ta`, `Da`, `fa/ma`, `ta`)
1. **Entry.** Course page SSR payload carries the full course (`lines[]`, `descriptions{fen→text}`, `positionEvals`, `depthTiers`, `starterLine`). A `starterLine` lets you start playing instantly without choosing. The trunk moves both sides play identically ("shared opening", e.g. `1. d4 d5 2. Bf4`) can be skipped via a `skipSharedOpening` per-course pref.
2. **Line pick (`te()` algorithm).** Prefer lines **started but never perfected** (completions>0 && perfectAttempts==0); else any started line; exclude the line just played; if the user has no progress at all → **random**; otherwise sort by FSRS overdue-ness `Tc = now − due` (untrained lines = `∞` → always first) and pick **random among the top-3 most overdue**. So: new→untrained→overdue→least-practiced.
3. **Play.** Player moves are checked against the **target line PGN** (branch from chess.js legal moves). Board shows last-move highlight, optional learn-arrows/hint highlights, optional eval bar. Legal-move hints, premoves (`allowPremoves`) and free-play are all supported in the board controller.
4. **Opponent reply.** In Learn/Practice/Drill/Time the opponent simply plays the target line's booked move after a **delay of 500 ms** (Learn/Practice/Arena) or **150 ms** (Drill/Time with `fastDrillMode` ON — per-course pref, default ON; else 500 ms; Puzzle: 150 ms). Completion triggers are carefully measured (`trainer_on_move_to_microtask`, `_to_next_frame` timing logs).
5. **Correct move feedback.** Random praise string from a pool of 20 ("Bingo! You got it.", "Nicely done!", "Correct! Well played." …). Sound for move/capture/check/castle/promotion/checkmate via WebAudio (SAN-derived: `x`→capture, `+`→check, `#`→checkmate, `O-O`→castle, `=`→promotion), plus `ui-tap-1..5`, `ui-button`, `line-complete.mp3`. Haptics (`impact: medium`) on mobile.
6. **Wrong move.** Board snaps back (rewind). A dialog appears: "This move differs from the course line." → then an async **wrong-move review** is fetched and shown inline ("loading → ready" states; error → "You made an incorrect move." + Try Again). The review is a **composed natural-language explanation** built from: move classification (`engine_prefers_played` / `playable_alternative` = "While fine, this course recommends {san}.", `slight_error` / `bad_move`), an optional **refutation line** (`refutation.lineLan[0]` — first move of the punishment line, verified to be a legal LAN string), **mate comparison** ("Your move still forces checkmate, though the course move does so faster."), a `playedMoveConsequence` body and a `missedReferenceIdea` body merged with de-dup logic. Every composed comment is reported via a `product-comment` analytics event carrying `classification`, `courseExplanation`, `rawGameReviewBody`, `semanticTrace`, `diagnostics`. **UNVERIFIED:** the exact server endpoint for the wrong-move review text (likely LLM-assisted server pipeline; not visible in client bundle).
7. **Hints (Learn).** `ga()`: adds current FEN to the hint set (counts once per position) and highlights the **from-square** of the booked move. In Drill mode a hint instantly zeroes the streak.
8. **Line complete (`ma`/`fa`).** Confetti (or star particles along the move trail when ALL lines are done), `line-complete` sound, then per-mode outcomes:
   - **Time:** `+floor(targetLine.length/2)` seconds added, score++, high-score clocks (daily/weekly/monthly/all-time), leaderboard submission, next line after 750 ms.
   - **Drill:** score++, streak milestones (`Lt` table), high scores, bloom animation, next line after 1000 ms.
   - **Learn:** records completion → FSRS rating; first-time events (`opening_trainer_first_line_completed` with `mistake_count`, `hint_count`, `is_perfect_run`); mode-unlock ladder: **3 completed lines → unlock Drill+Time**, **5 → unlock Puzzles+Arena** (`showUnlockedNewGameModes`).
   - **Practice:** `perfected` events; line dots update.
9. **Next line (`ta`).** `completedLines.filter(→ not seen this session)`, pick random. Loop.
10. **Exit paths.** Score sessions are server objects: `POST /api/scores {courseId, mode, learnedAllLines, tier} → {scoreId}` then `PUT` updates; leaderboards are per-course and global; progress syncs via `/api/progress` (see §4).

---

## 3. Repertoire data model

Everything below is from the actual SSR payload of `/opening/london` (node 141) and the zod schemas in chunk `D9IMJEmV.js`.

### Course (server-computed + stored)
```
Course {
  id: "cd3b1pe" (7-char nanoid-ish)
  slug, legacySlug, parentCourseId        // "-mastery" variants link back to parent
  displayName: "London System"
  description
  playerSide: "w" | "b"
  lineCount: 64
  lines: ["1. d4 d5 2. Bf4 c5 3. e3 Nc6 4. Nf3 Nf6 5. Nbd2 Qb6 6. dxc5", ...]  // space-separated SAN, one string per line
  lineNames: {linePgn → name}             // optional
  descriptions: {FEN(full, with clocks) → coach commentary}   // GM prose per position
  shortDescriptions: {FEN → short blurb}
  boardAnnotations: {FEN → [{to,from,kind:"arrow",color:"green"} | {kind:"highlight",color,square}]}
  positionEvals: {FEN(no move counters) → {type:"score"|"matein", depth, score}}  // depth up to 65 → server Stockfish
  sharedOpeningFen / sharedOpeningPgn     // trunk both sides always play: "1. d4 d5 2. Bf4"
  depthTiers: {v:1, plan:2, order:[all 64 lines in teaching order],
               tiers:[{name:"essentials",count:30},{name:"mastery",count:64}]}
  stats: {entryProb:0.5226, t1MassRel:0.9665, pluggedCount:5, residualRisk:0.0294,
          afterEntryDepth:2.308}           // repertoire-coverage analytics
  coverageScore: 2608.4
  hasPuzzles: true, puzzleCount: 5000
  introVideo (Mux) | titledAuthorName: "GM Mitrabha Guha"
  starterLine: {courseId, pgn, lineName, descriptions, boardAnnotations, positionEvals}
  computedAt, lineSetHash (sha256)         // cache-busting for review data
  seoContent: {definition, howToReach, pros[], cons[], variations[{name,san,plan}],
               playingAgainst, plans:{white,black}, history, faq[], related[slugs]}
}
```
**Depth tiers** are the pedagogical core: a course ships a teaching `order` of lines split into named tiers (`essentials` 1 / `advanced` 2 / `mastery` 3; a course may ship any subset, London has 2). The user's active tier (`at`) and a "chooser dismissed" flag (`dc`) are persisted per-course (Supabase). The line-selector and completion stats are computed **within the active tier** (tier learned / tier perfected celebrations), and tier names double as course slug variants (`/opening/london-mastery` — a `mastery` course kind whose progress merges with the parent).

**Coverage stats** (`entryProb`, `t1MassRel`, `residualRisk`, `pluggedCount`) are precomputed per course — chessreps models "how likely are you to actually reach and survive these lines in real games"; this powers the community "Coverage" sort and course cards.

### Progress (zod schema, chunk D9IMJEmV)
```
fsrsCard {
  due: datetime, stability: number, difficulty: number,
  elapsed_days, scheduled_days, learning_steps: numbers,
  reps: int>=0, lapses: int>=0,
  state: 0..3   // 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review: datetime?
}
lineProgress {
  confidence: 0..10 (default 5)          // fast UX-facing "mastery" number
  completions: int (max 1e6)
  perfectAttempts: int
  lastAttemptTimestamp: number
  fsrs: fsrsCard                          // the slow long-term scheduler
}
positionProgress { completions: int }     // per FEN
perCourseProgress {
  lines: {linePgn → lineProgress}, positions: {fen → {completions}},
  streakHighScore, timeTrialHighScore,
  allTimeStreakHighScore|allTimeTimeTrialHighScore: {score, recordedAt},
  daily|weekly|monthly Streak|TimeTrial HighScore: {score, recordedAt} (per period key),
  puzzlesElo (default 950), puzzleAttempts, playedPuzzleIds (cap 300),
  arenaElo (default 800), arenaAttempts
}
syncEnvelope { courseId, base:{course,practice}| "unknown", baseRevision:int|null,
               patch: perCourseProgress,
               clocks: {puzzlesElo, arenaElo, playedPuzzleIds} }   // lamport clocks
```
Progress is a **local-first CRDT-ish store**: every field has a merge rule (`max`, `best-score`, `best-score-per-period`, `last-writer`, or per-line merge), line winner is resolved by newest `fsrs.last_review` (tiebreak `reps`), sync outcomes are named (`merged`, `stripped-stale-practice`, `stripped-unknown-base`, `dropped-stale-course`, `unchanged`), and there are reset ops: `practice` (per line: `perfectAttempts=0, confidence=5, delete fsrs`), `high-scores`, `course` (full), and **`forget-line`** (delete one line's progress by PGN — the "right-click a line to unlearn it" UX). Timestamps are clamped against server time (skew > 2 min → offset applied; floor = 2024-12-01).

**No chapters/branches in the data model** — courses are flat line sets + shared trunk + per-position annotations. Branching is implicit: any move that diverges leaves the target line (chess.js history supports exploration/branching in the board layer with `moveBranchLength`/`mainLine` concepts in the UI state).

---

## 4. Mastery & scheduling system

**This is an FSRS shop, not SM-2/Leitner.** The full **ts-fsrs v6** library (FSRS-6, 21 weights with auto-upgrade from 17/19-length arrays) is bundled into the trainer node. Verified facts:

- Scheduler params: `request_retention` default **0.9**, `maximum_interval` 36500, `enable_fuzz` false (but fuzz bands 0.15/0.10/0.05 for intervals 2.5–7 / 7–20 / 20+ days are present in code), `enable_short_term` true, FSRS `w` weights with `[FSRS-6] auto fill w from 19 to 21` migration, forgetting curve `(1 + factor·t/stability)^decay`.
- Card states: New / Learning / Review / **Relearning**; learning steps arrays (`learning_steps`, `relearning_steps`) with minute/hour/day step strings; ratings: `Again / Hard / Good / Easy` (`[$.Again,$.Hard,$.Good,$.Easy]` frozen array used by a hidden **FSRS Debug panel** — bottom-right overlay table with pgn, state, stability, difficulty, due, overdue (∞ / ±Xm), reps, lapses, confidence, current-line flag, sorted by overdue).
- **Rating mapping from a completed line (`Cc`)** — the elegance of the whole system:
  ```
  0 mistakes && 0 hints         → Good
  ≥2 mistakes || ≥2 hints || confidence<5 → Again
  otherwise (1 mistake or 1 hint) → Hard
  ```
- **Confidence (UX number)**: `min(10, max(1, (confidence??5) − mistakes − hints))` on a normal run; `min(10, confidence+2)` on a perfect run. Default 5. Shown per line; `practice` reset sets it back to 5 and deletes the FSRS card.
- **Per-position completions** also increment for every FEN seen during the line (`positions[fen].completions++`) — powers "first time seeing this position" logic and the commentary dialog.
- **Overdue metric** `Tc(card) = now − due` (ms), untrained = `∞`. Line selection picks random among top-3 most overdue (§2).
- **Manual rating override** exists ("Cannot review/rollback a manual rating" guards + `reschedule(): due is required for manual rating` → the debug panel supports hand-setting a grade; reschedule replays the review history `reviewsOrderBy` and recomputes).
- No review queue UI in the classic sense: "due" work is folded into the mode you're in (Practice says "shakiest lines first"; Drill/Time pick overdue lines first). **UNVERIFIED:** whether a dedicated "Reviews due" home screen exists (not found in fetched pages).
- **Elo systems (parallel to FSRS):** Puzzle Elo start **950**, update `elo += K·(score−expected)`, `expected = 1/(1+10^((puzzleRating−elo)/400))`, K = `20 + 100·0.95^attempts` (decays), plus a **loss-recovery** rule: solving a puzzle later returns up to `0.3·K` of a previous loss on that puzzle (capped by the lost amount). Arena Elo start **800**, updated after each game from engine evals (win/draw/loss with a 50 cp draw window; `arena_game_completed` logs `book_exit_evaluation`).
- Mistake handling per mode: Drill → score=0, 400 ms pause, rewind to previous ply; Time → `time.emit({type:"skip"})` + penalty; Puzzle → Elo loss event; Learn → dialog + wrong-move review + retry.
- **Gamified unlock ladder:** Learn lines 1-2 freely; at **3 completed lines** unlock Drill+Time; at **5** unlock Puzzles+Arena (for logged-in free-tier users; anonymous trial gets 1 line then paywall).

---

## 5. Opponent reply variety

Two distinct systems:

1. **Course modes (Learn/Practice/Drill/Time):** opponent plays the **booked move of the selected line**. Variety comes from the line-picker algorithm (§2: random among top-3 overdue, prefer started-not-perfected) and from 64-line course trees. The shared trunk (`sharedOpeningPgn`, e.g. `1. d4 d5 2. Bf4`) is auto-played (or skipped via pref) so the drill starts at the first branching decision. If a course has no trunk, Arena picks a random line's first 9 half-moves as the trunk.
2. **Arena mode:** a **named persona bot near your Elo**. Opponent generation `H(arenaElo)`: sample `round(arenaElo + N(0,1)·60)` (Gaussian, σ=60, clamped 100..2400), then map to one of ~900 first-name personas laid evenly across 100→2400 and pick the closest within ±200 (`{name, elo}` + generated avatar). Replies are fetched from:
   - `/api/arena/explorer-replies` (batch prefetch of upcoming FENs with `elo`), then
   - `/api/arena/explorer-reply {fen, elo, caller:"arena"} → {status:"move", move, totalGames, moveGames}` — **weighted by real-game popularity at that Elo band** (a lichess-explorer-like database), with prefetch tracking (`explorer_prefetched` vs `explorer_live`), falling back to
   - `/api/arena/eval-reply` — engine reply via `/api/eval-jobs` long-poll (depth 20, multiPv 1) when the explorer has no data (rare position / out-of-book).
   After the line/game ends, the final position is evaluated server-side (`bookExitEvaluation` vs final eval), winner computed (`jc/Mc`: eval delta; if not winning for the mover and ≥ −50 cp → "draw"), Arena Elo updated with the K-factor rule, and a **game review board** opens (`reviewCompletedGame`, move-carousel + review, "Open in analysis board" → `POST /api/analysis/pgn {pgn} → {analysisUrl}` (lichess URL) opened at `?ply=N&side=w|b`).
3. **Puzzles** add third-party variety: `GET /api/puzzles/batch?course=<id>&elo=<n>&exclude=<ids>` — tactics **from real games where that opening was played**, Elo-targeted ±50 expanding search window (`G` picker), `playedPuzzleIds` (max 300) prevents repeats; `countOnly=1` variant for badges.

---

## 6. UI patterns worth copying

- **Mode = color = discipline.** Learn=violet, Drill=red ("intense red spotlight"), Time=blue, Puzzles=green. The mode switcher lives right on the trainer page; CSS classes `dot learn` / `dot practice` per line; line selector rows have `selected` / `undiscovered` (not-yet-learned lines are dimmed) states.
- **Line selector as a first-class sidebar**: per-line dots (learned / practiced), PGN shown in selector (`showPgnsInLineSelector`), name labels, tier scope, right-click-level `forget-line` reset. Practice mode literally says "the lines you're shakiest on first".
- **Commentary at the right moment**: GM prose keyed by FEN, shown on *first time seeing a position* or on mistakes — with a `learnDialogBehavior` setting: `Default` vs `Always Show` and a "Dialog Text Size" setting (5 sizes).
- **Feedback stack**: praise pool (20 variants), move-quality classification with honest wording ("While fine, this course recommends Nf3."), refutation arrows, mate-speed comparison, confetti/star particles (canvas-confetti with `shapes:["star"]`, `origin:{x:0.7,y:0.7}`), streak bloats ("bumpDrillBloom"/"bumpTimeBloom"), `line-complete` sound + haptic `impact`.
- **Speed controls**: per-course `fastDrillMode` (default ON) halves opponent delay 500→150 ms; `nextPuzzleImmediately` pref; opponent move delay 150–500 ms by mode.
- **Keyboard**: ArrowLeft/Right step, ArrowUp = jump to end, ArrowDown = start (ignored while typing in inputs); premoves supported on the board; dev hotkey Ctrl/Cmd+K auto-completes a line.
- **Streak/high-score economy**: per-course daily/weekly/monthly/all-time high scores for both Drill streak and Time score; `/leaderboards` with per-course "Your courses" + global; profile pages per player; `love` testimonials wall.
- **Settings honesty**: everything toggleable — sounds, haptics, confetti, eval bar v2, learn arrows v2, board prefs server-synced (`boardPrefs` in session payload), plus **Reset Practice Progress** and **Reset Progress** with epochs.
- **Onboarding**: intro video (Mux) with progress tracking (`course_intro_opened/cta_shown/progress/closed`), "Watch the intro" button, starter line to play instantly.
- **Serious observability**: every interaction is instrumented (`trainer_on_move`, `drill_mode_start_clicked`, `time_trial_mode_start_clicked`, `depth_tier_selected`, `opening_trainer_stalled_before_move` with a stall window + `had_first_interaction`, `cr_progress_save_failure_event_count`, fetch-error claiming to suppress noise).
- **FSRS debug overlay** for power users — transparency about the scheduler (state/stability/difficulty/due/overdue/reps/lapses/confidence per line).

---

## 7. Port list for ChessX

Ranked by impact for a chess.js + local-state Next.js app (no server needed for items 1–8):

1. **Target-line drill core with wrong-move snapback** — store each course as `lines: string[]` of space-separated SAN; on player move, compare to `line.moves[ply]`; on mismatch, rewind via `chess.undo()` (or restore FEN) and show a dialog with the expected move. (chess.js: `game.move(san)` in try/catch; keep `targetLine` + `boardMoves` arrays in React state.)
2. **Confidence + FSRS-lite per line (the Cc/Wc/Tc triple)** — per line store `{confidence, completions, perfectAttempts, fsrsCard}` in localStorage/zustand; on line end rate `Good` (0 mistakes/hints) / `Hard` (1) / `Again` (≥2) and persist `due, stability, reps, state`; port the tiny `Tc = now−due` overdue score and the **random-among-top-3-overdue** line picker verbatim (~30 lines of code).
3. **Mode quartet with distinct personalities** — Learn (hints reveal FROM square, dialog on mistake), Practice (no hints, overdue-first), Drill (streak counter, mistake or hint ⇒ score=0 + rewind), Time (60 s, `+floor(len/2)` s per line, clock speed ×(1+score·0.05) via rAF decay). All four share one trainer component; a `mode` union + delay map (`{learn:500, drill:150}`) is enough.
4. **Shared-opening auto-play + skip pref** — compute the longest common prefix of all lines (or ship `sharedOpeningPgn`), auto-play it with 300–500 ms delays, and give a per-course "skip intro moves" toggle.
5. **Opponent-reply variety from real data** — for Arena mode, weight replies by popularity: ship a small lichess-explorer lookup (free API, cacheable) keyed by FEN + rating band, fall back to a random legal reply or a Stockfish move; name the bot with a persona `{name, elo}` sampled by `elo + N(0,1)·60` and show its avatar + Elo in a match strip.
6. **Praise/feedback stack** — 20-string praise pool, quality classes (`engine_prefers_played`/`playable_alternative`/`slight_error`/`bad_move`), "While fine, this course recommends Nf3." wording, mate-speed comparison via chess.js checkmate search, canvas-confetti on line completion + star trail when all lines done, `line-complete` sound via WebAudio SAN mapping (`x`/`+`/`#`/`O-O`/`=`).
7. **Per-line progress sidebar with dots + tiers** — line selector listing every PGN, dot-learned/dot-practiced, dimmed-until-learned; ship courses with `depthTiers {order, tiers:[{name,count}]}` so beginners train "essentials" (first 30 lines) before "mastery"; celebrate `tier-learned` / `tier-perfected`.
8. **High-score economy + session score objects** — per-course daily/weekly/monthly/all-time high scores for Drill streak and Time score (zod-validated patch, merge `max` / `best-score-per-period`), a `/leaderboards` tab, and streak milestone labels.
9. **Puzzles-from-real-games per opening** — reuse ChessX's lichess puzzle bank: batch-pick by opening ECO tag ± Elo window with exclusion list (`playedPuzzleIds` cap 300), Elo K-factor with decay `K = 20+100·0.95^attempts` and the 30% loss-recovery rule.
10. **Dojo: whole-repertoire mixed sessions** — worker that merges all enabled courses' lines, drills random positions, and tracks `enabled_dojo_openings` per user; this is chessreps' killer retention feature and is pure client logic for ChessX.
11. **Local-first progress sync envelope** — adopt the `{base, baseRevision, patch, clocks}` + field-merge-rules model so progress survives devices/offline; implement `forget-line` ("unlearn this line") while you're there.
12. **Trial gate mechanic** — anonymous users get exactly 1 line per course; after the first completion show a modal *deferred until the next Learn click* (`eligible_after_completed_lines:1`, `presentation_mode:"deferred_until_learn_click"`); unlock Drill+Time at 3 completed lines and Puzzles+Arena at 5 to create the habitual ladder.

---

## 8. Evidence appendix

All from primary artifacts in `/tmp` (bundles under `/tmp/cr-chunks/`).

**Framework & infra** (from `/tmp/chessreps.html`)
- `__sveltekit_1m3i1u4 = {base, env:{PUBLIC_SUPABASE_URL:"https://api.chessreps.com", PUBLIC_SUPABASE_ANON_KEY:"eyJ...", PUBLIC_PAYPAL_CLIENT_ID:"...", PUBLIC_STRIPE_PUBLISHABLE_KEY:"pk_live_51QcdPnJXiq6bOTDhMQ...", PUBLIC_MUX_DATA_ENV_KEY:"...", PUBLIC_OPENING_ENCRYPTION_KEY:"xmgoZ/aVsGTrAbSguco/KXTW5KtKem6a", PUBLIC_SITE_URL, PUBLIC_OPENAI_ADS_PIXEL_ID}}`
- CSS bundles: `StreaksWeek.ubCvlodY.css`, `StreakToast.Drsc4WId.css`, `CourseCard.IleaaJ9k.css`, `communityCoursesStore.BEg9NoFM.css`, `ChessboardComponent.BKi7ASt9.css`, `markers.wjeiest4.css`
- robots.txt: `Disallow: /api/`, `Allow: /api/openapi.json`, `Allow: /api/agent/`, `Allow: /api/community-courses`
- `/api/openapi.json`: "Chessreps Agent Discovery API … the spaced-repetition chess opening trainer"; paths `/api/health`, `/api/agent/openings`, `/api/agent/community-courses`
- `/api/health` → `{"status":"ok","service":"chessreps","commit":"ca65a95e..."}` (server commit hash)
- JSON-LD: Organization (founder Ethan Netz), SoftwareApplication "uses spaced repetition", WebSite description

**Route map** (from sitemap, 531 unique after locale-de-dupe): `/`, `/about`, `/community`, `/contact`, `/cookie-policy`, `/dojo`, `/leaderboards`, `/love`, `/openings`, `/openings/best-for-beginners`, `/plans`, `/player/<name>`, `/opening/<slug>` ×393

**FSRS / scheduling** (`/tmp/cr-node141.js`, 234 KB trainer node; `/tmp/cr-chunks/D9IMJEmV.js`, 107 KB sync chunk)
- `function Cc(e,t,n){return e===0&&t===0?$.Good:e>=2||t>=2||n!=null&&n<5?$.Again:$.Hard}`
- `function wc(e,t){let n=e?Sc(e):fc();return xc(bc.next(n,new Date,t).card)}` — `bc=(e=>new yc(e||{}))()`
- `function Tc(e){return e?Date.now()-new Date(e.due).getTime():1/0}` — overdue score
- `dc=e=>{...request_retention:e?.request_retention||.9, maximum_interval:e?.maximum_interval||36500, w:i, enable_fuzz:e?.enable_fuzz??!1, enable_short_term:r, learning_steps:t, relearning_steps:n}`
- `[FSRS-6]auto fill w from 19 to 21 length`, `Requested retention rate should be in the range (0,1]`
- `Hs=Object.freeze([$.Again,$.Hard,$.Good,$.Easy])`; fuzz bands `Us=[{start:2.5,end:7,factor:.15},{start:7,end:20,factor:.1},{start:20,end:1/0,factor:.05}]`
- `Date.prototype.scheduler=function(e,t){return Fs(this,e,t)}` (ts-fsrs internal)
- Card states in UI: `state:r?['New','Learning','Review','Relearning'][r.state]:'No FSRS'`; debug table columns `stability, difficulty, due, overdue (∞ / +Xm / Xm), reps, lapses, confidence, isCurrentLine`
- `reschedule: due is required for manual rating`, `Cannot review a manual rating`, `Cannot rollback a manual rating`

**Mastery/confidence update** (node141)
- `e.isPerfectRun?(r.perfectAttempts++,r.confidence=Math.min(10,(r.confidence??5)+2)):r.confidence=Math.min(10,Math.max(1,(r.confidence??5)-e.mistakeCount-e.hintCount));let t=Cc(e.mistakeCount,e.hintCount);r.fsrs=wc(r.fsrs,t)`
- first completion: `e.lines[r]={completions:1,confidence:5,perfectAttempts:1,lastAttemptTimestamp:n}`
- practice reset: `e.perfectAttempts=0,e.confidence=h,delete e.fsrs` with `h=5`
- position completions: `t.positions[n]||(t.positions[n]={completions:0}),t.positions[n].completions++`

**Line picker** (node141, `te`)
- `let t=j(m).length>0?j(m):j(u)` (started-not-perfected first) → `n=t.filter(t=>t!==e)` (exclude current) → `if(!j(a)&&!j(c))return n[Math.floor(Math.random()*n.length)]` (no progress → random) → sort desc by `Tc` → `i=r.filter(Tc>0)` → `if(i.length>0){let e=Math.min(3,i.length);return i[Math.floor(Math.random()*e)]}` → `return r[0]`
- trial: `e.getIsTrial()?n.slice(0,1):n`

**Sync/merge rules** (D9IMJEmV)
- zod: `$s=ds({due:R().max(40),stability:B(),difficulty:B(),elapsed_days:B(),scheduled_days:B(),learning_steps:B(),reps:V().min(0),lapses:V().min(0),state:V().min(0).max(3),last_review:R().max(40).optional()})`
- `ec=ds({confidence:B().min(0).max(10),completions:V().max(1e6),perfectAttempts:V().max(1e6),lastAttemptTimestamp:Xs,fsrs:$s.optional()})`
- field rules: `te={lines:'lines',positions:'positions',streakHighScore:'max',...,allTimeStreakHighScore:'best-score',dailyStreakHighScore:'best-score-per-period',puzzlesElo:'last-writer',arenaElo:'last-writer',playedPuzzleIds:'last-writer'}`
- line field rules: `oe={completions:'max',perfectAttempts:'max',lastAttemptTimestamp:'max',confidence:'practice',fsrs:'practice'}`
- sync ops: `kind:'course'|'practice'|'high-scores'|'forget-line'` (`forget-line` carries `pgn`)
- line winner: newest `fsrs.last_review`, tiebreak `reps` (`Te`)
- clock-skew clamp: `Math.abs(r-n)>12e4?n-r:0` and floor `p=Date.UTC(2024,11,1)`

**Modes / timing / gamification** (node141)
- `On=v(()=>{switch(j(K)){case V.Learn:case V.Practice:case V.Arena:return 500;case V.Drill:case V.Time:return j(fi)?150:500;case V.Puzzle:return 150;...}})` with `fi` = per-course `fastDrillMode` (default `??!0`)
- Time trial: `a=60*1e3` (60 s initial, chunk `Bf8TDVUp2.js`), tick `c=s*(1+j(e)*.05)` (clock accelerates 5%/line), bonus `X.timeRemaining+=Math.floor(j(Q).length/2)*1e3`
- Drill mistake: `async function r(){i(t,0),await Sr(400),e.getChessController()?.goToPosition(e.getCurrentIndex()-1)}` + `Bn.drill.emit({type:'reset'})`
- Hint: `j(K)===V.Drill&&(Kn.score=0),Yr.add(j(U)),ri.add(j(Q)[j(mr).length].from)`
- Unlocks: `G.numCompletedLines===5?i($n,'puzzle-arena'):G.numCompletedLines===3?i($n,'drill-time')`
- Trial gate: `Ni('trial_gate_eligible',{gate_surface:'modal',presentation_mode:'deferred_until_learn_click',trigger_reason:'first_line_completed',eligible_after_completed_lines:1,...})`
- Praise pool: `['Nicely done!','Yes! That's the way!','Good solving!','Perfect! Nice work.','Great! You found the solution!','You got it! Well done.','Bingo! You got it.','Very good!','You spotted the solution. Excellent!','Correct! Well played.','Good work!','Fantastic!','Great stuff!','Yes, indeed! You got it!','Very well solved!','Smart play!','That's right! Well played!','Your eyes are sharp! Good work!','Excellent play! You solved it!','Great play!']`
- Move-quality sets: `as=new Set(['engine_prefers_played','playable_alternative'])`, `os=new Set(['slight_error','bad_move'])`; strings `bad_move`, `slight_error`, `engine_prefers_played`, `playable_alternative`, `playable_alternative`; `This move differs from the course line.`, `You made an incorrect move.`, `action:'tryAgain'`
- Wrong-move composition: `ls=e=>'This course recommends '+Br(e)`, `ds='While fine, this course recommends …'`, `mateComparison: same|faster|slower` messages, `refutation?.lineLan[0]` regex-checked `/^[a-h][1-8][a-h][1-8][qrbn]?$/`, `product-comment` analytics with `classification`, `rawGameReviewBody`, `semanticTrace`, `diagnostics`

**Arena** (node141 + chunk `dzmICnUg.js` 13.8 KB)
- personas: `var L='Kaisley.Castiel.Kylee.Wilder…'.split('.')` (~900 names) mapped `elo:Math.round(100+t/(L.length-1)*2300)`; pick `H(arenaElo)`: `a=Math.round(e+i*60)` (Gaussian σ=60) clamp `Math.max(100,Math.min(2400,a))`, filter `Math.abs(e.elo-a)<=200`, nearest
- reply flow: `Pc({fen,elo,caller:'arena'}) → /api/arena/explorer-reply`; prefetch `Fc({fens,elo,caller}) → /api/arena/explorer-replies`; fallback `Ic → /api/arena/eval-reply`; eval long-poll `/api/eval-jobs` with `depth:20,minDepth:20,multiPv:1`; reply-source analytics `explorer_prefetched|explorer_live`
- outcome: `Mc` win/draw/loss from evals (draw window −50 cp), `arena_game_completed {outcome, player_side, book_exit_evaluation…}`, Elo store default `arenaElo==…?800`, puzzle Elo default `??950`
- puzzle K: `R(e)=20+100*.95**e`; update `z(e,t,n,r){let i=R(r),a=n==='win'?1:n==='loss'?0:.5,o=1/(1+10**((t-e)/400)),s=e+i*(a-o);return Math.round(s)}`; recovery `V(e,t){let n=Math.round(R(e)*B);return Math.max(0,Math.min(n,t))}` with `B=.3`
- puzzle batch: `fetch('/api/puzzles/batch?${i}')` with `course`, `elo`, `exclude` (played ids, cap 300)

**APIs seen in client** (all fetch literals)
- node141: `/api/scores` (POST start session `{courseId,mode,learnedAllLines,tier}→{scoreId}`, PUT update), `/api/position-analysis/status`, `/api/puzzles/batch?…`, `/api/puzzles/batch?course=…&countOnly=1`, `/api/analysis/pgn` (POST `{pgn}→{analysisUrl}` lichess link)
- cr-app.js: `/api/progress`, `/api/checkout`, `/api/email-collection`, `/api/profile/delete-account`, `/api/profile/manage-membership`, `/api/client-errors`, `/api/health`
- Arena: `/api/arena/explorer-reply`, `/api/arena/explorer-replies`, `/api/arena/eval-reply`, `/api/eval-jobs`

**Sounds** (chunk `D6D11jCZ.js`): `/sounds/move.wav`, `capture.wav`, `check.wav`, `checkmate.wav`, `castle.wav`, `promotion.wav`, `ui-tap-1..5.mp3`, `ui-button.mp3`, `line-complete.mp3`; SAN→sound mapping; unlocked on first pointer/key interaction; gated by `localStorage.getItem('shouldPlaySounds')!=='false'`

**Prefs** (`dr(\`key\`)` calls in node141): `fastDrillMode`, `skipSharedOpening`, `nextPuzzleImmediately`, `hasClickedNextLine`, `learnDialogBehavior`, `shouldPlaySounds`, `shouldPlayHaptics`, `showConfetti`, `showEvalBarV2`, `showLearnArrowsV2`, `showPgnsInLineSelector`, `showUnlockedNewGameModes`

**Keyboard** (chunk `kVbeOqu92.js`): `ArrowLeft` back, `ArrowRight` forward (+override hook), `ArrowUp` last, `ArrowDown` first; skipped for INPUT/TEXTAREA; premoves `allowPremoves`; dev hotkey Ctrl/Cmd+K (node141, gated by `PUBLIC_TRAINER_DEV_HOTKEYS==='1'`)

**Depth tiers** (chunk `o-n1PtJ8.js`): labels `Essentials/Advanced/Full Mastery`, maps `{essentials:1,advanced:2,mastery:3}`, active tier persisted `{at}` + `{dc:1}` dismissed via Supabase; `b()` splits `inTier/beyond` lines

**London course SSR payload** (`/tmp/cr-london-inline-data.txt`): `lineCount:64`, `playerSide:"w"`, 64 `lines[]`, `descriptions{}` keyed by FEN with GM prose, `positionEvals{type:"score",depth:65,score:15}`, `boardAnnotations{[{to:"e3",from:"e2",kind:"arrow",color:"green"}]}`, `sharedOpeningPgn:"1. d4 d5 2. Bf4"`, `depthTiers{v:1,plan:2,order:[…64],tiers:[{name:"essentials",count:30},{name:"mastery",count:64}]}`, `stats{entryProb:.5226,t1MassRel:.9665,pluggedCount:5,residualRisk:.0294,afterEntryDepth:2.308}`, `coverageScore:2608.4`, `hasPuzzles:true,puzzleCount:5000`, `lineSetHash:"02ee84f5…"`, `computedAt:"2026-07-09…"`, `titledAuthorName:"GM Mitrabha Guha"`, `starterLine{courseId:"cd3b1pe",pgn:"1. d4 d5 2. Bf4 Nc6 3. e3 Bf5 4. c4 Nb4 5. Qa4+ c6 6. Qxb4 e5 7. Qxb7"}`, `isUserCourseTrial:true`, `seoContent{variations[{name:"Main Line",san:"1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 5. Nbd2 Nc6 6. c3",plan:"…"}],faq[],related[]}`

**Marketing copy** (about/plans pages, verbatim excerpts): "Learn Mode … creates a practice cohort. As you improve, this cohort grows from a few lines to ALL the lines"; "Drill Mode: … one mistake resets it"; "Time Trials: 60 seconds … correct answers add precious seconds, but the clock speeds up"; "Puzzles Mode: … tactical situations taken from real games where the opening you're learning was played"; "Arena gives you a bot near your rating. It plays the course line, then chooses replies real players made at your level"; "Practice brings your shakiest lines back first. Spaced repetition helps you revisit lines before you forget them"; "$34.99/year … 900+ courses, 57 from grandmasters and titled coaches"; "Publish and share your own courses"; "Dojo sessions covering your whole repertoire".

**Agent API** (fetched live): `/api/agent/openings` → `{query:"",count:10,results:[{id:uuid,name,slug,description,color:"white"|"black",url}]}`; `/api/agent/community-courses` → `{count,results:[{id,name,description,color:"w"|"b",lineCount,author,upvotes,url}]}`

### Could not verify (UNVERIFIED)
1. Server-side implementation of `/api/arena/explorer-reply` weighting (client shows the shape `{status:"move",move,totalGames,moveGames}` — popularity-weighted at Elo is the strong inference from naming + about-page copy).
2. The wrong-move review endpoint/text generation (client only shows the composed result + `product-comment` analytics with `rawGameReviewBody`/`semanticTrace`/`diagnostics` fields — an LLM-backed server pipeline is likely but not proven).
3. Exact FSRS default `w` weights array (library-internal constant not located in bundles; the library is identifiable as ts-fsrs v6 by the migration strings and API shape).
4. Whether a dedicated cross-course "due reviews" queue screen exists (not in fetched pages; scheduling is folded into mode line-pickers).
5. The native iOS/Android apps' parity with web behavior (not fetched).
6. `PUBLIC_OPENING_ENCRYPTION_KEY` consumption site (present in env payload; presumably encrypts private user-created course data before Supabase upload — not confirmed in the downloaded chunks).

## Port status addendum (2026-10-24): item 2 upgraded to the real scheduler

The original item 2 said "port an FSRS-lite". It shipped as a fixed-interval
approximation (again 5min / hard 1d / good 3+reps days, cap 21). It has now
been REPLACED by the real thing:

- Dependency: `ts-fsrs@6.0.0-beta.15` (FSRS-6.0) — the exact package version
  class chessreps inlines into their trainer bundle (see evidence above:
  request_retention 0.9, maximum_interval 36500).
- Engine: `src/lib/chess/opening-reps.ts` — `applyResult()` now runs the real
  scheduler (`scheduler.repeat(card, now)[grade].card`); grades map
  again/hard/good → Rating 1/2/3 (their mistakes+hints rule unchanged);
  short-term learning steps stay enabled (a fresh line returns in minutes,
  exactly like chessreps).
- Persistence: `LineMastery.fsrsCard` (JSON-safe Card snapshot, epoch-ms
  dates) in localStorage AND the server mirror (`OpeningProgress.fsrsCard`
  JSON column) — merge follows the LWW group (never blend two memory states).
- Migration: pre-FSRS records keep reps/lapses/confidence/bestStreak; the
  scheduler starts fresh and converges after a couple of reviews.
- Verified in browser: clean London drill → card {stability 2.307,
  difficulty 2.118, state Learning, due +10min} → PUT row in SQLite with the
  full card → localStorage wipe + reload → card restored from the server.
