# ChessX Roadmap

The working plan to build the best place to learn chess, then keep widening the gap until ChessX stands next to chess.com as a full alternative. Status labels: shipped, building, next, later. Every phase ends with something users can feel, not infrastructure nobody sees. Every session of work ends with a push to `WasewaseX/chessx` so nothing is ever lost.

## Where chess.com actually lives, feature by feature

This is the parity checklist. ChessX is not done until every row has a shipped answer, and anything chess.com does badly is a chance to do it better.

- Play: live rated pools per time control, casual games, daily (correspondence) chess, variants (Chess960 first), custom challenges with invite links, premoves, keyboard play.
- Learn: interactive lessons (our core, shipped), openings, endgames, drills, vision training, analysis with game review.
- Puzzles: rated pool, daily puzzle (shipped), themes, Puzzle Rush, Puzzle Battle, custom sets.
- Watch: events, broadcast follow with commentary.
- Social: profiles, friends, chat, clubs, forums, tournaments, leaderboards.
- Trust: fair play detection, rating integrity, honest stats.
- Platform: web, installable app, offline, multiple languages.

Chess.com spread these over 15 years. The plan below sequences them so the learning moat gets wider every month while the play side catches up.

## Phase 0, Foundations (shipped)

- Six-tier curriculum: Newbie, Beginner, Intermediate, Advanced, Master, Grandmaster. 20 levels per tier, 120 levels, 496 interactive steps. Every FEN and line is machine-validated with chess.js (`bun run validate:content`).
- Science-based lesson loop per level: retrieval recall, micro-teaching with one key idea, worked examples on a live board, unique-solution drills, quizzes, engine playouts, spaced review arenas.
- Guided-mistake model inspired by Brilliant: a miss never shouts back. Attempt one gets a nudge toward checks, captures and threats, attempt two makes the key piece glow on the board, attempt three shows the idea played out and hands the position back so the student still plays it themselves. Quizzes explain the trap behind each tempting option, then glow the right one. Puzzles allow three guided tries before the line is revealed, and only a revealed miss costs rating.
- Boards that behave: drag and click-move, legal dots, pulsing hint flashes, promotion picker with cancel, free-exploration demo boards, animated piece identity so every move animates. Verified move by move in a real browser session.
- Four coaches (Nina, Victor, Elena, Sasha) with drawn character faces and real voices through the browser speech engine: native English voices per coach, chess notation expanded before speaking so "Nf3" is heard as "knight to F three".
- Fourteen character bots from Pip (350) to Maximum (2600): drawn faces, play styles, live barks on your swings and blunders, each one a character, not a skill slider.
- Real board audio: the wooden click sample set used by the lichess project (CC0) through a gain-staged master bus with a limiter, so captures and opponent moves never spike.
- Engine play: Stockfish WASM in a worker, skill 0 to 20, rated bot ladder with Elo, casual games, hints, takebacks, resignations.
- Puzzles: rated pool with Elo, streaks, daily puzzle.
- Analysis: PGN import, eval bar, move-by-move review, eval graph.
- BYO API keys: built-in model works with no setup; OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek and any OpenAI-compatible endpoint supported server-side.
- Honesty rules: no invented XP, ratings start empty, no greeting copy, no em dashes.

## Phase 1, Retention core (building, next 4 to 6 weeks)

Goal: a new user reaches their first 10 hours and comes back the next day.

