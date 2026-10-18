// Sparring persona layer over the engine bots (src/lib/chess/bots.ts).
// The bots' names, faces and engine strength live in BOTS and stay untouched:
// GameRecord rows store the bot NAME, so the roster maps one-to-one onto the
// existing characters instead of renaming anything. This file adds the
// characterful ladder skin: a flavor line, a play-style tag, the Elo badge and
// the blunder-prone flag, plus after-game title cards and per-bot progress.

import { BOTS, type Bot } from '@/lib/chess/bots'

export type SparringStyle = 'solid' | 'aggressive' | 'tricky' | 'positional' | 'chaotic'

export interface SparringPersona {
  level: number
  /** bot character id (face), same as BOTS */
  id: string
  /** the bot's real name — matches GameRecord.botName, never renamed here */
  name: string
  /** one-line flavor, max six words */
  flavor: string
  /** Elo badge: the bot's existing fixed strength, monotonic down the ladder */
  elo: number
  style: SparringStyle
  /** levels 1-6 play human-like: the engine noise param (bot.blunder) is surfaced, never changed */
  blunderProne: boolean
  /** the real engine noise probability this persona rides on (0 = cleaned up) */
  noiseChance: number
}

// One flavor line per existing bot. Original text, mapped from each bot's real
// playing character so the card never contradicts how the engine behaves.
const FLAVORS: Record<string, string> = {
  pip: 'Pure vibes, zero plan.',
  maple: 'Hoards pawns like jam jars.',
  squire: 'Charges first, thinks later.',
  rex: 'All bark, all attack.',
  sentry: 'Never attacks, never misses.',
  vanguard: 'Textbook play, page by page.',
  fortress: 'Builds walls, waits, wins.',
  torch: 'Plays every move on fire.',
  cornerstone: 'Grinds small edges into wins.',
  tactician: 'Forks, pins, skewers, repeat.',
  strategist: 'Strangles squares, not pieces.',
  nyx: 'Says nothing. Sees everything.',
  grandmaster: 'Ends careers, politely.',
  titan: 'Technique cold as stone.',
  maximum: 'Precision without a pulse.',
}

// Style tags mapped from each bot's documented behavior (and its aggression
// parameter where it has one). Levels 1-6 are blunder-prone per the ladder
// design: their engine noise keeps games human and winnable.
const STYLES: Record<string, SparringStyle> = {
  pip: 'chaotic',
  maple: 'tricky',
  squire: 'aggressive',
  rex: 'aggressive',
  sentry: 'solid',
  vanguard: 'solid',
  fortress: 'positional',
  torch: 'aggressive',
  cornerstone: 'positional',
  tactician: 'tricky',
  strategist: 'positional',
  nyx: 'tricky',
  grandmaster: 'positional',
  titan: 'solid',
  maximum: 'solid',
}

/** The full roster, one persona per existing bot, in ladder order. */
export const SPARRING_ROSTER: SparringPersona[] = BOTS.map((bot) => ({
  level: bot.level,
  id: bot.id,
  name: bot.name,
  flavor: FLAVORS[bot.id] ?? bot.description,
  elo: bot.rating,
  style: STYLES[bot.id] ?? 'solid',
  blunderProne: bot.level <= 6,
  noiseChance: bot.blunder,
}))

export function personaForLevel(level: number): SparringPersona | undefined {
  return SPARRING_ROSTER.find((p) => p.level === level)
}

export function personaForBot(bot: Bot): SparringPersona {
  return personaForLevel(bot.level) ?? {
    level: bot.level,
    id: bot.id,
    name: bot.name,
    flavor: bot.description,
    elo: bot.rating,
    style: 'solid',
    blunderProne: bot.level <= 6,
    noiseChance: bot.blunder,
  }
}

