# Task 4-a — What's new (changelog + suggestion/voting pipeline)

Task ID: 4-a · Agent: whatsnew (full-stack-developer) · Date: 2026-10-18
Port-list item 15 from the chessigma RE report (section 4). All prior context read from worklog.md (Tasks 1, 2, 2-b, 3-a…3-d).

## What shipped

A fully server-backed "What's new" feature: an admin-published changelog feed with per-entry emoji reactions (auth optional, anonymous supported), plus a public feature-suggestion board ("Roadmap & ideas") with status tabs, one-vote-per-profile toggling, and an honest 3-open-suggestions cap.

## Files created

| File | Purpose |
| --- | --- |
| `src/lib/server/whatsnew.ts` | Shared server pieces: `REACTION_EMOJIS` (🎉 ❤️ 🧠 🐸), `anonVoterKey` (sha256(ip + `CHANGELOG_REACTION_SALT` env, fixed fallback)), `reactionVoterKey`, groupBy count helpers, `publicEntry`/`publicSuggestion` DTOs, `SUGGESTION_STATUSES`, `STATUS_RANK` |
| `src/app/api/changelog/route.ts` | GET feed (public), POST entry (admin only) |
| `src/app/api/changelog/react/route.ts` | POST reaction toggle (auth optional) |
| `src/app/api/changelog/suggestions/route.ts` | GET board (public), POST suggestion (auth) |
| `src/app/api/changelog/vote/route.ts` | POST vote toggle (auth) |
| `src/components/views/whatsnew-view.tsx` | The view |

## Files modified

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | 4 new models (below) |
| `src/lib/store.ts` | `'whatsnew'` added to `ViewName` union + hash-validation list |
| `src/app/page.tsx` | `WhatsNewView` dynamic chunk + `case 'whatsnew'` in ViewRouter |
| `src/components/shell/app-chrome.tsx` | Nav entry "What's new" with `Sparkles` icon, Account section between Tools and Settings |
| `worklog.md` | Appended Task 4-a entry |

## Schema (bun run db:push succeeded; client regenerated)

- **ChangelogEntry**: id cuid, title, body, tag (default "update"), version?, pinned (default false), createdAt; `reactions ChangelogReaction[]`; `@@index([createdAt])`
- **ChangelogReaction**: entryId FK → ChangelogEntry (Cascade), voterKey, emoji (default 🎉), createdAt; `@@unique([entryId, voterKey])`
- **FeatureSuggestion**: profileId? (plain string, no FK — deletion-safe), authorName (default "Player"), title, detail, status (default "open"), votes (default 0), createdAt; `suggestionVotes SuggestionVote[]`; `@@index([status, votes])`
- **SuggestionVote**: suggestionId FK → FeatureSuggestion (Cascade), voterKey, createdAt; `@@unique([suggestionId, voterKey])`

## API shapes

### GET /api/changelog (public, 60/min per viewerKey)
```json
{ "entries": [ { "id", "title", "body", "tag": "update|feature|fix|benchmark", "version": string|null,
  "pinned": bool, "createdAt": ISO, "reactions": {"🎉":n,"❤️":n,"🧠":n,"🐸":n}, "mine": ["🎉"] } ] }
```
Order: pinned desc, then createdAt desc; take 20. Empty list when nothing exists (no fake content). `mine` = viewer's own emojis (extra field beyond spec, needed to style active reaction buttons; anonymous viewers get it via the ip-hash key too).

### POST /api/changelog (originOk → 401 unauth → **403 non-admin** → 10/min → validation)
Body `{ title (4-120), body (4-4000), tag?, version? (≤24), pinned? }` → 201 `{ entry }`; unknown tag → 400.

### POST /api/changelog/react (originOk, 30/min per voterKey, auth optional)
Body `{ entryId, emoji ∈ 🎉❤️🧠🐸 }`. voterKey = `userId` when signed in, else sha256(ip+salt). Toggle: same emoji → delete; different emoji on existing row → **switch in place** (the `@@unique([entryId, voterKey])` allows exactly one row); none → create (P2002 race tolerated). Returns `{ reactions: {…}, mine: [...] }`. 404 unknown entry, 400 bad emoji.

### GET /api/changelog/suggestions[?status=] (public, 60/min)
```json
{ "suggestions": [ { "id", "title", "detail", "status", "votes", "authorName", "createdAt", "viewerVoted" } ] }
```
Declined excluded. Order: status ladder (in_progress → planned → open → shipped), then votes desc, then newest. Take 30. `viewerVoted` computed at read time (profile-id key when signed in, else false).

