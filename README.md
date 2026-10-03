# ChessX

Learn chess properly. A training platform built around one idea: every lesson should be something you do, not something you read.

## What is inside

- **6 tiers, 120 levels, 496 interactive steps**: Newbie through Grandmaster. Every level follows a learning loop: recall, micro-teaching, worked examples, guided drills, retrieval quizzes, and engine playouts. Every FEN and move line is replayed and verified with chess.js in CI (`bun run validate:content`).
- **Interactive boards everywhere**: drag and click moves, legal move dots, hint flashes that pulse exactly where a piece can go, promotion picker, and demo boards you can move either side on.
- **Four coaches that talk**: Nina, Victor, Elena and Sasha each have a face, a voice and a personality. Lesson feedback and coach chat can be played out loud via text-to-speech.
- **Fourteen personality bots**: generated faces, distinct styles and live reactions to your blunders, your good moves, and the result. Rated ladder with Elo from Pip (350) to Maximum (2600).
- **Puzzles and analysis**: rated puzzle pool with streaks and a daily puzzle, plus engine game review with an eval graph.
- **Bring your own key**: the built-in model works out of the box. OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek and custom OpenAI-compatible endpoints run server-side only.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma (SQLite) · Stockfish 19 WASM · chess.js · WebAudio sound synthesis.

## Getting started

```bash
bun install
bun run db:push
bun run dev
```

Validate the whole curriculum (illegal moves, wrong SAN suffixes, duplicate ids, missing steps):

```bash
bun run validate:content
```

Piece set: cburnett (CC BY-SA 3.0). Engine: Stockfish. Not affiliated with chess.com or Lichess.
