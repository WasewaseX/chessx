// The coach's /command catalog. Client-safe by design: pure metadata, no
// server imports. The server executor (src/lib/server/coach-commands.ts) and
// the chat command palette (src/components/coach/command-palette.tsx) both
// import this, so the UI and the runtime can never drift apart.

export type CommandCategory = 'generate' | 'board' | 'progress' | 'app' | 'fun'

export interface CommandDef {
  /** Executor id, same as the command word without the slash. */
  id: string
  cmd: string
  aliases?: string[]
  /** Short arg hint shown in the palette, like '[theme]' or '[view]'. */
  args?: string
  category: CommandCategory
  title: string
  desc: string
  example?: string
}

export const COMMANDS: CommandDef[] = [
  // generation skills: verified training material
  { id: 'puzzle', cmd: '/puzzle', args: '[theme]', category: 'generate', title: 'Level puzzle', desc: 'Fresh engine-verified puzzle calibrated to your course level', example: '/puzzle fork' },
  { id: 'mate', cmd: '/mate', category: 'generate', title: 'Mate hunt', desc: 'A forced-mate puzzle at your level, every mate checked by the engine', example: '/mate' },
  { id: 'drill', cmd: '/drill', category: 'generate', title: 'Position drill', desc: 'Turn whatever stands on the board into a training task', example: '/drill' },
  { id: 'endgame', cmd: '/endgame', category: 'generate', title: 'Endgame drill', desc: 'A verified endgame technique task from real course material', example: '/endgame' },
  { id: 'quiz', cmd: '/quiz', args: '[theme]', category: 'generate', title: 'Level quiz', desc: 'Multiple-choice quiz question tuned to your level', example: '/quiz pin' },
  { id: 'daily', cmd: '/daily', category: 'generate', title: 'Daily challenge', desc: 'One puzzle plus one quiz, the coach picks the themes', example: '/daily' },
  { id: 'trap', cmd: '/trap', category: 'generate', title: 'Opening trap', desc: 'A classic trap, move by move, and how to avoid falling for it', example: '/trap' },
  { id: 'famous', cmd: '/famous', category: 'generate', title: 'Famous game', desc: 'Walk through a legendary game with commentary on the key moves', example: '/famous' },

  // board skills: the engine reads the position on the practice board
  { id: 'analyze', cmd: '/analyze', category: 'board', title: 'Analyze position', desc: 'Engine evaluation, best line and the key point, in plain words', example: '/analyze' },
  { id: 'best', cmd: '/best', category: 'board', title: 'Best move', desc: "The engine's move here, with a one-line reason", example: '/best' },
  { id: 'hint', cmd: '/hint', category: 'board', title: 'Hint', desc: 'A nudge in the right direction without giving the move away', example: '/hint' },
  { id: 'eval', cmd: '/eval', category: 'board', title: 'Who stands better', desc: 'Material count plus engine verdict for this position', example: '/eval' },
  { id: 'threats', cmd: '/threats', category: 'board', title: 'Opponent threats', desc: 'What the other side would do if it were their move', example: '/threats' },
  { id: 'describe', cmd: '/describe', category: 'board', title: 'Describe position', desc: 'Material, kings, structure: what is on the board in words', example: '/describe' },
  { id: 'moves', cmd: '/moves', category: 'board', title: 'Legal moves', desc: 'Every legal move here, grouped by piece', example: '/moves' },

  // progress skills: your numbers, straight from the app's ledger
  { id: 'recap', cmd: '/recap', category: 'progress', title: 'Progress recap', desc: 'XP, streak, puzzles, games: where you stand right now', example: '/recap' },
  { id: 'weakness', cmd: '/weakness', category: 'progress', title: 'Weakest area', desc: 'Your weakest motif from real results, with a drill suggestion', example: '/weakness' },
  { id: 'next', cmd: '/next', category: 'progress', title: 'Next lesson', desc: 'The next unlocked lesson in the course', example: '/next' },
  { id: 'level', cmd: '/level', category: 'progress', title: 'Level info', desc: 'Your current course level and what it covers', example: '/level' },

  // app control: the coach drives the app
  { id: 'flip', cmd: '/flip', category: 'app', title: 'Flip board', desc: 'Turn the board around', example: '/flip' },
  { id: 'reset', cmd: '/reset', category: 'app', title: 'Reset board', desc: 'Back to the starting position', example: '/reset' },
  { id: 'goto', cmd: '/goto', args: '[view]', category: 'app', title: 'Go to section', desc: 'Jump to home, play, lessons, puzzles, review, coach, analysis, profile or settings', example: '/goto puzzles' },
  { id: 'newgame', cmd: '/newgame', category: 'app', title: 'New game', desc: 'Open the play screen and pick a bot', example: '/newgame' },
  { id: 'dark', cmd: '/dark', category: 'app', title: 'Toggle dark mode', desc: 'Switch the app between light and dark', example: '/dark' },
  { id: 'coach', cmd: '/coach', args: '[name]', category: 'app', title: 'Switch coach', desc: 'Nina, Victor, Elena or Sasha takes over the chat', example: '/coach victor' },
  { id: 'help', cmd: '/help', category: 'app', title: 'All skills', desc: 'Every command the coach knows', example: '/help' },

  // fun skills: short, human, chess-flavored
  { id: 'joke', cmd: '/joke', category: 'fun', title: 'Chess joke', desc: 'A quick chess joke', example: '/joke' },
  { id: 'quote', cmd: '/quote', category: 'fun', title: 'Chess quote', desc: 'Words from the greats', example: '/quote' },
  { id: 'vocab', cmd: '/vocab', args: '[term]', category: 'fun', title: 'Chess term', desc: 'What a chess word means (zugzwang, fianchetto, en passant...)', example: '/vocab zugzwang' },
  { id: 'rules', cmd: '/rules', args: '[topic]', category: 'fun', title: 'Rules answer', desc: 'Castling, en passant, stalemate and friends, explained', example: '/rules castling' },
]

