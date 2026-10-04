# ChessX Roadmap

The working plan to build the best place to learn chess, then keep widening the gap. Status: shipped, building, next, later. Every phase ends with something users can feel, not infrastructure nobody sees.

## Phase 0, Foundations (shipped)

- Six-tier curriculum: Newbie, Beginner, Intermediate, Advanced, Master, Grandmaster. 20 levels per tier, 120 levels, 496 interactive steps. Every FEN and line is machine-validated with chess.js (`bun run validate:content`).
- Science-based lesson loop per level: retrieval recall, micro-teaching with one key idea, worked examples on a live board, unique-solution drills, quizzes, engine playouts, spaced review arenas.
- Guided-mistake model inspired by Brilliant: a miss never shouts back. Attempt one gets a nudge toward checks, captures and threats, attempt two makes the key piece glow on the board, attempt three shows the idea played out and hands the position back so the student still plays it themselves. Quizzes explain the trap behind each tempting option, then glow the right one. Puzzles allow three guided tries before the line is revealed, and only a revealed miss costs rating.
- Boards that behave: drag and click-move, legal dots, pulsing hint flashes, promotion picker with cancel, free-exploration demo boards, animated piece identity so every move animates.
- Four coaches (Nina, Victor, Elena, Sasha) with drawn character faces and real voices through the browser speech engine: native English voices per coach, chess notation expanded before speaking so "Nf3" is heard as "knight to F three".
- Fourteen character bots from Pip (350) to Maximum (2600): drawn faces, play styles, live barks on your swings and blunders.
- Real board audio: the wooden click sample set used by the lichess project (CC0) through a gain-staged master bus with a limiter, so captures and opponent moves never spike.
- Engine play: Stockfish WASM in a worker, skill 0 to 20, rated bot ladder with Elo, casual games, hints, takebacks, resignations.
- Puzzles: rated pool with Elo, streaks, daily puzzle.
- Analysis: PGN import, eval bar, move-by-move review, eval graph.
- BYO API keys: built-in model works with no setup; OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek and any OpenAI-compatible endpoint supported server-side.
- Honesty rules: no invented XP, ratings start empty, no greeting copy, no em dashes.

## Phase 1, Retention core (building, next 4 to 6 weeks)

Goal: a new user reaches their first 10 hours and comes back the next day.

- Skill model v1: per-concept mastery from lesson steps, quiz misses, drill retries and hint usage. Concepts map to the curriculum taxonomy (pins, forks, lucena, outposts, ...). Mastery drives what the app shows next.
- Spaced repetition across levels and puzzles: missed items resurface on a improving schedule (SM-2 derived), both as review steps inside tiers and as a dedicated Review tab.
- Puzzle engine upgrade: theme tags filter practice, per-theme Elo, streak freeze, Puzzle Rush mode (3 min / survival) and Puzzle Duel vs a bot clock.
- Streaks and honest motivation: daily goal by minutes or puzzles, streak calendar, no fake numbers anywhere.
- Game report v1 (the chess.com review experience): move classification (brilliant, best, good, inaccuracy, mistake, blunder) from Stockfish win-percentage deltas, accuracy per side, one-line coach comments per key move, shareable summary. This is the single most requested chess.com feature and it needs to be excellent.
- Performance: eval cache per position, engine depth budgeting by position complexity, report generation under 20s for a 40-move game on a mid laptop.

## Phase 2, Content moat (next, weeks 6 to 12)

Goal: learning depth no generic site can copy.

- Openings program: repertoire trees for White and Black by tier, model games annotated by coaches, move-order traps as drills, spaced repertoire review synced with the skill model.
- Endgame program: tablebase-verified technique courses (K+P, R+P, Q vs R, Lucena/Philidor family), theoretical win/draw/loss labels from 7-piece Syzygy for exactness.
- Pattern library: 200+ mate and tactic patterns as flashcards with diagrams, tied into spaced review.
- Curriculum expansion: 496 to 800+ steps, more playouts per tier, annotated master games per tier with guess-the-move scoring.
- Vision and calculation training: coordinates sprint, blindfold mode, counting exercises (attackers vs defenders), candidate-moves trainer that forces you to list checks/captures/threats before moving.

## Phase 3, Real opponents and social (weeks 12 to 20)

Goal: ChessX is also a place you play, not only study.

- Human multiplayer: account-free casual challenges over WebSocket first (this sandbox ships a gateway for it), then rated pools with Glicko-2, castles/abort/draw rules, fair-play checks (engine correlation heuristics).
- Tournaments and arenas: bot arenas hourly, later human arenas, leaderboards per tier so beginners compete with beginners.
- Clubs and study groups: shared PGN studies with comments, coach-posted homework sets, follow and challenge friends.
- Bot style engine: bots no longer differ only by skill; aggressive bots sac for initiative, defensive bots trade down, endgame bots steer to technique, using contempt and style weights around search.

## Phase 4, Coach AI v2 (weeks 20 to 28)

Goal: the AI coach becomes the reason people choose ChessX over everything else.

- Coach memory: per-profile long-term memory of recent games, recurring mistake patterns, and lesson history; the coach opens with what matters to you today.
- Position-aware tutoring: the coach can replay your game, pick the pivotal moment, and spin a custom drill from your exact mistake (position + unique-solution line + explanation), generated and validated automatically.
- BYO model parity: every AI feature (report comments, drill generation, coach chat) works identically on built-in and BYO keys, with token budgets shown honestly.
- Voice v2: continuous spoken lessons (coach narrates while you move), ducking of board sounds during speech, per-coach voice tuning, reading speed control.
- Guardrails: every AI-generated drill validated with chess.js before it touches a student; the coach never invents rules, ratings or claims.

## Phase 5, Platform and reach (months 8 to 12)

Goal: ChessX everywhere, fast, in more languages.

- PWA install with offline lessons and offline puzzle packs (content is local-first, progress syncs when back online).
- Accounts and sync: optional email/passkey accounts, cross-device progress, export everything (your data is yours).
- Postgres migration path behind the Prisma interface when multi-device sync lands; SQLite stays the default for local/self-host.
- Localization: i18n skeleton with the first five languages, TTS voice pools per language.
- Accessibility pass: full keyboard board navigation, screen reader move announcements, reduced-motion mode, color-independent piece distinction.
- Packaging: desktop wrapper first (Tauri), app stores when there is demand.

## Phase 6, The long game (year 2+)

- Live lessons and broadcast-follow mode: follow titled events move by move with coach commentary.
- Community content pipeline: validated tier submissions through CI (`validate:content` as the gate), revenue share for authors.
- Opening explorer: master database + your own games merged, repertoire overlap reports.
- Coach marketplace: human coaches can assign ChessX tracks to students and see honest telemetry.
- Import anything: chess.com and Lichess game URLs become ChessX reviews; Lichess puzzle DB import (CC0) with theme mapping.

## Quality gates, always on

- Content CI: `bun run validate:content` fails on illegal moves, wrong SAN suffixes, duplicate ids, missing steps, or an em dash anywhere in curriculum copy.
- Lint clean. No fabricated user data, ever. No greeting copy, no em dashes anywhere.
- Sound ceiling: the master limiter makes earrape physically impossible; every new sound is added under the same bus.
- Guidance review: new lesson types must pass the miss-path test: what does a student see and hear on a mistake, and does it guide instead of judge.
