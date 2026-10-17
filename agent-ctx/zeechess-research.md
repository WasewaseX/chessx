# Zee Chess (zeechess.com) — Feature & UI/UX Research for Ply

Task ID: 2-b · Research only · Sources: live site fetch (HTML + CSS), VLM analysis of 6 app
screenshots + full landing page, existing screenshots in `download/zeechess/`.

## What Zee Chess is

A **Windows desktop chess app** sold via the Microsoft Store (site is a single-page Astro
marketing site). Positioning: *"Play, review, and make it yours."* No account required —
games and settings are stored locally. Pricing is not shown on the site (deferred to the
Store listing). No coach, lessons, puzzles, or gamified training — it is deliberately a
**play + review + customization** product.

Note: `01-hero.png` and `home-top.png` are byte-identical (same md5) — one screenshot covers both.

---

## 1. Feature inventory (zeechess)

### App features (from site copy + screenshots)

| Feature | Details observed |
|---|---|
| **Play vs built-in opponents** | Difficulty tiers (screenshot shows opponent tag "Master" with CPU-chip icon); player tags sit outside board corners with status dot; "Windows · Local play · Built-in opponents" |
| **Bring your own UCI engine** | Register external engines, configure their options, use for play, hints, and review ("Your favorite engine. Your familiar board."). Dedicated landing section — this is a headline differentiator for them |
| **Game review** | Move list with **per-move quality dots** (green = good, red = blunder/mistake, grey = neutral) + **miniature piece icons instead of letters** in notation; **horizontal eval graph** under the move list (black/white split, dips visible at blunders); **"Top moves"** ranked top-5 engine list with centipawn evals (`+0,24`); a **"Tempo"** stat; **engine suggestion arrow drawn on the board** (thick translucent green); last-move yellow square highlight; first/prev/next/last playback controls |
| **Game library** | Master–detail split: left = list rows (avatar, name, opponent, **"Loss" result pill** in muted red); right = detail pane with matchup header, result tag, metadata ("Today, 11:20 PM", **opening name "King's Pawn Opening"**, tags "Classical • No clock • 30 moves"), **final-position board preview**, move list, and one full-width **"Review Game"** CTA. Header has **Import** (PGN) |
| **Position editor** | Board center-stage; **piece palette** (white row + black row, selected piece highlighted); **side-to-move segmented toggle** (White/Black); **castling-rights checkboxes**; floating turn indicator; green **"Play"** button in sidebar header |
| **Positions library** (next-release preview) | Saved positions list ("Castling and en passant"); **Import FEN** and **New** actions; detail = board preview + "White to move"; Edit / Rename / Delete grouped separately from **Copy FEN**; full-width **"Play from position"** primary CTA anchored to the bottom |
| **Theme manager** (next-release preview) | Modal with left "YOUR LIBRARY — 8 themes" list (Classic Green, Classic Enhanced, Midnight Walnut, State Blue, Lime, Pink, Zee Chess…), right **live-rendered board preview**, theme name + version attribution, **Import theme…**, Remove (dimmed), Close, **Select theme**. Themes mix-and-match pieces × board |
| **Assistance settings** | "Start with hints and takebacks on or off" — explicit per-game toggles |
| **Board arrows** | "Draw arrows while you work out a move" (thinking marks on the board) |
| **Sound design** | "Refined sounds and small improvements throughout play" |
| **Local-first / no account** | FAQ: "No Zee Chess account is required for normal play. Games and settings are stored locally" |

### Marketing-page features (structure of the one-pager)

1. Header: brand + 3 anchor nav links + compact CTA (`Get Zee Chess ↗`)
2. Hero: eyebrow w/ dot → huge H1 → lede → primary CTA + text-link → platform note → screenshot in fake window chrome
3. "At a glance" 3-column numbered strip (01 / PLAY, 02 / REVIEW, 03 / CUSTOMIZE) between hairline borders
4. "Inside Zee Chess": 2×2 screenshot cards, numbered 01–04, copy *below* image
5. **"Next-release preview"** — shipping roadmap as marketing ("Real screens from the development build. Here's what we're working toward.")
6. Engine/UCI section with panel card
7. FAQ (5 `<details>` accordions, 2-column layout)
8. Final CTA card with radial glow ("Make your move.")
9. Footer + privacy-first analytics consent banner (fixed bottom, Accept/Decline)

---

## 2. UI/UX patterns worth copying (specific)

### Color system (exact tokens from their CSS)

```css
--bg: #171b18;      /* near-black with a green cast — NOT neutral grey */
--panel: #202620;   /* raised panels */
--ink: #f5f1e6;     /* warm cream text, never pure #fff */
--muted: #b3bcaf;   /* grey-green secondary text */
--green: #c0d99b;   /* SOFT sage accent — pastel, not saturated chess.com green */
--line: #364033;    /* hairline borders */
```
- Primary button: sage bg with **dark-green text** `#1b2816` (low-contrast-friendly), hover `#d0e7b1`.
- Section band tint `#232a21`; final CTA uses `radial-gradient(at top, #35402b, transparent 80%)` glow.
- The app itself uses the same family: cream `#eedc9a`-ish light squares + sage `#7a9e7e` dark squares, so **brand, marketing site, and board share one palette**.

