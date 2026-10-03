# ChessX Roadmap

The plan to make ChessX the best place to learn chess. Status labels: shipped, building, next, later.

## Foundations (shipped)

- Six-tier curriculum: Newbie, Beginner, Intermediate, Advanced, Master, Grandmaster. Twenty levels per tier, 120 levels, 496 interactive steps. Every FEN and move line is machine-validated with chess.js (`bun run validate:content`).
- Science-based lesson loop per level: recall of earlier material, micro-teaching with a key idea, worked examples on a live board, guided practice with unique-solution drills, retrieval quizzes, engine playouts, spaced review arenas.
- Fully interactive boards everywhere: drag and click-move, legal target dots, hint flashes that pulse the exact squares a piece can go, wrong-move shake and red flash, promotion picker, free-exploration demo boards where either side can move.
- Four AI coaches with faces and voices (Nina, Victor, Elena, Sasha): spoken feedback via text-to-speech in lessons and coach chat, distinct personalities wired into the AI system prompt, pick your coach in Settings.
- Fourteen personality bots with generated faces: Pip to Maximum, each with play style, greeting, reactions to your blunders and good moves, and win/loss/draw lines shown live during the game.
- Engine play: Stockfish WASM in a worker, skill levels 0 to 20, rated bot ladder with Elo, casual games, hints, takebacks, resignations.
- Puzzles: rated pool with Elo, streaks, daily puzzle.
- Game analysis: PGN import, engine eval bar, move-by-move review, eval graph.
- BYO API keys: built-in model works out of the box; OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek and custom OpenAI-compatible endpoints supported server-side.
- Craft details: wood-clack sound synthesis, no greetings, no em dashes, honest data (no invented XP, ratings start empty), chess.com-style pressable buttons, responsive layout down to 360px.

## Next (building)

- Spaced repetition scheduler across levels and puzzles: wrong answers resurface until they stick.
- Bot personalities affect engine style: aggressive bots sac, defensive bots trade, endgame bots steer to technique.
- Coach voice polish: per-coach speed, ducking of move sounds while the coach speaks.
- Curriculum polish: more playouts per tier, per-step timing telemetry to tune minutes.

## Later (roadmap)

- Openings trainer: repertoire tree with spaced drill and model games per tier.
- Endgame trainer: tablebase-verified technique levels (K+P, R+P, Q vs R).
- Vision training: blindfold mode, coordinates sprint, mate-pattern flashcards.
- Multiplayer: account-free casual challenges via WebSocket, rated pool later.
- Coach memory: coaches remember your last ten games and tailor lessons to your real weaknesses.
- Local game import: paste a chess.com or Lichess URL and get a ChessX review.
- Achievements: honest badges derived from real milestones only.
- Mobile app wrappers, PWA install, offline lessons.
- Curriculum editor: community authors can submit validated tiers through CI.

## Quality gates (always on)

- Content CI: `bun run validate:content` fails on any illegal move, wrong SAN suffix, duplicate id, missing step, or an em dash anywhere in curriculum copy.
- Lint clean, no fabricated user data, ever.
