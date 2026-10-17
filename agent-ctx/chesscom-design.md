# Chess.com Design System Brief (extracted from the chess.com reference screenshot set)

Reference images: `/home/z/my-project/download/chesscom-ref/img-01..50.*` (game review, play UI, puzzles, analysis, homepage dark). Key analyzed: game review desktop (native chess.com), game review with coach comment, official classification legend + real distribution, review classification summary + key moments, explanations panel, guess-the-move light mode.

## Color tokens (dark theme, the chess.com look)

| Token | Value | Usage |
|---|---|---|
| page bg | `#21201d` | app background, warm near-black |
| panel | `#2b2a27` | cards, sidebars, move trays |
| panel-raised | `#3c3a35` | chips, secondary surfaces, clock boxes |
| panel-border | `rgba(255,255,255,0.07)` | 1px hairlines |
| text-primary | `#f5f4f0` | near-white warm |
| text-muted | `#9b9890` | secondary text |
| accent CTA green | `#81b64c` | primary buttons ("Play", "Report" active tab uses gold) |
| accent gold | `#f7c437` / hover `#e8b323` | active tab pill, highlights |
| board light sq | `#ebecd0` | chess.com green board |
| board dark sq | `#739552` | |
| destructive | `#ca3431` | blunder, resign |

Light theme: page `#f1f0ee` warm gray, panels `#ffffff`, text `#312e2b`, same accents.

## Official classification colors (frozen in src/lib/chess/move-classification.ts)

Brilliant `#26c2a3` !! · Great `#749bbf` ! · Best `#81b64c` ★ · Excellent `#95bb4a` 👍 · Good `#96af8b` ✓ · Book `#a88865` 📖 · Inaccuracy `#f7c437` ?! · Mistake `#e8900c` ? · MissedWin `#e8b323` ⊖ · Blunder `#ca3431` ?? · Forced `#9e9c96` · Checkmate `#312e2b` #

**Real chess.com distribution (legend screenshot, from a strong account):** Brilliant 0.3%, Best 39.2%, Excellent 19.8%, Good 11.9%, Book 10.5%, Inaccuracy 7.9%, Mistake 6.9%, Blunder 3.1%, Missed Win 0.3%. → Brilliant must be RARE. Our classifier matches the definitions below.

## Game Review layout — the GUI contract

Desktop row layout, full viewport height, no page scroll:
1. **Left**: vertical eval bar (14–16px wide, full board height, rounded-sm): white portion from top sized by eval, dark portion below, thin border, tiny current-eval label.
2. **Center**: the board fills ALL remaining height (`min(available h, w)`), player plates above/below: rounded-xl dark cards (avatar + name + rating + captured-piece mini-icons) with clock box on the right ("CLOCK" microlabel over mono time, active clock = lighter fill).
3. **Right panel** (~400px, own scroll):
   - Segmented tab pills: "Report" (gold active) | "Analysis".
   - "ACCURACY & ESTIMATED ELO" card: two player cards side by side, selected = white bg + gold name + big accuracy % + ESTIMATED ELO chip; other = dark w/ gold accents.
   - "MOVE QUALITY" microlabel, then "Good vs bad decisions" card: two columns (Good w/ green dot, Bad w/ red dot). Rows = circular icon (label color bg, white glyph) + name + W/B counts right-aligned. Good col: Brilliant, Great, Best, Excellent, Good, Book. Bad col: Inaccuracy, Mistake, Miss, Blunder.
   - "CRITICAL ANALYSIS" microlabel: key-moment cards — headline style ("Learn from your mistake", "That should have been your win!"), mini eval graph with orange blunder dots, click jumps to the position.
   - Coach comment bubble: avatar left with "COACH" microlabel, "(!) e4 is a great move" title + eval badge "+4.67" right, 2-sentence explanation, "Show Line" button, then Retry / Share (green) / Next buttons.
   - Move list rows: `12. [e4 !] [Bg4]` with classification icon inline after the move, current move highlighted.
4. **Bottom of panel**: 5 big rounded-xl control buttons: |< < ▶ > >| (44px+, first/prev/play/next/last). Play button darker/active state.
5. Eval graph strip at panel top: white/gray area chart with orange dots at blunders, click-to-jump.

## Play view (fullscreen, stable) — the board contract

- The whole play layout is `h-[100dvh]` flex: chrome header fixed height, main row flex-1 min-h-0, board column centers the board sized by `min(width, height)` so it NEVER resizes mid-game.
- Player plates have fixed height (50px) always rendered (empty states allowed) so nothing shifts when captures appear.
- Captured bar: reserve its row always (fixed 18px) — render placeholders when no captures.
- `scrollbar-gutter: stable` on the app shell so the appearance of page scroll never shifts the board.
- Board interactions must never change board size: `aspect-square` + `w-full h-full` container computed once per resize, pieces positioned by %, transitions only on left/top.
- Analyses/review/play share the same "board cockpit" pattern: board column (eval bar + plates + board) + side panel; NO text-only screens.

## Puzzles

- chess.com puzzle screen: board left/center, right rail with mode tabs (Puzzles/Race/Battle/Duals), rating chip with +/- after solve, "Next puzzle" big green button, hint button bottom-left of board, goal text above board ("White to move — win material"), NO title of the puzzle anywhere pre-solve. Post-solve attribution only.

## General chrome

- Left icon rail (60px, dark): logo top, nav icons with active = lighter panel + left green bar, section microlabels.
- Everything rounded-xl (10–12px), NOT pill-rounded except chips.
- Buttons: solid fill, 700–800 weight, 44px min height, subtle inset shadow, hover brighten, active scale .98.
- Micro-labels: 10–11px, uppercase, letter-spacing 0.08em, muted.
- Clocks: mono font, tabular-nums, dark chip that lightens when it's that side's turn, red text < 10s.

## Non-negotiables for all tasks

1. NO puzzle/drill titles anywhere pre-solve — neutral labels only ("Puzzle · White to play · 1450"). Even a TRUE title spoils the motif ("Rook Queen Sacrifice Forces Mate" tells the solver a rook+queen sacrifice is coming). Post-solve: show source attribution line only (opening + players + rating), not a headline.
2. All UI text in English, professional chess.com tone.
3. No blue/indigo theme colors (chess.com palette above is warm green/gold/charcoal).
4. Board must be BIG (fills height) on every gameplay surface.
5. `min-h-11` (44px) touch targets, `aria-*` on icon-only buttons, keyboard operable.
6. TypeScript strict; shadcn/ui where fitting; Tailwind only.
7. Light AND dark themes must both look right (next-themes `dark` class variables in globals.css).