### Typography

- Inter everywhere; H1 `clamp(3rem, 5.2vw, 5.5rem)`, weight 550, letter-spacing **−0.065em**, line-height 1.04 — enormous but tight and calm.
- **One serif-italic accent word** in the H1: `em { color: var(--green); font-family: Georgia, serif; font-weight: 400 }` → "Your board. Your next *move.*" (Ply already ships Lora — this is a free win).
- Eyebrow labels: uppercase, 0.7rem, letter-spacing 0.13em, weight 650, sage green, **preceded by a 6px dot**.
- Body copy line-height 1.65; secondary copy always muted color, never smaller-than-readable.

### Layout & components

- **Window-chrome framing**: hero screenshot wrapped in a fake title bar (`● ● ●` + "Zee Chess / Play"), radius 10, shadow `0 25px 70px #0004`, figcaption below. Makes product shots feel like the real app.
- **Numbered sections** ("01 / PLAY", card indices 01–04) — gives a calm, manual-like structure without icons.
- **Split section headings**: left = eyebrow + H2, right = one short muted sentence, aligned to the baseline (`align-items: end`).
- **Cards without card-bulk**: screenshots get border + radius, but copy sits *outside/under* the image — airy, not boxed-in.
- Hover motion is **tiny**: image `scale(1.015)` over 0.25s; buttons `translateY(-1px)`.
- **Arrows as glyphs** instead of icons: `↗` for external CTAs, `↓` for scroll links, `↗` as green bullet markers in lists.
- Buttons: min-height 52px, radius 7, weight 650; a `.compact` 42px variant for the header.
- FAQ: 2-col grid, `<details>` rows separated by hairlines only — no accordion chrome.
- Accessibility: 3px `focus-visible` sage outline with 5px offset; skip-link; `prefers-reduced-motion` kills all transitions; `scroll-behavior: smooth` + `scroll-padding-top`.

### Microcopy (their voice — short imperative fragments, quiet confidence)

- H1: "Your board. Your next move." · Lede: "Play a game. Find the turning point. Try again."
- Platform note under CTA: "Windows · Local play · Built-in opponents" (spec line as trust signal)
- Figcaption: "One board. Plenty to come back for." · Footer tagline: "Play. Review. Make it yours."
- Roadmap honesty: "Real screens from the development build."
- FAQ answers are plain and reassuring ("Do I need an account to play? — No.")

---

## 3. Gap analysis vs Ply

Ply's breadth is far beyond Zee Chess — they have **no coach, no lessons, no puzzles, no rush,
no vision training, no battle mode**. Ply's moat is the AI coach + structured curriculum.
Verified Ply inventory (from source): coach chat with board context, lessons/lesson-player,
puzzles, rush, 14 bot characters, vision, battle, analysis view (move-quality labels
best→blunder, **EvalGraph with seek**, white/black accuracy), review view, profile/settings,
4 board themes (green/brown/slate/walnut), user-drawn board arrows (orange thinking marks),
PGN in/out, sounds, coords/legal-move toggles.

**Where Zee Chess is ahead — real gaps for Ply:**

1. **Saved positions as first-class objects.** Zee Chess has a Positions library (save →
   preview → "Play from position" vs any opponent, either side, Import/Copy FEN). Ply only
   has a FEN paste box inside the coach — positions you encounter in coach/analysis evaporate.
2. **Custom position editor.** Piece palette, side-to-move segmented control, castling-rights
   checkboxes, then "Play". Ply's FEN handling is text-only; beginners can't build positions.
3. **"Top moves" multi-PV panel.** Ranked top-5 engine moves with evals + click-to-arrow on the
   board. Ply's analysis shows one eval + quality labels; it never shows *alternatives*.
4. **Move-list scanability.** Zee Chess puts a colored quality dot on every move row, uses
   miniature piece glyphs instead of SAN letters, and highlights the current row. Ply has
   labels/legend but the move list itself is not quality-annotated at a glance.
5. **Game library as a destination.** Result pill (red "Loss"), opening name, "Classical • No
   clock • 30 moves" metadata, final-position preview board, and a per-game "Review Game" CTA.
   Ply's GameRecord data exists but history is not presented as a browsable master–detail library.
6. **Piece-set + board theming with live preview.** 8 themes, mix pieces × board, "Select theme"
   with live-rendered preview and attribution. Ply: 4 board colors, a single piece set
   (cburnett), no preview, no piece variety.
