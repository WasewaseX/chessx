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
