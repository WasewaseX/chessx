# Worklog — Ply chess learning platform

---
Task ID: 1
Agent: main
Task: Project setup, research, dependencies

Work Log:
- Inspected scaffold: Next.js 16 + shadcn/ui + Prisma (SQLite) fresh template
- chess.com screenshots: blocked by Cloudflare bot protection (checkbox in cross-origin iframe), image-search service also down
- Used lichess.org screenshots as secondary layout reference (reference/lichess-home.png, reference/lichess-learn.png)
- Design follows chess.com's known design system: #312e2b dark sidebar, #81b64c green primary, #f7f6f5 bg, Montserrat headings, chunky CTA buttons with pressed effect, bottom mobile nav
- Installed chess.js + stockfish (stockfish 19 lite-single 1.8MB wasm -> public/engine/stockfish.js/.wasm)
- Downloaded cburnett piece SVGs from lichess GitHub -> public/pieces/ (12 files)
- Wrote Prisma schema: Profile (settings, ratings, xp, AI provider config), GameRecord, LessonProgress, PuzzleAttempt

Stage Summary:
- Brand: "Ply" — chess learning platform. Single-page app on / (client-side views), API routes for AI + persistence
- Engine: Stockfish 19 lite via Worker (public/engine), levels via UCI Skill Level
- Next: core libs (engine client, sounds, rating), board component, content schema + validator

---
Task ID: 2
Agent: main
Task: Fix build error (missing coach-view), then browser-verify and harden the whole app

Work Log:
- Build error: page.tsx imported '@/components/views/coach-view' which never existed (session died mid-write). Created src/components/views/coach-view.tsx: full-page Coach = interactive board (left) + AI chat thread (right), mobile tabbed (Board/Chat), FEN paste/reset/undo/flip/copy, quick actions (Review my last game, Quiz me, Improvement plan, Summarize position), suggestion chips, provider badge linking to Settings, retry-on-error
- Browser-verified coach chat end-to-end: found AI misread raw FEN layouts (hallucinated pawn squares, mislabeled openings). Fixed in /api/ai/chat: describeFen() now sends ASCII board + side-to-move + material count + server-computed ground-truth diff vs start position ("Black pawn on c5 (starting square was c7)"). Honesty rule added: only name an opening when certain. Verified: Sicilian FEN now correctly identified; piece-square queries correct
- Fixed mobile horizontal overflow on coach grid: implicit grid track was content-sized; added grid-cols-1 (minmax(0,1fr)) under lg breakpoint
- Found promotion picker could never be dismissed (no cancel). board.tsx: click on backdrop cancels promotion; picker panel stopPropagation. Verified via real mouse drags: a7xb8=Q completes with correct SAN, outside click cancels and keeps pawn
- Refactored board.tsx setState-in-effect violations (animMove/selection reset) to render-time adjustment pattern
- lesson-player.tsx: replaced reset-on-lessonId effect with key-based remount (page.tsx passes key={lessonId}); completion effect converted to render-time guard
- Fixed crash: /api/progress POST 500 "hintsUsed is not defined" in create block — hintsUsed: body.hintNow ? 1 : 0. Verified 200 + DB persistence + XP gain
- analysis-view.tsx: removed mount effect; one-time PGN parse via useMemo snapshot, plies/error initialized from it
- Cleaned all eslint issues: 0 errors 0 warnings
- Browser-verified: coach chat + board context, lesson steps gated + solvable (exd5 capture) + auto-save per step, analysis both modes, home, mobile (390px) no overflow, sticky footer present

Stage Summary:
- Coach view complete: position-aware chat with any model (builtin or BYO), ground-truth position encoding makes small models chess-literate
- Board interaction suite verified: drag, click-move, turn order, illegal rejection, promotion complete + cancel
- Progress pipeline: POST fixed, per-step saves, XP; key-remount resets lesson state
- All lint clean; no runtime errors in dev.log

---
Task ID: 3
Agent: main
Task: Fix "pieces don't move" bugs, wipe fake profile data (Alex/XP), make lessons interactive with movable pieces, chess.com-style polish