### POST /api/changelog/suggestions (originOk → **401 unauth** → 5/min per profile)
Body `{ title (8-90), detail (10-500) }` → 201 `{ suggestion }` with `votes: 1`, `viewerVoted: true`; created in a transaction with the author's own SuggestionVote row. **Cap: max 3 open per profile → 409** with a clear message. 400 on length violations with the exact bounds in the message.

### POST /api/changelog/vote (originOk → **401 unauth** → 30/min per profile)
Body `{ suggestionId }` → toggle; then `votes` is **rewritten from the exact `suggestionVote.count()`** so the denormalized tally cannot drift. Returns `{ votes, viewerVoted }`. 404 unknown suggestion.

## Frontend (src/components/views/whatsnew-view.tsx)

- Changelog feed: cards with tag badge (feature=green, update=amber, fix=neutral, benchmark=purple — Tailwind only, no blue/indigo), `v` version chip, "PINNED" marker, client-computed relative date, four reaction pill buttons with counts; `aria-pressed`, disabled signed-out.
- Optimistic updates everywhere: reactions flip counts + `mine` locally, votes flip count/state; server response replaces state; on failure the previous snapshot is restored and a destructive toast fires.
- Roadmap & ideas: Tabs (Open / Planned / In progress / Shipped) with live per-status counts; ▲ vote cards (ChevronUp + count, primary-filled when voted); "Suggest a feature" dialog with live `x/90` char counters, client bounds checks, server errors (e.g. the 409 cap) rendered in a `role="alert"` block.
- Signed-out: everything read-only with "Sign in to vote and suggest features." (Note: unreachable through the shell since page.tsx gates on auth, but the view handles `user === null` correctly.)
- Honest empty states ("Nothing here yet."), skeleton loaders, `max-h-96 overflow-y-auto pr-1 scroll-slim` on both lists, `mx-auto max-w-3xl px-4 py-6` mobile-first container, `min-h-9/11` touch targets.

## Verification (all receipts)

- `bun run db:push` → in sync; Prisma Client 6.19.2 regenerated.
- curl: empty GET → `{"entries":[]}` / `{"suggestions":[]}`; unauth POST changelog 401; non-admin POST 403; admin creates 201 (pinned-first ordering confirmed); bad tag 400; reaction on/switch/off sequences with correct counts; anonymous reaction via ip-hash worked (no cookie); 404s; suggestion 400s with exact bounds; 3-open cap 409; vote toggle `{"votes":0,"viewerVoted":false}` ⇄ `{"votes":1,"viewerVoted":true}`; status-ladder ordering after flipping a row to in_progress (then reverted).
- Browser (agent-browser): signed in, completed onboarding, nav shows "What's new" between Tools and Settings; feed renders badges/version/PINNED/relative dates; reaction toggle 0→1→0 live; vote toggle 1→0→1 live; dialog validation gate + real 409 cap error rendered in-dialog; screenshots light + dark saved to download/verify-whatsnew-{light,dark}.png and passed VLM visual QA (alignment, contrast, no defects).
- Cleanup: smoke user, sessions, profile, 2 changelog entries, 1 reaction, 3 suggestions, 3 votes — all deleted; DB verified zero rows. The shipped feed is honestly empty until an admin publishes.
- `bun run lint` clean; `bun run typecheck` (tsc --noEmit) exit 0; dev.log shows no compile errors (only a one-off dev-server 500 from a webpack recompile racing a request body mid-session, not reproducible after compile — retested both bad-emoji and empty-body → 400).

## Deviations / judgment calls

1. **Pinned-first changelog order**: spec said "newest first"; I order `pinned desc, createdAt desc` — otherwise the pinned flag has no effect. Pinned entries are rare; within the feed everything else stays newest-first.
2. **`mine` added to changelog GET**: not in the specified shape, but active-state styling for toggle buttons requires knowing the viewer's reactions; the specified fields are all present unchanged.
3. **Reaction "switch" semantics**: with `@@unique([entryId, voterKey])` (as specified), "same emoji deletes, else create" cannot literally work — a second different emoji would violate the unique constraint. Implemented: same emoji → delete; different emoji → update in place; none → create. Documented in the route header.
4. **4th-open-suggestion cap returns 409** (state conflict per the codebase's drill-route precedent) rather than 429, which reads as rate limiting.
5. **Status ladder order** for "pinned status first": in_progress → planned → open → shipped (working items first, shipped history last), then votes desc, then newest. A `?status=` filter is also supported; the client filters by tab locally anyway.
6. **votes tally integrity**: instead of `increment/decrement` (drift-prone under races), the tally is recomputed from the vote-row count after every toggle.
7. FeatureSuggestion.profileId kept as a plain nullable string per spec (no FK relation), so cleanup code deletes dependent rows explicitly.

## Not touched

/api/ai/chat, claim-guard, dossier, coach-commands, plan/drills logic — verified untouched; only store/page/app-chrome/schema plus new files.