- Skill model v1: per-concept mastery from lesson steps, quiz misses, drill retries and hint usage. Concepts map to the curriculum taxonomy (pins, forks, lucena, outposts, ...). Mastery drives what the app shows next.
- Spaced repetition across levels and puzzles: missed items resurface on an improving schedule (SM-2 derived), both as review steps inside tiers and as a dedicated Review tab.
- Puzzle engine upgrade: theme tags filter practice, per-theme Elo, streak freeze, Puzzle Rush mode (3 min / survival) and Puzzle Battle vs a bot clock (head to head on the same positions, first to the score wins).
- Streaks and honest motivation: daily goal by minutes or puzzles, streak calendar, no fake numbers anywhere.
- Game report v1 (the chess.com review experience, shipped): move classification (brilliant, best, good, inaccuracy, mistake, blunder) from Stockfish win-percentage deltas, accuracy per side, opening name detection, players and result from PGN headers, a Key moments card with one-line reasons that jumps to the position, coach lines per key move. Mate positions scored from the game state so the final move can never poison the accuracy math. Still open: shareable summary and longer-game depth budgeting.
- Insights v1: accuracy trend, common mistake tags, opening results table, time-of-day performance. Every number derived from your real games, never seeded.
- Performance: eval cache per position, engine depth budgeting by position complexity, report generation under 20s for a 40-move game on a mid laptop.

## Phase 2, Content moat (next, weeks 6 to 12)

Goal: learning depth no generic site can copy.

- Openings program: repertoire trees for White and Black by tier, model games annotated by coaches, move-order traps as drills, spaced repertoire review synced with the skill model.
- Endgame program: tablebase-verified technique courses (K+P, R+P, Q vs R, Lucena/Philidor family), theoretical win/draw/loss labels from 7-piece Syzygy for exactness.
- Pattern library: 200+ mate and tactic patterns as flashcards with diagrams, tied into spaced review.
- Curriculum expansion: 496 to 800+ steps, more playouts per tier, annotated master games per tier with guess-the-move scoring (play through a master game, score each of your guesses against the real move, coach explains the pivot points).
- Custom puzzle sets: build a set from themes or from your own game mistakes, share by link.
- Vision and calculation training: coordinates sprint, blindfold mode, counting exercises (attackers vs defenders), candidate-moves trainer that forces you to list checks/captures/threats before moving.

## Phase 3, Play like a real site (weeks 12 to 22)

Goal: ChessX is also a place you play, with the play systems chess.com players expect.

- Human multiplayer over WebSocket (this sandbox ships a gateway): casual challenge links first (create a game, send a URL, play), then rated pools.
- Rated pool architecture: Glicko-2 with RD and volatility, provisional period of 10 games, separate pools for bullet, blitz, rapid, classical, per-color rating shown honestly, rating deviation drives K-factor so early games move fast and settled games move slow.
- Time controls and clocks: increment, delay, clock UI with low-time warning, flag detection, abort window, takeback policy for casual only, draw offers and agreement, resignation with confirmation.
- Daily (correspondence) chess: multiple days per move, move notifications, vacation mode, daily games count toward your profile like chess.com's daily pool.
- Variants: Chess960 first (castling rules handled by the engine), then King of the Hill and Three-check. Variants get their own casual pool before anything is rated.
- Premove and input polish: premoved moves with instant response feel, right-click arrows and highlights, keyboard piece entry (Nf3 style), board themes and piece styles as user settings.
- Tournaments: bot arenas hourly as the base layer, then human arenas (arena pairing, streak bonuses, berserk), then swiss events with pairing tables.
- Leaderboards: per pool and per tier so beginners compete with beginners, titled-style badges reserved for real achievements.
- Fair play v1: engine correlation heuristics (move match rate vs top engine lines, timing patterns), flag queue for human review, transparent rating protections for suspected accounts. Hard rule: never accuse without a confidence threshold, and every action is reversible on appeal.
- Bot style engine: bots no longer differ only by skill; aggressive bots sac for initiative, defensive bots trade down, endgame bots steer to technique, using contempt and style weights around search. Each of the 14 characters gets an opening book matching its personality.

## Phase 4, Social and community (weeks 22 to 30)

Goal: reasons to stay that are not just ratings.

