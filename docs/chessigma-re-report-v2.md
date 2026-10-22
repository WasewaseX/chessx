# Chessigma & Chess.com — Deep Reverse-Engineering Report (v2, REA-verified)

> Compiled with **REA (Reverse Engineer Anything) v6.7.0** — https://github.com/morluto/rea
> (153 CLI commands / 207 MCP tools, static evidence-graph analysis).
> Previous session's manual findings are confirmed or corrected below; every claim carries
> its evidence source. RE evidence bundles live in `re/chessigma/rea-jsapp-report.md`
> (desktop shell, 6,443 lines) and `re/chessigma/rea-web-report.md` (web bundle, 126,111 lines).

## 1. Desktop shell (Chessigma-1.0.2-linux-amd64.deb)

Artifact: `re/chessigma/artifact/Chessigma-1.0.2-linux-amd64.deb` (99,287,960 bytes,
sha-size verified identical across two independent downloads from
`https://cdn.chessigma.dev/desktop/v1.0.2/`). Extracted via `ar` + `tar`, asar unpacked via
`@electron/asar` → `re/chessigma/extracted/asar-src/` (9 files, 88 KB, 100% JS).

### 1.1 REA formal findings (evidence-backed)

| Finding | Value | Meaning |
| --- | --- | --- |
| browser_windows | 1 | Single BrowserWindow |
| preload_entrypoints | **0** | No preload script at all |
| context_bridge_apis | **0** | No contextBridge surface |
| exposed_api_members | **0** | Nothing exposed to the renderer |
| ipc operations / channels / handlers | **0** / 0 / 0 | Zero IPC anywhere |
| utility_processes | 0 | No helpers |
| native_addon_bindings | 0 | No native addons |
| integrity_contradictions | 0 | package.json matches code |

Interpretation: the hardest possible Electron posture — the renderer is a plain browser
view with literally no privileged bridge. Even a fully-compromised renderer cannot reach
Node. This is the model chessx's desktop shell (`desktop/`) already follows.

### 1.2 Shell design decisions (all verified in source, now REA-confirmed)

1. RFC 8252 loopback Google OAuth handoff (127.0.0.1:0 ephemeral listener, 16-byte state
   constant-time compared, single-use, 5-minute expiry) — `src/auth-handoff.js`.
2. UA contract: clean Chrome UA; `Chessigma-Desktop/<ver>` appended **only** for their own
   hosts — `src/user-agent.js`.
3. Navigation three-way classification (internal / external-open-browser / block) with an
   exact hostname allowlist — `src/navigation.js`.
4. Offline page served only for a DENY-list of hostnames — `src/offline.html`.
5. Crash recovery: 30 s cooldown, single auto-reload — `src/main.js`.
6. Window state atomic persistence with write-temp-then-rename — `src/window-state.js`.
7. package.json: `chessigma-desktop`, version 1.0.2, author "Arche Labs Ltd"
   (mehdi@chessigma.com), description literally: "Content-free window over the live web
   app — same product, direct download."

## 2. Web product (www.chessigma.com, Next.js App Router on Vercel)

### 2.1 Capture set (committed)

- `re/chessigma/web/html/` — home, pricing (946 KB), login, signup, features (SSR).
- `re/chessigma/web/js/` — 41 unique JS chunks (2.8 MB) from
  `cdn.chessigma.dev/_builds/066893850c6c7ee06bad79a0cdb93ba684173212/_next/static/`.
- `re/chessigma/web/css/` — 49 CSS bundles (708 KB).
- REA semantic analysis: `re/chessigma/rea-web-report.md` (126,111 lines).

### 2.2 Concrete public API surface (extracted from chunks)

`/api/support/upload`, `/api/status/report`, `/api/changelog/state`, `/api/broadcast`,
`/api/user/tz`, `/api/user/subscription`, `/api/user/profile`, `/api/user`,
`/api/streak/activity`, `/api/streak`, `/api/status/chesscom`,
`/api/pricing/welcome-offer`, `/api/pricing/lifetime-offer`, `/api/feedback`,
`/api/daily/progress`, `/api/chess/games/store`, `/api/changelog/suggestions`,
`/api/changelog/suggestions/{id}`, `/api/changelog/roadmap/vote`,
`/api/changelog/reactions`, `/api/changelog/content`, `/api/cdn-fallback`.

Read-across for chessx: changelog + reactions + suggestions + roadmap votes (we shipped
these), streak + activity (we ship these), user/subscription (premium gating), and
`/api/chess/games/store` — their import sink: games fetched from chess.com/lichess are
POSTed to the server and stored, then every report is computed from that store.

### 2.3 Monetization matrix (extracted verbatim from the pricing SSR page)