/* ---------------------------------------------------------------------------
 * Title cards: the after-game flavor line shown in the result dialog, keyed
 * by outcome and how the game ended. Three variants each so rematches do not
 * repeat the same line. Player perspective, original text.
 * ------------------------------------------------------------------------- */

export type TitleCardKey = 'win-checkmate' | 'win-time' | 'win-resignation' | 'loss' | 'draw'

const TITLE_CARDS: Record<TitleCardKey, string[]> = {
  'win-checkmate': ['Checkmate. The king knows.', 'Mated clean, no rematch clauses.', 'The last move said everything.'],
  'win-time': ['Flagged. The clock takes it.', 'Out of time, out of luck.', 'The clock struck the final blow.'],
  'win-resignation': ['The king was tipped early.', 'Resigned. No argument here.', 'The handshake came a bit soon.'],
  loss: ['Outplayed, not outdone.', 'That stings. Run it back.', 'Consider the lesson free of charge.'],
  draw: ['Honors even today.', 'Nobody blinked.', 'The point was split, not lost.'],
}

const lastTitleRef: { key: TitleCardKey | null; line: string | null } = { key: null, line: null }

/** Picks a title card for how the game ended, avoiding an immediate repeat. */
export function titleCardFor(result: 'win' | 'loss' | 'draw', reason: string): string {
  let key: TitleCardKey
  if (result === 'win') {
    if (/time|flag/i.test(reason)) key = 'win-time'
    else if (/checkmate/i.test(reason)) key = 'win-checkmate'
    else key = 'win-resignation'
  } else if (result === 'loss') {
    key = 'loss'
  } else {
    key = 'draw'
  }
  const lines = TITLE_CARDS[key]
  let line = lines[Math.floor(Math.random() * lines.length)]
  if (key === lastTitleRef.key && line === lastTitleRef.line && lines.length > 1) {
    line = lines[(lines.indexOf(line) + 1) % lines.length]
  }
  lastTitleRef.key = key
  lastTitleRef.line = line
  return line
}

/* ---------------------------------------------------------------------------
 * Progress: computed from the player's real GameRecord rows (the games
 * endpoint already returns them). Nothing in the lobby is gated today and
 * nothing becomes gated here: every bot stays freely playable, and progress
 * rides along as badges on the persona cards.
 * ------------------------------------------------------------------------- */

/** Minimal shape the games endpoint provides for one finished bot game. */
export interface SparringGameRow {
  result: string // 'win' | 'loss' | 'draw'
}

export interface BotProgress {
  wins: number
  losses: number
  draws: number
  played: number
  /** Always true today: the lobby has never locked bots, so it never will here. */
  unlocked: boolean
}

/** Aggregates the real rows recorded against this bot's name. */
export function progressFor(_level: number, games: ReadonlyArray<SparringGameRow>): BotProgress {
  const wins = games.filter((g) => g.result === 'win').length
  const losses = games.filter((g) => g.result === 'loss').length
  const draws = games.filter((g) => g.result === 'draw').length
  return { wins, losses, draws, played: games.length, unlocked: true }
}

/**
 * The natural next step on the ladder: the lowest level with no games whose
 * predecessor already has at least one (the old unlock rule, expressed as a
 * badge instead of a lock). Null when nothing qualifies.
 */
export function nextUpLevel(rows: ReadonlyArray<SparringGameRow & { botName?: string }>): number | null {
  const playedByLevel = new Map<number, number>()
  for (const row of rows) {
    const persona = SPARRING_ROSTER.find((p) => p.name === row.botName)
    if (!persona) continue
    playedByLevel.set(persona.level, (playedByLevel.get(persona.level) ?? 0) + 1)
  }
  for (const persona of SPARRING_ROSTER) {
    if ((playedByLevel.get(persona.level) ?? 0) > 0) continue
    if (persona.level === 1) return persona.level
    const prev = persona.level - 1
    if ((playedByLevel.get(prev) ?? 0) >= 1) return persona.level
  }
  return null
}