- Profiles v2: avatar (or your drawn character), bio, stats page per pool, game archive with filters, shareable profile.
- Friends: follow, challenge a friend with one tap, friend activity feed (finished games, puzzle streaks, tier promotions), online status.
- Chat: in-game quick chat first (canned plus free text with profanity filter), then DMs, then club rooms.
- Clubs and study groups: shared PGN studies with comments, coach-posted homework sets, club tournaments, join by link.
- Forums-lite: board categories per tier plus announcements, voting, moderation queue. Forums are the slow-burn community layer, they come after clubs because clubs create the moderators.
- Achievements and missions: honest achievement set (first rated win, 20 puzzle streak, first brilliancy in a report, tier completion), weekly missions tied to the skill model (solve 10 pin puzzles, finish a spaced review session). Nothing invented, everything earned.

## Phase 5, Coach AI v2 (weeks 30 to 38)

Goal: the AI coach becomes the reason people choose ChessX over everything else.

- Coach memory: per-profile long-term memory of recent games, recurring mistake patterns, and lesson history; the coach opens with what matters to you today.
- Position-aware tutoring: the coach can replay your game, pick the pivotal moment, and spin a custom drill from your exact mistake (position + unique-solution line + explanation), generated and validated automatically.
- BYO model parity: every AI feature (report comments, drill generation, coach chat) works identically on built-in and BYO keys, with token budgets shown honestly.
- Voice v2: continuous spoken lessons (coach narrates while you move), ducking of board sounds during speech, per-coach voice tuning, reading speed control, spoken game review ("you missed knight F3, hitting the queen").
- Guardrails: every AI-generated drill validated with chess.js before it touches a student; the coach never invents rules, ratings or claims.

## Phase 6, Watch, broadcast and content (weeks 38 to 46)

Goal: the app is a place to follow chess, not only play it.

- Broadcast follow: live PGN feeds of titled events, move-by-move with delay, coach commentary mode on top of any broadcast.
- Opening explorer: master database plus your own games merged, repertoire overlap reports, position popularity graphs.
- Articles and news: short written form for releases, tier milestones and member stories. Authored inside clubs first, site-wide later.
- Community content pipeline: validated tier submissions through CI (`validate:content` as the gate), revenue share for authors.
- Import anything: chess.com and Lichess game URLs become ChessX reviews; Lichess puzzle DB import (CC0) with theme mapping.

## Phase 7, Platform and reach (months 10 to 14)

Goal: ChessX everywhere, fast, in more languages.

- PWA install with offline lessons and offline puzzle packs (content is local-first, progress syncs when back online).
- Accounts and sync: optional email/passkey accounts, cross-device progress, export everything (your data is yours).
- Postgres migration path behind the Prisma interface when multi-device sync lands; SQLite stays the default for local/self-host.
- Localization: i18n skeleton with the first five languages, TTS voice pools per language.
- Accessibility pass: full keyboard board navigation, screen reader move announcements, reduced-motion mode, color-independent piece distinction.
- Packaging: desktop wrapper first (Tauri), app stores when there is demand.

## The long game (year 2+)

- Live lessons with class rooms: a coach runs a session, students solve in sync, the coach sees attempt rates live.
- Coach marketplace: human coaches assign ChessX tracks to students and see honest telemetry.
- Engine cloud for mobile: heavy analysis offloaded so phones get desktop-grade reports.
- Titled arenas and sponsorship: real prize arenas, the ChessX championship ladder with a final event.

## Quality gates, always on

- Content CI: `bun run validate:content` fails on illegal moves, wrong SAN suffixes, duplicate ids, missing steps, or an em dash anywhere in curriculum copy.
- Lint clean. No fabricated user data, ever. No greeting copy, no em dashes anywhere.
- Sound ceiling: the master limiter makes earrape physically impossible; every new sound is added under the same bus.
- Guidance review: new lesson types must pass the miss-path test: what does a student see and hear on a mistake, and does it guide instead of judge.
- Persistence: every working session ends with committed changes pushed to `WasewaseX/chessx`. If it is not pushed, it does not exist.
- Browser check: feature work is verified with agent-browser against the running dev server before it is called done, the same way Phase 0 boards, lessons and bot games were verified.