Work Log:
- DB had leftover test data from an earlier automated onboarding test (name "Alex", 85 XP, onboarded=true, lesson progress) — user never typed "Alex". Wiped profile/gameRecord/lessonProgress/puzzleAttempt tables so a fresh user gets real onboarding and 0 XP
- chess.com screenshots: direct browsing still blocked by Cloudflare turnstile (headless). Used image-search instead; saved chess.com lesson + game-review references to reference/cc-lessons.png, cc-p1.png. Adopted: coach avatar + speech bubble with reward chip, giant full-width green Continue, board-first lesson layout
- BUG 1 (engine, all bot contexts): engine-client.ts stored the Promise object in sfPending/sfEvalPending but onStockfishMessage CALLED it as a resolve fn -> TypeError inside worker handler -> waiter never settled -> bot stuck on "Thinking…" forever (bot pieces never move). Fixed newWaiter to return its resolve fn; assignments now store resolve; '(none)' bestmove now resolves '' instead of a 6-char string that passed length checks
- BUG 2 (puzzles view crash): new Chess('') in useMemo threw "Invalid FEN" on first render (fen state starts empty). Guarded with try/catch fallback to startpos. Also loadRated deterministically returned the same puzzle for unrated users ("Next puzzle" repeated); now picks randomly among 5 closest-rated, excluding current
- BUG 3 (visual, the real "pieces don't move"): board.tsx keyed pieces by square so every move REMOUNTED the piece element; a fresh element with an initial transform never transitions -> pieces rendered at/around their origin square instead of destination. Replaced with piece-identity tracking (exact-square reuse, then nearest same-type/color matching, max dist 6) persisted in render-phase-adjusted state; pieces now keyed by tracked id with left/top transitions — moves animate for user moves, bot replies, autoplay lines and back/forward nav
- Lessons now interactive everywhere: DemoBoard rewritten as free-exploration sandbox — scripted line autoplays once, then reader can move either side (legal-move dots included), Undo/Reset/Watch-the-line controls, overlay chip during playback. Added movableSide='any' board mode: pickup gate skips turn check, legal targets computed against a turn-swapped FEN (en-passant cleared) so demo pieces of the non-active side are draggable; DemoBoard onMove validates with the same trick
- Exercise/playout feedback upgraded to CoachBubble (coach portrait + tail bubble + praise/wrong/hint tones); static "+5 XP" chip removed as dishonest on replayed steps — replaced by real "+N XP" flash next to progress dots driven by the API's xpGain, and /api/progress now returns the profile so the sidebar XP updates live mid-lesson
- Sticky bottom action bar in lesson player (Back + full-width h-12 hero Continue, "Solve it to continue" when gated); lesson completion save moved to effect with postedDoneRef guard (lint: no side effects/refs in render)
- Generated coach character portrait (public/coach.jpg, 1024px, 45KB); wired into lesson CoachBubble, coach view header + message avatars, coach drawer header
- Honesty sweep: removed "Puzzle #640" pseudo-series from home + daily card; verified no other hardcoded names/ratings/XP — titles come from real XP, ratings null until earned, seeds explained in onboarding
- Browser-verified: onboarding fresh flow, lesson autoplay + explore drag (e4-e5, backward push correctly rejected), undo/reset, exercise capture + CoachBubble, puzzle serve/solve with rating +15, bot game e4 Nf6 Nf3 Nxe4 + resignation record, coach chat end-to-end (position-aware reply), analysis live eval (+0.29 depth 14), mobile 390px lesson with sticky CTA, no horizontal overflow
- Final DB wipe after testing (0 rows all tables); lint 0 errors 0 warnings; dev.log clean (all 200s)

Stage Summary:
- Root causes behind "pieces don't move": engine waiter never resolving (bot stuck), FEN-keyed remount killing animations, and locked demo boards — all three fixed and browser-verified
- No fake data anywhere: no Alex, no XP without doing something, no invented ratings/series numbers
- Lessons are now a sandbox: every demo board explorable with either side; coach character gives chess.com-style feedback; XP flashes only when actually granted