export const COMMAND_CATEGORIES: { id: CommandCategory; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'board', label: 'Board' },
  { id: 'progress', label: 'Progress' },
  { id: 'app', label: 'App' },
  { id: 'fun', label: 'Fun' },
]

/** An app-control action the coach can execute in the UI. Shared by the
 * server router and the client executor, so the shapes can never drift. */
export type CoachAction =
  | { type: 'flip_board' }
  | { type: 'reset_board' }
  | { type: 'goto'; view: string }
  | { type: 'switch_coach'; coachId: string }
  | { type: 'toggle_dark' }
  | { type: 'toggle_sound' }

const byWord = new Map<string, CommandDef>()
for (const c of COMMANDS) {
  byWord.set(c.cmd, c)
  for (const a of c.aliases ?? []) byWord.set(a, c)
}

/** Match a message that starts with a /command. Returns the command and the
 * rest of the line as free-text args. */
export function parseClientCommand(text: string): { def: CommandDef; arg: string } | null {
  const t = text.trim()
  if (!t.startsWith('/')) return null
  const space = t.search(/\s/)
  const word = space === -1 ? t : t.slice(0, space)
  const def = byWord.get(word.toLowerCase())
  if (!def) return null
  return { def, arg: space === -1 ? '' : t.slice(space + 1).trim() }
}

/** Commands that spend a generation slot (rate limited together with chat-triggered skills). */
export function commandIsGenerative(id: string): boolean {
  return ['puzzle', 'mate', 'drill', 'endgame', 'quiz', 'daily', 'trap', 'famous'].includes(id)
}

/** All command words that start with the given fragment (used by the palette). */
export function matchingCommands(fragment: string): CommandDef[] {
  const f = fragment.trim().toLowerCase()
  if (!f) return COMMANDS
  return COMMANDS.filter((c) => c.cmd.startsWith(f) || (c.aliases ?? []).some((a) => a.startsWith(f)))
}