| | Free $0 | Monthly $19 | Yearly $11.67/mo (−39%, $140/yr) | Lifetime $490 |
| --- | --- | --- | --- | --- |
| Game review | ✅ unlimited | ✅ | ✅ | ✅ |
| Puzzles | ✅ | ✅ | ✅ | ✅ |
| Imported games history | ✅ | ✅ | ✅ | ✅ |
| Daily training plan | Random | Personalized | Personalized | Personalized |
| Opening Trainer | 5 lines | Unlimited | Unlimited | Unlimited |
| Human-like bots | 2 | Unlimited | Unlimited | Unlimited |
| Woodpecker | 1 set | Unlimited | Unlimited | Unlimited |
| Blunder Fix / Blunder Shield | — | ✅ | ✅ | ✅ |
| Chess DNA report | — | ✅ | ✅ | ✅ |
| "Froggy" AI coach | — | 200/mo | 400/mo | 400/mo (×2 stack?) |
| Membership leaderboard / no ads / founder access | — | ✅ | ✅ | ✅ |

Copy facts: cancel-anytime even on monthly; 7-day no-questions refund (founders "Mehdi or
Eliot" answer refund mail same day); pitch "You are paying chess.com for game review and
puzzles — both are free here."

Marketing claims (for parity targets): "+112 Elo in the first month" average, 1,713
trained with Coach Froggy, "4 out of 5 players here are rated under 1400".

### 2.4 Their Chess DNA — five domains (verbatim from pricing FAQ)

"Your report splits your game into five areas: **blunders, tactics, the clock, converting
winning positions and your openings**."

chessx today measures: tactics, consistency, opening, aggression, endgame. Both are
defensible; chessigma's set is more obviously *actionable* (clock management and
conversion are trainable). Recommended chessx evolution: rename/extend our domains toward
blunder-rate, tactics, clock (time-usage curve from move timestamps), conversion
(winning-position → win rate), openings (book depth + win rates). Our GameRecord already
stores localHour and per-move data sufficient for a clock domain.

### 2.5 Feature timeline (their changelog data embedded in `js/37203-*.js`)

- 2026-06-18 Opening Trainer (guided openings, move by move) — free.
- 2026-06-09 Shareable Chess DNA report (public share link) — supercoach tier.
- 2026-05-27 **"Open with 6"**: type `6chess.com` or `6lichess.org` to land on analysis
  (a deeplink prefix trick — cute growth hack).
- 2026-05-02 Supercoach launch = AI coach + Blunder Shield + Woodpecker + Chess DNA + one
  plan ("one kit aimed by your report").
- 2026-04-25 Free analysis board (drag pieces, paste FEN/PGN, instant eval).
- 2026-04-23 "Next move" tool (best move for any position).
- 2026-04-20 Elo calculator (FIDE / chess.com / lichess expected-score tools).
- Chess Globe (globe.chessigma.com) — real-time games-on-a-globe visualization.
- 10 opening courses; "Coach Froggy" is their AI coach persona.

### 2.6 Auth (verified live in browser)

`/signin` offers exactly two paths: **Continue with Google** and **passwordless email
magic link** ("Send link to email"). No password accounts at all. The import widget on
the hero ("Chess.com username → Review Games") bounces anonymous users to `/signin`.
Authed app chunks are NOT publicly fetchable (chunk URLs for authed routes are not
referenced by public pages, and the CDN 404s on guesses) — this is the honest boundary of
static RE without an account.

### 2.7 Infrastructure (from previous session, unchanged)

Vercel deployment (build id `066893850c6c7ee06bad79a0cdb93ba684173212`, `dpl_4zXzzZtpg…`),
CloudFront-fronted CDN on cdn.chessigma.dev, Supabase project `ozvvyafyqcgjftdotcae`,
Stripe hosted checkout.

## 3. Chess.com (deep-dive attempt, environment-bounded)

- www.chess.com and **api.chess.com** are both behind a Cloudflare "Just a moment…"
  challenge for this sandbox's datacenter IP (HTTP 403 on every curl and on our server-side
  import route).
