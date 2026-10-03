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
