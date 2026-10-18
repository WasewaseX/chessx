# Task 3-b — "Today's Plan" (morning-built 15-slot daily training plan)

Date: 2026-10-18 · Agent: 3-b · Status: DONE (lint clean, API smoke-tested end to end)

## What was built

A read-only, deterministically DERIVED daily plan (the chessigma loop) with **no schema
changes and no new writes**: Blunder Fix 5 (due Mistake Corrector drills, worst eval loss
first) + Blunder Shield 5 (lapsed SM-2 puzzle traps, filled from the last 7 days of failed
rated attempts) + Woodpecker 4 (sets due for a new cycle) + Daily 1. Sections shrink
honestly when data is missing; filler is never invented.

## Files created

- `src/lib/server/daily-plan.ts` — pure-ish server module:
  - `composeBlunderFix`: due drills (`mastered=false, nextDueAt<=now, bestSan!=''`) ordered
    `evalLossCp desc`; fill from highest-loss unmastered drills ignoring due date; pending
    engine-answer drills excluded (same rule as the drills queue).
  - `composeBlunderShield`: ReviewItems `kind=puzzle, lapses>0`, due-first then lapses desc;
    fill from `PuzzleAttempt(kind=rated, solved=false, last 7d)` deduped by puzzleId and
    against review picks; neutral theme labels via `humanizeTheme` (PUZZLES lookup, then
    `lichessById` for rating, else honest "missed puzzle" with no rating).
  - `composeWoodpeckerAndDaily`: sets with `lastRunAt=null` or `dayKeyLocal(lastRunAt)!==dayKey`
    (SQLite ASC puts NULL first → never-run first, then stalest), max 4; final slot is the
    daily puzzle (always present).
  - **Cache**: slot composition cached per profile in module memory for 60s (keyed by
    profileId, invalidated by dayKey change); `done` flags recomputed fresh on EVERY call.
  - **Done rules**: drill → `Drill.mastered`; shield/trap → solved `PuzzleAttempt` for that
    puzzleId today (`dayKey` match, UTC-day window fallback); woodpecker →
    `dayKeyLocal(lastRunAt)===dayKey`; daily → `Profile.dailyDoneDate===dayKey`.
- `src/app/api/plan/route.ts` — GET (auth, `?day=yyyy-mm-dd` optional, defaults to server
  `dayKeyLocal()` exactly like /api/activity; rateLimit 60/min) and POST
  `{ action:'refresh', dayKey? }` cache-bypass rebuild (originOk + rateLimit 30/min).
  Errors follow the drills-route JSON conventions (`{ error }`, 401/403/429/400/500).

## Files modified

- `src/components/views/home-view.tsx` — new `TodaysPlanCard` between the greeting/stat row
  and the five-card grid. Eyebrow "00 / Today's plan", ListChecks title, `X / 15` counter
  (only when slots exist), ghost icon-button Refresh (RotateCcw, spins while refreshing,
  POST refresh), thin honest Progress bar, three rows (Blunder Fix / Blunder Shield /
  Woodpecker & Daily) of compact chips. Done = green check + line-through (non-clickable);
  pending = clickable chip → `navigate(slot.view)`. Skeleton rows while loading (matches the
  file's existing animate-pulse pattern), error + Retry, and the honest empty line for new
  users: "Play or import a few games — your plan is built from your own misses."
  Empty sections render a muted "Nothing queued — good." state label (not a fake item).

## Plan response shape

```json
{
  "dayKey": "2026-10-18",
  "target": 15,
  "doneCount": 4,
  "sections": [
    { "key": "blunderFix", "label": "Blunder Fix", "slots": [
      { "id": "drill:cuid", "title": "Error vs pip", "detail": "Italian Game · cost about 320cp", "view": "review", "done": false } ] },
    { "key": "blunderShield", "label": "Blunder Shield", "slots": [
      { "id": "trap:cuid", "title": "Repeat · Fork", "detail": "rating 1420 · lapsed 3×", "view": "review", "done": false },
      { "id": "miss:p-id", "title": "Repeat · missed puzzle", "detail": "missed in rated", "view": "puzzles", "done": false } ] },
    { "key": "woodpecker", "label": "Woodpecker & Daily", "slots": [
      { "id": "woodpecker:setId", "title": "Woodpecker · Mate", "detail": "cycle 1 · first run", "view": "puzzles", "done": false },
      { "id": "daily:puzzle", "title": "Daily puzzle", "detail": "One rated puzzle, picked for today", "view": "puzzles", "done": true } ] }
  ]
}
```

## View switching wiring

`page.tsx` ViewRouter has no per-tab keys: woodpecker is a TAB inside the puzzles view, and
drills + the SM-2 queue both live in the review view. Mapping used: Blunder Fix and
Blunder Shield review-item slots → `view:'review'`; Blunder Shield failed-attempt fill,
Woodpecker sets, and the daily puzzle → `view:'puzzles'`. Chips call the store's
`navigate(view)` from `useApp()` (same callback home-view already uses), which sets
`location.hash` and the view state.

## Verification

- Smoke-tested against the live dev server with a throwaway account (data seeded via
  Prisma, then deleted; nothing left behind): honest empty plan → populated sections with
  correct ordering/exclusions → done flags flipped live on a cached composition (mastered
  drill, solved review attempt today, set run today, dailyDoneDate) → 401/400 guards OK.
- `bun run lint` clean. `tsc --noEmit` reports exactly one PRE-EXISTING error
  (`.next/dev/types/.../api/profile/route.ts`: `ensureRatingRow` exported from an API route,
  present in HEAD before this task) — untouched, out of scope.

## Deviations from spec

1. `buildPlan(profileId, dayKey, opts?: { refresh?: boolean })` instead of a
   `tzOffsetMinutes?` third param: the route resolves the dayKey first (client-sent local
   day via `?day=`/body, else the server's `dayKeyLocal()` convention), so a tz offset is
   redundant.
2. `view:'woodpecker'` does not exist in the app's ViewName switcher, so woodpecker slots
   map to `view:'puzzles'` (the Woodpecker tab lives there); deep-linking the tab would
   require store changes outside this task.
3. Woodpecker composition uses `dayKeyLocal(lastRunAt) !== dayKey` (server convention, UTC
   in this sandbox) — spec explicitly allowed "UTC date is fine".
4. Added the standard `rateLimit` + `originOk` guards on /api/plan to mirror
   /api/drills/route.ts (spec asked to follow its conventions).