7. **"No account needed to play."** Zee Chess is aggressively friction-free. Ply gates behind
   sign-in/auth before anything — a conversion and trial-experience gap.
8. **Explicit assistance toggles.** "Hints and takebacks on or off" at game setup. Ply's bot
   play doesn't state its assistance contract (honesty is a Ply value — this fits).
9. **Visual restraint in dark surfaces.** Ply's dark mode is neutral-brown chess.com palette
   (#1f1e1c / #81b64c saturated green). Zee Chess's sage-on-green-black + cream ink feels more
   distinctive, calmer, and more "premium tool" than "game arcade".
10. **Roadmap-as-content & privacy posture.** "Next-release preview" with real dev-build
    screenshots, and a polite analytics consent banner — trust patterns Ply's site/home lacks.

---

## 4. Top 10 concrete improvements for Ply (ranked by impact)

1. **Saved Positions library + "Play from position".** New view: master–detail list of saved
   positions (auto-save candidates: positions discussed with the coach, mistakes from analysis)
   with board preview, "White to move", Copy FEN, and one full-width **"Play from position"**
   CTA that launches any of the 14 bots from that FEN, either color. Turns every coach/analysis
   moment into a repeatable drill — biggest engagement loop we're missing.
2. **"Top moves" multi-PV panel in Analysis & Review.** Ask the Stockfish worker for top-3/5
   (`multipv`), render ranked rows: rank, SAN with piece glyph, eval chip. Click = draw the
   suggested arrow on the board (Ply's board already renders view-provided arrows). Makes
   "why was my move bad?" immediately answerable.
3. **Quality dots + piece glyphs in every move list.** Add the existing move-quality labels as
   8px colored dots on each SAN row (reuse `#e6a82c`/red/green tokens), highlight the current
   row, and swap SAN letters for mini piece SVGs in play/review lists. Cheap, huge scanability.
4. **Guest mode: "No account needed to play."** Let a fresh visitor play bots / try a lesson
   with local-only state, and prompt sign-in only when saving cross-device progress. Directly
   copies Zee Chess's core positioning and removes Ply's biggest funnel drop.
5. **Game library upgrade.** Rework game history into Zee Chess's master–detail pattern: rows
   with result pill (Win/Loss/Draw in muted red/green/grey), detail pane with matchup header,
   opening name (Ply can already name openings), time-control/move-count metadata line,
   final-position board preview, and a hero **"Review game"** button.
6. **Theme manager modal with live preview.** Left: "Your library" list (4 board colors × 2
   piece sets — add one non-cburnett set); right: live-rendered starting position on the chosen
   board, "Select theme" footer. Reuses the existing `BOARD_THEMES` table + profile `theme` field.
7. **Visual refinement of dark mode using their tokens.** Shift dark surfaces to green-cast
   charcoal (`#171b18` bg, `#202620` cards, `#364033` borders), ink → warm cream `#f5f1e6`,
   secondary → `#b3bcaf`, and introduce a **soft sage accent** `#c0d99b` for highlights/eyebrows
   while keeping `#81b64c` only for primary actions. Also: serif-italic green accent word in
   Home/Auth H1s (Lora is already loaded).
8. **Custom position editor.** Piece-palette rows (white/black), side-to-move segmented control,
   castling-rights checkboxes → validates FEN → feeds the Positions library (item 1). Enables
   teachers/self-learners to set up drills; zeechess proves the whole feature fits one screen.
9. **Assistance contract on game setup.** In Play setup: explicit "Hints" and "Takebacks"
   toggles (default on for <800, off for rated-ish play), echoed as a small line in the game
   header ("Hints off · Takebacks off"). Honest, and it differentiates bot difficulty meaningfully.
10. **Microcopy & polish sweep.** Adopt their voice patterns: sentence-fragment ledes ("Solve a
    puzzle. Find the pattern. Try again."), spec-line under CTAs ("No download · Free · Your
    progress saved"), figcaption-style captions under board previews, `↗`/`↓` glyph links,
    eyebrow-with-dot section labels, numbered indices on home feature cards, and the
    accessibility pass (3px focus-visible outline with offset, skip-link, `scroll-padding`).

### Screenshots captured this session (saved under `download/zeechess/`)

- `ss-game-play.png` (2031×1212) — play screen: move list w/ piece glyphs, undo/hint/flip bar
- `ss-game-review.png` — review: quality dots, eval graph, "Top moves", suggestion arrow
- `ss-game-library.png` — library: master–detail, result pills, "Review Game" CTA
- `ss-position-editor.png` — editor: piece palette, side-to-move, castling checkboxes
- `ss-positions-preview.png` (from webp) — Positions library preview build
- `ss-themes-preview.png` (from webp) — Theme manager modal preview build

*Landing page analysis: `02-full.png` (full-page capture already on disk). Hero duplicates:
`01-hero.png` ≡ `home-top.png`.*
