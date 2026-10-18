# Task 3-a — Username-based bulk game import (chess.com · lichess)

Agent: Z.ai Code · Date: 2026-11-17 · Full detail in `/home/z/my-project/worklog.md`.

## Summary
Server-side username bulk import: chess.com archives API + lichess games/user
PGN export → chess.js validation → dedupe by sha1 signature (players + UTC
datetime + result + normalized SAN) → GameRecord.createMany (botLevel 0 marks
imported; ratingDelta/accuracy null). API: `POST /api/import/username`
(auth'd, 5/min/user, 22s internal deadline, honest 400/401/404/429/502/504).
Frontend: 5th "By username" tab in the import dialog (platform + months
selects, username, loading, summary/error lines); existing 4 tabs untouched.

## Files
- Created: `src/lib/server/import-games.ts`, `src/app/api/import/username/route.ts`
- Modified: `src/components/views/import-game-panel.tsx`
- Initialized (did not exist): `worklog.md`

## Verified live
lichess end-to-end import + re-import dedupe (5/5 then 0/5-skipped), 404
unknown user, 400 validation, chess.com honest 502 (Cloudflare blocks this
sandbox's datacenter IP even with UA — verified; code path correct for
non-blocked IPs). DB rows inspected field-by-field then cleaned up.
`bun run lint` clean; dev.log compiles clean.

## Gotchas for the next agent
- `detectOpening(sans: string[])` takes chess.js `history()` SAN list.
- lichess 404s return an HTML page (not JSON) — match on status, not body.
- botLevel 0 is safe: all consumers go through `botForLevel` which clamps
  1..14. Don't "fix" it to 1.
- The global client fetch hardening (src/lib/fetch-retry.ts) ladders retries
  (3.5/8/20s) on slow POSTs; dedupe makes those retries harmless.