- chessx already ships the honest mitigation: the import UI explains the 403, offers the
  single-game browser fetch tabs (the user's own browser passes Cloudflare) and the
  always-works PGN paste path.
- Lichess does NOT block: our import pipeline ingested 5 games for `DrNykterstein` live
  during this session (`/api/import/username` → `{"ok":true,…,"imported":5}`).
- Chess.com's review/accuracy math is computed server-side and only rendered by the
  client; without passing the challenge there is no additional static surface to mine.
  The public documented contracts we already implement:
  `api.chess.com/pub/player/{u}/games/{YYYY}/{MM}` (JSON, monthly archives),
  `api.chess.com/pub/player/{u}` (profile), lichess `GET /api/games/user/{u}` (PGN stream,
  `max`, `until`, `opening=true`).

## 4. What this changes for chessx (prioritized port deltas)

1. **Import store**: persist imported games per profile (we now have the pipeline; next is
   surfacing "every game you have ever imported" as a browsable library — chessigma's free
   tier promise).
2. **DNA domains v2**: extend our five domains with **clock** (time usage per phase from
   move timestamps) and **conversion** (won-position → won-game rate). Rename aggression →
   keep, but blunder-rate belongs in the headline row like theirs.
3. **Free-tier honesty**: chessigma keeps game review + puzzles free forever and gates the
   plan/coach/trainers. chessx is already all-free; our "everything unlocked" admin now
   mirrors their paid tier for internal use.
4. **Shareable DNA report** (public share link) — cheap, high-growth.
5. **Elo calculator + "Next move" tools** — both trivially buildable from our engine
   service; chessigma lists them as free acquisition tools.
6. **"Open with 6"** style deeplinks (`6chessx.app`) — a fun growth hack worth copying.
7. **Coach quota**: theirs is 200/mo paid; chessx's coach is free — we keep unlimited for
   admin, generous default for users (40 gen/day cap already in place).

## 5. Evidence & limitations

- All static analysis ran offline with REA 6.7.0 (`rea analyze-javascript-application`
  with evidence graphs, sha256 digests, and zero target execution).
- The 99 MB .deb is intentionally NOT committed (size); its extraction IS committed under
  `re/chessigma/extracted/asar-src/` (9 files) so the analysis is reproducible.
- Web chunks are minified Next.js production builds; REA retained semantic nodes where
  within budget (300k) — string-level facts (API paths, copy, constants) are complete;
  control-flow reconstructions are partial for vendor chunks.
- Authed chessigma app and chess.com challenge pages are out of static reach without an
  account/browser session; no claims are made about them beyond what public artifacts
  show.

---

## Addendum (Oct 22, REA pass 3): sparring-roster mechanics + daily-plan taxonomy

Mined from the committed production chunks (`re/chessigma/web/js/`), string-literal
extraction with chess.js validation of everything we ported.

### A. The sparring coach is a FAMILY LADDER (chunk 5528)

Every persona is a structured object, extracted verbatim:

```
{id:"londoner", familyId:"froggy", role:"rival", name:"The Londoner",
 flavor:"you already know my first move.", preset:"human", elo:650,
 timeControl:..., repertoire:{white:[], black:["london"]}}
```

Full roster (2 families × 7 rivals + 1 boss each):

| Froggy family | Elo | Black repertoire | Pirate family | Elo | Black repertoire |
| --- | --- | --- | --- | --- | --- |
| The Kid | 400 | italian | The Cabin Boy | 400 | italian |
| The Londoner | 650 | london | The Gunner | 700 | kings-gambit |
| The Viking | 850 | kings-gambit | The Looter | 1050 | london |
| The Streamer | 1050 | english | The Cook | 1300 | italian |
| The Grandpa | 1250 | ruy-lopez | The Lookout | 1550 | english |
| The Fan | 1450 | vienna-game | The Captain | 1900 | ruy-lopez |
| The Genius Kid | 1700 | vienna-game | The Ghost Captain (boss) | 2200 | — |
| The Coach (boss) | 2200 | everything | | | |

Design: rivals unlock in Elo order (`next()` = roster[i+1]), each rival owns a
SIGNATURE OPENING and a flavor line; the family ends in a 2200 "boss" that
"plays everything, tells nothing."

**Ported to chessx (this pass)**: per-coach signature repertoires in
`src/lib/coaches.ts` (`repertoireLabel` + `repertoireLines`, 17 SAN lines all
validated legal with chess.js at build time) — Nina opens Italian/classical,
Victor King's Gambit/Scotch/Sicilian, Elena QGD/English/KID, Sasha
Ruy mainline/Najdorf/classical KID. `pickBookMove` in coach-game-view prefers
the coach's signature pool before the Elo band's generic lines. Browser-verified:
Sasha played 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 **4.Ba4** (closed Ruy mainline, exclusive
to his repertoire — the generic band's Berlin line would take with Bxc6);
evidence `re/shots/11-sasha-ruy-mainline.png`, picker cards
`re/shots/12-coach-signature-cards.png`.

### B. Daily-plan task taxonomy (chunk 5528)

Their plan tasks all carry the same spec shape:
`{id, title, subtitle, estimatedMinutes, target, family, trainsCategories:[{category,weight}],
sessionsRequired, repBand:{min,max}, minutesPerRep, flags:{manualTogglable, selfCompleting}, lockedReason}`.

Free + paid task set (16 extracted): Blunder Shield "Spot the safe move" (8min,
blunders .6/tactics .4, 2 sessions), Blunder Fix "Find the move you missed",
Convert the Win (conversion .8), Save the Game (conversion .5/discipline .3),
Sparring (15min, five categories weighted), Review the game / the report,
Patch your prep (preparation .9), Woodpecker, rated puzzle set, daily puzzle.
Their five training CATEGORIES: **blunders, tactics, discipline, conversion, preparation**.

Read-across: chessx's plan builder already has per-task minute budgets, family
sections and honest shrink-when-empty; the category-weight schema is a possible
future refinement for plan ordering (weights × DNA domain weakness).

### C. Access gates seen in the client (chunk 34596, for contrast)

`blunder-shield`, `blunder-training`, `mistakes`, `challenge` are all
`free:{access:"paid"}` on chessigma (enforcedAt lists name their server routes).
chessx ships all of these free; no action needed — recorded as the honest
competitive contrast.

### D. chess.com re-attempt (Oct 22)

Real headless Chromium via agent-browser, 40+s on the interstitial plus one
explicit turnstile checkbox click → still "Just a moment…" (screenshot
`re/shots/chesscom-challenge-1022.png`). Boundary stands: no chess.com
first-party surface is reachable from this sandbox.
