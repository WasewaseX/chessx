// The coach's hands: deterministic routing and execution for everything the
// student can ask without an LLM in the loop. /commands, greetings, app
// actions and obvious generation requests are handled here, so "hi" can never
// come back as a puzzle and "flip the board" always flips the board.
//
// Natural conversation still goes to the configured model; this module only
// claims what it can answer with certainty: engine facts, app data, verified
// lines and a small curated library of traps, games, jokes, quotes and rules.
import 'server-only'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { runChat, type AiConfig } from '@/lib/ai'
import { COACHES, type Coach } from '@/lib/coaches'
import { analyze } from '@/lib/server/engine'
import { describeFen } from '@/lib/server/chess-describe'
import { craftWinningLine } from '@/lib/server/craft'
import { CONCEPTS } from '@/content/schema'
import { findLevel } from '@/content/levels'
import { nextUnlockedId } from '@/lib/unlock'
import { levelRating, artifactFromRow, type ArtifactView, type LineStep } from '@/lib/coach-artifacts'
import { COMMANDS, parseClientCommand, type CoachAction, type CommandDef } from '@/lib/coach-commands-catalog'
import { resolveLevelContext, runSkill, verifyLine, writeCopy, checkRateLimit, SkillError, type SkillId } from '@/lib/server/coach-skills'
import { memoryHook } from '@/lib/server/coach-memory'
import { dayKeyLocal } from '@/lib/day'

// ---------------------------------------------------------------------------
// Outcomes and actions
// ---------------------------------------------------------------------------

export type { CoachAction }

export interface CommandOutcome {
  content: string
  artifacts?: ArtifactView[]
  action?: CoachAction
}

export interface CommandRequest {
  message: string
  cfg: AiConfig
  profile: { id: string; name: string; skillLevel: string; coach: string; darkMode: string; soundEnabled: boolean }
  ctx: { fen?: unknown; tier?: unknown; level?: unknown; theme?: unknown }
  coach: Coach
  /** Route-injected generation: handles rate limits and SkillError → throws upward. */
  runGeneration: (skill: SkillId, theme?: unknown) => Promise<ArtifactView>
}

const VIEWS = ['home', 'play', 'lessons', 'lesson', 'puzzles', 'review', 'coach', 'analysis', 'profile', 'settings']

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function materialCount(fen: string): { w: number; b: number } {
  let w = 0
  let b = 0
  try {
    const g = new Chess(fen)
    const val: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq) continue
        const v = val[sq.type] ?? 0
        if (sq.color === 'w') w += v
        else b += v
      }
    }
  } catch {
    /* a broken FEN counts as level material */
  }
  return { w, b }
}

function pawnCount(fen: string): { w: number; b: number } {
  const placement = fen.split(' ')[0] ?? ''
  const w = (placement.match(/[P]/g) ?? []).length
  const b = (placement.match(/[p]/g) ?? []).length
  return { w, b }
}

function fmtPawns(cp: number): string {
  const p = cp / 100
  return `${p > 0 ? '+' : p < 0 ? '' : ''}${p.toFixed(2)}`
}

/** UCI principal variation to numbered SAN text like "1. Nf3 d5 2. c4 e6". */
function pvToSanText(fen: string, pv: string[], maxPlies = 6): string {
  const g = new Chess(fen)
  const startMove = Number(fen.split(' ')[5] ?? 1)
  const sans: string[] = []
  for (let i = 0; i < Math.min(pv.length, maxPlies); i++) {
    try {
      const mv = g.move({ from: pv[i].slice(0, 2), to: pv[i].slice(2, 4), promotion: pv[i].slice(4, 5) || undefined })
      if (!mv) break
      sans.push(mv.san)
    } catch {
      break
    }
  }
  const sideWhite = (fen.split(' ')[1] ?? 'w') === 'w'
  const out: string[] = []
  let n = startMove
  let whiteToMove = sideWhite
  for (const san of sans) {
    if (whiteToMove) out.push(`${n}.`)
    out.push(san)
    if (!whiteToMove) n++
    whiteToMove = !whiteToMove
  }
  return out.join(' ')
}

/** A pass-the-turn FEN so the engine answers "what does the opponent want". */
function swapTurn(fen: string): string | null {
  const f = fen.split(' ')
  if (f.length < 4) return null
  f[1] = f[1] === 'w' ? 'b' : 'w'
  f[3] = '-'
  return f.join(' ')
}

function classifyMove(fen: string, san: string): string {
  const g = new Chess(fen)
  try {
    const mv = g.move(san)
    if (!mv) return ''
    const bits: string[] = []
    if (mv.san.endsWith('#')) bits.push('it is mate')
    else if (mv.san.endsWith('+')) bits.push('it gives check')
    if (mv.captured) bits.push(`it wins the ${describePiece(mv.captured)} on ${mv.to}`)
    if (mv.promotion) bits.push(`the pawn becomes a ${describePiece(mv.promotion)}`)
    if (mv.san.startsWith('O-O')) bits.push('the king tucks away to safety')
    return bits.join(' and ')
  } catch {
    return ''
  }
}

function describePiece(t: string): string {
  return { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[t] ?? t
}

const NO_FEN = 'Set up a position first: move some pieces on the board (or paste a FEN), then run that command. It reads the exact position in front of you.'

// ---------------------------------------------------------------------------
// Intent detection (all deterministic, order matters)
// ---------------------------------------------------------------------------

const GEN_NOUN_RE = /\b(puzzles?|quiz(zes)?|drill|problem|exercise|challenge|tactics?|mate|checkmate|endgame)\b/i
const GEN_VERB_RE =
  /\b(give|make|generate|create|build|send|show|bring|hand|want|need|try|test|train|practice|challenge|solve|another|new|more|fresh|quiz)\b/i
const BARE_GEN_RE = /^(puzzle|quiz|drill|mate|endgame)( me| please| now)?[!?. ]*$/i
const IMPERATIVE_RE = /\b(test me|train me|challenge me|quiz me|practice)\b/i

/** True when the student's message asks for training material. Used both for
 * direct routing and for gating skill blocks the model tries to emit. */
export function hasGenerationIntent(text: string): boolean {
  const t = text.trim()
  if (BARE_GEN_RE.test(t) || IMPERATIVE_RE.test(t)) return true
  if (!GEN_NOUN_RE.test(t)) return false
  if (/\b(page|screen|section|tab|list)\b/i.test(t)) return false
  if (GEN_VERB_RE.test(t)) return true
  // "a puzzle please", "puzzle?" and other short noun-led asks
  const words = t.split(/\s+/).length
  return words <= 5
}

/** Map the message onto one concrete skill when it is unambiguous. */
function directGenRoute(text: string): { skill: SkillId | 'pivot'; theme?: string } | null {
  const t = text.toLowerCase()
  if (!hasGenerationIntent(t)) return null
  const longQuestion = t.length > 90 && t.includes('?')
  if (longQuestion) return null // let the model handle multi-part asks
  if (
    /\bpivot\b/.test(t) ||
    (/\b(worst|biggest)\b/.test(t) && /\b(mistake|blunder)\b/.test(t)) ||
    (/\bdrill\b/.test(t) && /\b(mistake|blunder|last game|my game|worst|last)\b/.test(t))
  ) {
    return { skill: 'pivot' }
  }
  if (/\b(quiz|test me)\b/.test(t)) return { skill: 'level_quiz', theme: extractTheme(t) }
  if (/\bdrill\b/.test(t)) return { skill: 'position_drill' }
  if (/\b(endgame)\b/.test(t)) return { skill: 'endgame_drill' }
  if (/\b(mate|checkmate)\b/.test(t)) return { skill: 'mate_hunt' }
  if (/\b(puzzle|problem|exercise|challenge|tactic|practice|train)\b/.test(t)) {
    return { skill: 'level_puzzle', theme: extractTheme(t) }
  }
  return { skill: 'level_puzzle', theme: extractTheme(t) }
}

const THEME_WORDS: Record<string, string> = {
  fork: 'fork', forks: 'fork', pin: 'pin', pins: 'pin', skewer: 'skewer', skewers: 'skewer',
  mate: 'mate', mates: 'mate', matein1: 'mate', checkmate: 'mate', promotion: 'promotion',
  endgame: 'endgame', sacrifice: 'sacrifice', defense: 'defense', defence: 'defense',
  discovered: 'discoveredAttack', zwischenzug: 'calculation', structure: 'pawnStructure',
  development: 'development', center: 'center', centre: 'center', castling: 'castlingSafety',
}

function extractTheme(text: string): string | undefined {
  for (const [word, theme] of Object.entries(THEME_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text) && (CONCEPTS as readonly string[]).includes(theme)) return theme
  }
  return undefined
}

export type SocialIntent = 'greeting' | 'identity' | 'thanks' | 'bye'

export function socialIntent(text: string): SocialIntent | null {
  const t = text.trim().toLowerCase()
  const words = t.split(/\s+/).length
  if (
    words <= 5 &&
    /^(hi+|hey+|hello+|yo|sup|hiya|heya|howdy|hello there|good ?(morning|afternoon|evening|day)|gm|gn|hola|namaste|salam)[\s!,.?]*(coach|nina|victor|elena|sasha)?[\s!,.?]*$/.test(t)
  ) {
    return 'greeting'
  }
  if (/\b(who are you|what can you do|what do you do|what are you|how do you work|your name)\b/.test(t)) return 'identity'
  if (words <= 3 && /^(thanks?|thank you|thx|ty|tyvm|appreciate it|cheers|nice|great|cool|awesome|perfect|amazing)[\s!,.?]*$/.test(t)) return 'thanks'
  if (words <= 4 && /^(bye|goodbye|good night|gn|see you|see ya|later|cya|take care)[\s!,.?]*$/.test(t)) return 'bye'
  return null
}

export function actionIntent(text: string): CoachAction | null {
  const t = text.trim().toLowerCase()
  if (t.startsWith('/')) return null // commands handle themselves
  if (/\b(flip|turn|rotate|swap|switch)\b/.test(t) && /\b(board|sides?|white|black|orientation|perspective|colors?|colours?)\b/.test(t)) {
    return { type: 'flip_board' }
  }
  if (/^(flip)[\s!.?]*$/.test(t)) return { type: 'flip_board' }
  if (/\b(reset|clear|restart|new)\b/.test(t) && /\bboard\b/.test(t)) return { type: 'reset_board' }
  if (/\b(dark mode|night mode|light mode|dark theme|light theme)\b/.test(t) || /^(dark|light)[\s!.?]*$/.test(t)) {
    return { type: 'toggle_dark' }
  }
  if (/\b(mute|unmute|sound on|sound off|toggle sound)\b/.test(t)) return { type: 'toggle_sound' }
  if (/\b(new game|play a game|start a game|play against a bot|lets play|let's play)\b/.test(t)) {
    return { type: 'goto', view: 'play' }
  }
  if (/\b(show|how|open|see)\b/.test(t) && /\b(my )?(progress|stats|statistics)\b/.test(t)) return { type: 'goto', view: 'progress-recap' }
  const goto = gotoIntent(t)
  return goto
}

/** Engine questions in plain words: anything explicitly asking for the best
 * move, an evaluation, threats, a hint, a description or a legal-move list
 * deserves the ENGINE's answer, not a model guess. Returns the board command
 * id, or null for genuine conversation. */
export function engineQuestionRoute(text: string): string | null {
  const t = text.trim().toLowerCase()
  if (t.startsWith('/')) return null
  if (/\bhint\b|\bnudge me\b|\bhelp me find(?! the word)\b/.test(t)) return 'hint'
  if (/\bbest move\b|\bwhat('s| is| should)( the)? best\b|\bwhat would you play\b|\bwhat do i play\b|\bwhat to play\b|\bwhich move\b/.test(t)) return 'best'
  if (/\bwho('s| is| has)? ?(winning|better|ahead|standing)\b|\beval(uation)?\b|\bhow (good|bad) is (my|the|this) position\b/.test(t)) return 'eval'
  if (/\bthreat(s|ened)?\b|\bwhat is (he|she|they|the opponent|black|white) (going|planning|threatening)\b|\bam i in danger\b/.test(t)) return 'threats'
  if (/\banaly[sz]e\b|\bassess\b|\bbreak(ing)? (this|the) (position|down)\b/.test(t)) return 'analyze'
  if (/\bdescribe (the|this) position\b|\bwhat('s| is) on the board\b|\bmaterial count\b/.test(t)) return 'describe'
  if (/\blegal moves\b|\bwhat moves (can|do) i (have|play)\b|\blist.*moves\b/.test(t)) return 'moves'
  return null
}

function gotoIntent(t: string): CoachAction | null {
  const m = t.match(/\b(go to|goto|jump to|open|take me to|show me the)\b([^!?.;]*)/i)
  if (!m) return null
  const rest = m[2]
  const map: [RegExp, string][] = [
    [/\blessons?\b|\bcourse\b/, 'lessons'],
    [/\bpuzzles?\b/, 'puzzles'],
    [/\b(game review|review)\b|\banalysis\b/, 'analysis'],
    [/\bcoach\b/, 'coach'],
    [/\bsettings?\b/, 'settings'],
    [/\bprofile\b|\baccount\b/, 'profile'],
    [/\bhome\b|\bmain\b/, 'home'],
    [/\bplay\b|\bbots?\b|\bgame\b/, 'play'],
  ]
  for (const [re, view] of map) {
    if (re.test(rest) && VIEWS.includes(view)) return { type: 'goto', view }
  }
  return null
}

// ---------------------------------------------------------------------------
// Persona-flavored lead-ins and social replies
// ---------------------------------------------------------------------------

const LEAD: Record<string, string[]> = {
  puzzle: ['Fresh one, calibrated to your level.', 'Here is a new one for you.', 'Straight from the engine, verified. Your move.'],
  mate: ['Mate is hiding in there. Find it.', 'A forced mate, engine-checked. Hunt it down.'],
  endgame: ['Endgame technique, verified move by move.', 'A clean endgame task for you.'],
  drill: ['Built from your position, every move verified.', 'Your position, now a training task.'],
  quiz: ['Quick quiz, tuned to your level.', 'Test yourself on this one.'],
  daily: ['Your daily challenge is ready: one puzzle, one quiz.', 'Today is up: two tasks, both verified.'],
  trap: ['A classic trap, move by move.', 'Old trap, still catching people.'],
  famous: ['One for the ages. Walk through it with me.', 'A legendary game, key moves flagged.'],
}

function leadIn(kind: string): string {
  return pick(LEAD[kind] ?? LEAD.puzzle)
}

function greetingReply(coach: Coach, name: string): string {
  const who = name || 'friend'
  const lines: Record<string, string[]> = {
    nina: [
      `Hey ${who}! Good to see you. Want a puzzle at your level? Just ask, or type / to see everything I can do.`,
      `Hi ${who}! Ready when you are. I can generate puzzles, drills and quizzes, or read the board in front of you. Type / for the full list.`,
    ],
    victor: [
      `There ${who} is. Checks, captures, threats: want to train them? Type / for my whole toolbox.`,
      `Hey ${who}. Sharp mind, fresh puzzle? Say the word or type /.`,
    ],
    elena: [
      `Hello ${who}. Sit down at the board. We can study a plan, generate training, or just talk chess. Type / to see my skills.`,
      `Good to see you, ${who}. Position on the board? Ask me anything, or type / for commands.`,
    ],
    sasha: [
      `${who}. Punctual. Shall we work? Type / to see what I can generate and control.`,
      `Welcome back, ${who}. High standards today too, I hope. Type / for the command list.`,
    ],
  }
  return pick(lines[coach.id] ?? lines.nina)
}

function identityReply(coach: Coach): string {
  return [
    `I am ${coach.name}, your coach inside ChessX. I talk chess with you, read whatever position is on the board, and I can generate verified training material or drive the app itself.`,
    'Type / (slash) in the box below and you get my whole command list: /puzzle and /mate for training, /analyze and /threats for the board, /recap and /weakness for your progress, even /flip to turn the board around.',
    'No command needed though. Ask in plain words and I will figure out what you mean.',
  ].join('\n')
}

function thanksReply(coach: Coach): string {
  return pick([
    'Anytime. The board is always here.',
    'That is what I am for. Next one when you are ready.',
    'Good work today. Say the word when you want more.',
  ])
}

function byeReply(coach: Coach): string {
  return pick(['See you at the board.', 'Rest well. The tactics will wait.', 'Good session. Come back sharp.'])
}

// ---------------------------------------------------------------------------
// Board skills (engine-backed, deterministic copy)
// ---------------------------------------------------------------------------

function evalVerdict(cpForMover: number): string {
  const a = Math.abs(cpForMover)
  if (a >= 900) return 'this is close to decisive'
  if (a >= 250) return 'a clear advantage'
  if (a >= 80) return 'a small but real edge'
  if (a >= 25) return 'a slight pull'
  return 'practically balanced'
}

async function boardAnalyze(req: CommandRequest): Promise<CommandOutcome> {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse as a legal position. Reset the board and try again.' }
  }
  if (game.isGameOver()) {
    return {
      content: game.isCheckmate()
        ? `The game on the board is over: ${game.turn() === 'w' ? 'Black' : 'White'} delivered mate. Reset and set up the next one.`
        : 'The position on the board is already a dead draw. Set up something livelier.',
    }
  }
  const a = await analyze(fen, 3)
  if (!a) return { content: 'The engine could not start right now, so I cannot give verified numbers. Try again in a moment.' }
  const mover = game.turn() === 'w' ? 'White' : 'Black'
  const other = game.turn() === 'w' ? 'Black' : 'White'
  const mateIn = a.bestScore >= 99_000 ? Math.ceil((100_000 - a.bestScore) / 100) : null
  const lines: string[] = []
  if (mateIn) lines.push(`Forced mate for ${mover} in ${mateIn}.`)
  else lines.push(`Evaluation: ${fmtPawns(a.bestScore)} from ${mover}'s side, which means ${evalVerdict(a.bestScore)}.`)
  const lineText = pvToSanText(fen, a.pv, 6)
  if (lineText) lines.push(`Best line: ${lineText}.`)
  if (a.secondScore != null && !mateIn) {
    const gap = a.bestScore - a.secondScore
    if (gap >= 200) lines.push('One move stands clearly above the rest here; almost anything else gives back the edge.')
    else if (gap <= 30) lines.push('Several moves keep the balance; the position is flexible, not razor sharp.')
  }
  const { w, b } = materialCount(fen)
  if (w !== b) lines.push(`Material: ${w === b ? 'level' : w > b ? `White +${w - b}` : `Black +${b - w}`}.`)
  return { content: lines.join(' ') }
}

async function boardBest(req: CommandRequest): Promise<CommandOutcome> {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset the board and try again.' }
  }
  if (game.isGameOver()) return { content: 'The position on the board is already decided. Set up the next one.' }
  const a = await analyze(fen, 2)
  if (!a) return { content: 'The engine is unavailable right now, so I cannot verify a best move. Try again shortly.' }
  const g = new Chess(fen)
  const mv = (() => {
    try {
      return g.move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best.slice(4, 5) || undefined })
    } catch {
      return null
    }
  })()
  if (!mv) return { content: 'The engine suggested something odd and I will not pass it on unverified. Try again.' }
  const why = classifyMove(fen, mv.san)
  const gap = a.secondScore != null ? a.bestScore - a.secondScore : null
  const parts = [`${mv.san} is the move.`]
  if (why) parts.push(why.replace(/^it/, 'It') + '.')
  if (gap != null && gap >= 200) parts.push('The gap to the second-best move is big, so this is basically the only move that keeps the advantage.')
  else if (gap != null && gap < 30) parts.push('Two or three moves are close here, so temperament matters less than the plan.')
  return { content: parts.join(' ') }
}

async function boardHint(req: CommandRequest): Promise<CommandOutcome> {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset and try again.' }
  }
  if (game.isGameOver()) return { content: 'This one is already over. Set up the next position.' }
  const a = await analyze(fen, 2)
  if (!a) return { content: 'The engine is not answering right now, so no verified hint this second. Try again in a moment.' }
  const g = new Chess(fen)
  let piece = 'piece'
  try {
    const mv = g.move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best.slice(4, 5) || undefined })
    if (mv) piece = describePiece(mv.piece)
  } catch {
    /* keep the generic piece word */
  }
  const mateIn = a.bestScore >= 99_000 ? Math.ceil((100_000 - a.bestScore) / 100) : null
  if (mateIn) {
    return { content: `There is something forced here. It ends in mate in ${mateIn}: look at every check you have, in order.` }
  }
  const gap = a.secondScore != null ? a.bestScore - a.secondScore : null
  const sharp = gap != null && gap >= 150
  return {
    content: sharp
      ? `One of your pieces is doing something strong. Look closely at your ${piece}, and count what it attacks after it moves.`
      : `Nothing flashy here. Ask what your ${piece} and your worst-placed piece each want, then compare. The position rewards a small improvement.`,
  }
}

async function boardEval(req: CommandRequest): Promise<CommandOutcome> {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset and try again.' }
  }
  if (game.isGameOver()) return { content: 'This position is already decided. Set up the next one.' }
  const a = await analyze(fen, 1)
  if (!a) return { content: 'The engine is unavailable right now. Try again shortly.' }
  const { w, b } = materialCount(fen)
  const { w: wp, b: bp } = pawnCount(fen)
  const moverWhite = game.turn() === 'w'
  const moverScore = moverWhite ? a.bestScore : -a.bestScore
  const mover = moverWhite ? 'White' : 'Black'
  const parts: string[] = []
  parts.push(
    w === b
      ? 'Material is level.'
      : w > b
        ? `White is up ${w - b} point${w - b === 1 ? '' : 's'} of material.`
        : `Black is up ${b - w} point${b - w === 1 ? '' : 's'} of material.`,
  )
  if (wp !== bp) parts.push(`Pawns: ${wp} against ${bp}.`)
  const mateLine = mateScoreText(a.bestScore, mover)
  if (mateLine) parts.push(mateLine)
  parts.push(
    Math.abs(a.bestScore) < 40
      ? 'The engine calls it close to equal: the plan matters more than the evaluation.'
      : `${mover} has ${evalVerdict(a.bestScore)} with the move.`,
  )
  return { content: parts.join(' ') }
}

function mateScoreText(cp: number, mover: string): string | null {
  if (cp >= 99_000) return `There is a forced mate for ${mover} in ${Math.ceil((100_000 - cp) / 100)}.`
  if (cp <= -99_000) return `${mover} is getting mated in ${Math.ceil((100_000 + cp) / 100)}.`
  return null
}

async function boardThreats(req: CommandRequest): Promise<CommandOutcome> {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset and try again.' }
  }
  if (game.isGameOver()) return { content: 'This position is already decided. Set up the next one.' }
  if (game.isCheck()) {
    return { content: 'You are in check right now, so there is nothing to predict: deal with the check first. Run /best if you want the move.' }
  }
  const swapped = swapTurn(fen)
  if (!swapped) return { content: 'I could not read that position cleanly. Try again.' }
  const a = await analyze(swapped, 2)
  if (!a) return { content: 'The engine is unavailable right now. Try again shortly.' }
  const g = new Chess(swapped)
  const mv = (() => {
    try {
      return g.move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best.slice(4, 5) || undefined })
    } catch {
      return null
    }
  })()
  if (!mv) return { content: 'I could not verify a threat cleanly. Try again.' }
  const opponent = game.turn() === 'w' ? 'Black' : 'White'
  const severity = Math.abs(a.bestScore) >= 250 ? 'a real problem' : Math.abs(a.bestScore) >= 80 ? 'uncomfortable' : 'mild'
  const why = classifyMove(swapped, mv.san)
  const parts = [`If it were ${opponent}'s move, ${mv.san} is the idea, and that would be ${severity} for you.`]
  if (why) parts.push(`It works because ${why}.`)
  parts.push('Your turn to move changes things, so either stop that idea or make it irrelevant.')
  return { content: parts.join(' ') }
}

function boardDescribe(req: CommandRequest): CommandOutcome {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset and try again.' }
  }
  const { w, b } = materialCount(fen)
  const { w: wp, b: bp } = pawnCount(fen)
  const turn = game.turn() === 'w' ? 'White' : 'Black'
  const rights: string[] = []
  const castling = fen.split(' ')[2] ?? '-'
  if (castling.includes('K')) rights.push('White can still castle kingside')
  if (castling.includes('Q')) rights.push('White can still castle queenside')
  if (castling.includes('k')) rights.push('Black can still castle kingside')
  if (castling.includes('q')) rights.push('Black can still castle queenside')
  const parts: string[] = []
  parts.push(
    w === b
      ? `Material is fully level (${w} against ${w} points).`
      : w > b
        ? `White holds a ${w - b}-point material edge.`
        : `Black holds a ${b - w}-point material edge.`,
  )
  if (wp !== bp) parts.push(`The pawn count is ${wp} against ${bp}.`)
  if (rights.length) parts.push(`${rights.join('; ')}.`)
  else parts.push('Neither side can castle anymore.')
  const detail = describeFen(fen)
  parts.push(`It is ${turn} to move.`)
  if (detail) parts.push('The full piece list is below, square by square.')
  return { content: parts.join(' ') + (detail ? `\n\n${detail}` : '') }
}

function boardMoves(req: CommandRequest): CommandOutcome {
  const fen = typeof req.ctx.fen === 'string' ? req.ctx.fen : ''
  if (!fen) return { content: NO_FEN }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { content: 'That board position did not parse. Reset and try again.' }
  }
  if (game.isGameOver()) return { content: 'No legal moves left: this position is already decided.' }
  const verbose = game.moves({ verbose: true })
  const groups = new Map<string, string[]>()
  for (const mv of verbose) {
    const key = describePiece(mv.piece)
    const arr = groups.get(key) ?? []
    arr.push(mv.san)
    groups.set(key, arr)
  }
  const order = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']
  const lines: string[] = []
  for (const key of order) {
    const sans = groups.get(key)
    if (!sans?.length) continue
    lines.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${sans.slice(0, 20).join(', ')}${sans.length > 20 ? ' ...' : ''}`)
  }
  return { content: `${verbose.length} legal move${verbose.length === 1 ? '' : 's'} here:\n${lines.join('\n')}` }
}

// ---------------------------------------------------------------------------
// Progress skills (app data, straight from the ledger)
// ---------------------------------------------------------------------------

async function progressRecap(req: CommandRequest): Promise<CommandOutcome> {
  const p = await db.profile.findUnique({ where: { id: req.profile.id } })
  if (!p) return { content: 'I could not read your profile just now. Try again in a moment.' }
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [days, games, lessons] = await Promise.all([
    db.activityDay.findMany({ where: { profileId: p.id }, orderBy: { dayKey: 'desc' }, take: 30 }),
    db.gameRecord.count({ where: { profileId: p.id, createdAt: { gte: weekAgo } } }),
    db.lessonProgress.findMany({ where: { profileId: p.id, completed: true } }),
  ])
  const minutes = days.slice(0, 7).reduce((n, d) => n + d.minutes, 0)
  const goals = days.slice(0, 7).filter((d) => d.goalMet).length
  // active streak: consecutive days ending today or yesterday with any activity
  const active = new Set(days.filter((d) => d.minutes > 0 || d.puzzlesSolved > 0 || d.lessonSteps > 0 || d.gamesPlayed > 0).map((d) => d.dayKey))
  let streak = 0
  const cursor = new Date()
  if (!active.has(dayKeyLocal(cursor))) cursor.setDate(cursor.getDate() - 1)
  for (;;) {
    const key = dayKeyLocal(cursor)
    if (!active.has(key)) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  const parts: string[] = []
  parts.push(`${p.puzzleSolved} puzzles solved, best streak ${p.bestPuzzleStreak}${p.puzzleRating ? `, puzzle rating about ${p.puzzleRating}` : ''}.`)
  parts.push(`${lessons.length} lessons completed.`)
  if (p.botGames > 0) parts.push(`${p.botGames} practice bot games${p.botElo > 0 ? `, estimated strength around ${p.botElo}` : ''}.`)
  parts.push(`Last 7 days: ${minutes} active minutes, ${goals} of 7 daily goals met, ${games} games played.`)
  parts.push(streak > 0 ? `Active streak: ${streak} day${streak === 1 ? '' : 's'}. Keep it breathing.` : 'No active streak right now. One puzzle today restarts it.')
  parts.push(`XP: ${p.xp}.`)
  return { content: parts.join(' ') }
}

async function progressWeakness(req: CommandRequest): Promise<CommandOutcome> {
  const [mastery, missed, games] = await Promise.all([
    db.skillMastery.findMany({ where: { profileId: req.profile.id, attempts: { gte: 2 } }, orderBy: { mastery: 'asc' }, take: 5 }),
    db.coachArtifact.findMany({ where: { profileId: req.profile.id, solved: false }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.gameRecord.findMany({ where: { profileId: req.profile.id, analyzedAt: { not: null } }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])
  const valid = mastery.filter((m) => (CONCEPTS as readonly string[]).includes(m.concept))
  const missedThemes = new Map<string, number>()
  for (const a of missed) {
    try {
      for (const t of JSON.parse(a.themes ?? '[]') as string[]) {
        missedThemes.set(t, (missedThemes.get(t) ?? 0) + 1)
      }
    } catch {
      /* skip malformed rows */
    }
  }
  let blunders = 0
  let mistakes = 0
  for (const g of games) {
    try {
      const labels = JSON.parse(g.labelsJson ?? '{}') as Record<string, { w: number; b: number }>
      for (const side of ['w', 'b'] as const) {
        blunders += labels.blunder?.[side] ?? 0
        mistakes += labels.mistake?.[side] ?? 0
      }
    } catch {
      /* skip malformed rows */
    }
  }
  const parts: string[] = []
  const weakest = valid[0]
  if (weakest) {
    parts.push(
      `Your weakest trained motif is ${weakest.concept}: ${Math.round(weakest.mastery * 100)}% mastery over ${weakest.attempts} attempts.`,
    )
  }
  const topMissed = [...missedThemes.entries()].sort((x, y) => y[1] - x[1])[0]
  if (topMissed) parts.push(`Generated material you missed most often: ${topMissed[0]} (${topMissed[1]} unsolved).`)
  if (blunders + mistakes > 0) {
    parts.push(`In your recent reviewed games there were ${mistakes} mistakes and ${blunders} blunders on the board.`)
  }
  if (!weakest && !topMissed && blunders + mistakes === 0) {
    parts.push('Not enough data yet to name a weakness honestly. Solve a few puzzles (/puzzle) or play and review a game, then ask again.')
    return { content: parts.join(' ') }
  }
  const theme = weakest ?? (topMissed && (CONCEPTS as readonly string[]).includes(topMissed[0]) ? topMissed[0] : null)
  if (theme) {
    parts.push(`Sharpen it directly: run /puzzle ${theme} and I will build a verified task on that motif.`)
  }
  return { content: parts.join(' ') }
}

async function progressNext(req: CommandRequest): Promise<CommandOutcome> {
  const done = new Set(
    (await db.lessonProgress.findMany({ where: { profileId: req.profile.id, completed: true } })).map((r) => r.lessonId),
  )
  const nextId = nextUnlockedId(done)
  if (!nextId) {
    return { content: 'You have finished every unlocked level in the course. Outstanding. More content is on the roadmap; keep sharp with /puzzle meanwhile.' }
  }
  const ref = findLevel(nextId)
  if (!ref) return { content: 'I could not locate the next lesson right now. Open the Learn tab to see the course.' }
  const concepts = (ref.level.concepts ?? []).slice(0, 4).join(', ')
  return {
    content: [
      `Next up: ${ref.tier.title}, Level ${ref.level.n}: "${ref.level.title}".`,
      concepts ? `It covers ${concepts}.` : '',
      'I can drop you straight into the course.',
    ]
      .filter(Boolean)
      .join(' '),
    action: { type: 'goto', view: 'lessons' },
  }
}

async function progressLevel(req: CommandRequest): Promise<CommandOutcome> {
  const ctx = resolveLevelContext(req.ctx.tier, req.ctx.level, req.profile.skillLevel)
  const band = levelRating(ctx.tierN, ctx.levelN)
  const concepts = ctx.concepts.length ? ctx.concepts.join(', ') : 'general technique'
  return {
    content: `You are working through ${ctx.tierTitle}, Level ${ctx.levelN}: "${ctx.levelTitle}". The level trains ${concepts}, and material I generate for you is calibrated to about ${band} Elo strength. Level work feeds straight into the puzzles I craft.`,
  }
}

// ---------------------------------------------------------------------------
// Fun skills (curated, deterministic; vocab/rules fall back to the model)
// ---------------------------------------------------------------------------

const JOKES: string[] = [
  'Why did the chess player bring a ladder to the tournament? He heard the competition was a few ranks higher.',
  'A chess player walked into a bar. And a restaurant. And a hotel. He was a knight.',
  'Why do chess players never get lost? Every road is a file they already know.',
  'My rook asked my bishop why diagonals are so relaxing. No ranks to worry about.',
  'Chess players do it with menace. Chess teachers do it with en passant. Sorry, that one was forced, like a winning line.',
  'What is a chess player\'s favorite kind of music? Anything with a good opening.',
  'Why was the pawn sad after the promotion? It finally realized the queen had it easier all along.',
  'I told my opponent a joke mid-game. He lost his train of thought and his knight on d4.',
  'Grandmasters never panic. They just quietly calculate that panicking does not help.',
  'The zugzwang is strong with this one. Every move makes it worse, and yet you must move.',
]

const QUOTES: { text: string; by: string }[] = [
  { text: 'When you see a good move, look for a better one.', by: 'Emanuel Lasker' },
  { text: 'Tactics flow from a superior position.', by: 'Bobby Fischer' },
  { text: 'Chess is life.', by: 'Bobby Fischer' },
  { text: 'Every chess master was once a beginner.', by: 'Irving Chernev' },
  { text: 'The hardest game to win is a won game.', by: 'Emanuel Lasker' },
  { text: 'I do not believe in psychology. I believe in good moves.', by: 'Bobby Fischer' },
  { text: 'Play the opening like a book, the middlegame like a magician, and the endgame like a machine.', by: 'Rudolf Spielmann' },
  { text: 'Chess is the gymnasium of the mind.', by: 'Blaise Pascal' },
  { text: 'The blunders are all there on the board, waiting to be made.', by: 'Savielly Tartakower' },
  { text: 'The winner of the game is the player who makes the next-to-last mistake.', by: 'Savielly Tartakower' },
  { text: 'Chess holds its master in its own bonds, shackling the mind and brain.', by: 'Albert Einstein' },
  { text: 'You must take your opponent into a deep dark forest where 2+2=5.', by: 'Mikhail Tal' },
  { text: 'There is no remorse without the alert move.', by: 'Mikhail Tal' },
  { text: 'Chess is mental torture.', by: 'Garry Kasparov' },
]

const GLOSSARY: Record<string, string> = {
  fork: 'One piece attacks two or more enemy pieces at the same time. Usually with a knight, and usually one of the targets is worth more than the forker.',
  pin: 'A piece cannot or should not move because a more valuable piece stands directly behind it on the same line. The piece in front is pinned to the one behind.',
  skewer: 'The reverse of a pin: a valuable piece stands in front and must move, exposing the piece behind it on the same line.',
  'discovered attack': 'One piece moves out of the way and thereby uncovers an attack from a piece standing behind it. The moving piece can create a second threat at the same time.',
  'x-ray': 'An attack through an enemy piece, planned for the moment that piece moves away. Rooks on an open file often x-ray each other.',
  zwischenzug: 'A move inserted in the middle of an expected sequence. Instead of recapturing right away, you play a stronger threat first.',
  'en passant': 'A pawn capture that happens when an enemy pawn advances two squares and lands beside your pawn. You may capture it as if it had moved only one square, and only on that very move.',
  castling: 'The one move where the king and a rook move together: king two squares toward the rook, rook jumping to the other side. Legal only if neither has moved, the squares between are empty, and the king does not pass through check.',
  promotion: 'A pawn reaching the last rank becomes a queen, rook, bishop or knight. Almost always a queen.',
  stalemate: 'The side to move has no legal moves and is not in check. The game is a draw, no matter how much material either side has.',
  zugzwang: 'A position where every legal move makes things worse, but you must move. Common in endgames with only kings and pawns.',
  tempo: 'A unit of time in chess. Winning a tempo means gaining a move: your plan advances while the opponent spends a move reacting.',
  outpost: 'A square, safely in enemy territory, that enemy pawns can never attack again. A knight planted on an outpost is often worth a rook\'s worth of annoyance.',
  fianchetto: 'Developing the bishop to the second rank of the adjacent knight file, like g2 or b2, where it rakes the long diagonal.',
  opposition: 'In king-and-pawn endgames, kings facing each other with one square between. The side NOT to move holds the opposition and controls where the other king must go.',
  'passed pawn': 'A pawn with no enemy pawns able to stop or capture it on its file or adjacent files. Passed pawns must be pushed, or traded for.',
  'isolated pawn': 'A pawn with no friendly pawns on neighboring files. No pawn can ever defend it, only pieces can.',
  'doubled pawns': 'Two pawns of one color on the same file. They defend poorly and block each other, though they can open lines.',
  'backward pawn': 'A pawn behind its neighbors on adjacent files, so no pawn can defend it, sitting on a half-open file in front of it.',
  'pawn chain': 'Pawns defending each other diagonally. Attack the base of the chain, not the tip.',
  'open file': 'A file with no pawns on it. Rooks love them.',
  'half-open file': 'A file with only enemy pawns on it. Rooks pressure the pawn, and the pressure often decides the game.',
  battery: 'Two pieces of the same color lined up on one file, rank or diagonal, the stronger behind: queen behind the rook, or rook behind the bishop.',
  overloading: 'A defender with too many jobs. Attack one duty and the other collapses.',
  deflection: 'Forcing a defending piece away from the square or line it must hold.',
  decoy: 'Forcing an enemy piece onto a square where it becomes vulnerable, often with a sacrifice.',
  sacrifice: 'Giving up material for something bigger: mate, a crushing attack, or an unstoppable passed pawn.',
  'perpetual check': 'A sequence of checks the opponent cannot escape from. The game ends in a draw by repetition.',
  fortress: 'A defensive setup the attacker cannot break even with extra material. The great hope of the defender in bad endgames.',
  prophylaxis: 'Moves that improve your position while stopping the opponent\'s ideas before they exist. The quiet art of strong players.',
  'smothered mate': 'A king buried alive by its own pieces, mated by a lone knight. The classic finish of Philidor\'s legacy.',
  'hung piece': 'A piece left where it can simply be captured. The most common way games between beginners are decided.',
}

const RULES: Record<string, string> = {
  castling:
    'King and rook move together: the king slides two squares toward the rook and the rook lands on the other side. All of these must be true: neither king nor rook has moved yet, every square between them is empty, the king is not in check, and the king never crosses or lands on an attacked square.',
  'en passant':
    'When an enemy pawn advances two squares from its starting square and lands directly beside your pawn, your pawn may capture it as if it had stepped only one square. This is legal only on the move immediately after the two-square advance.',
  promotion:
    'A pawn that reaches the far rank must become a queen, rook, bishop or knight of its own color. It cannot stay a pawn and cannot become a king. Underpromoting to a knight is occasionally the winning move.',
  stalemate:
    'If the side to move has NO legal move and is NOT in check, the game is a draw on the spot. All the material in the world does not matter. Checkmating side should always double-check they are giving check, not stalemate.',
  repetition:
    'If the same position occurs three times with the same side to move and the same legal moves, either player may claim a draw. Engines and adjudicators count positions, not the order the moves were played in.',
  fifty:
    'If 50 moves pass with no pawn move and no capture, a player may claim a draw. Pawn moves and captures reset the counter.',
  material:
    'Insufficient material means neither side can possibly deliver mate: for example king against king, or king and bishop against king. The game is drawn immediately.',
  touch:
    'Over the board, a piece you deliberately touch is a piece you must move, if a legal move exists. In ChessX nothing is lost by dragging and letting go; play honest chess anyway.',
  pinned:
    'A pinned piece still gives check, still defends, and can often legally move if the pin is only relative. An absolutely pinned piece cannot legally move at all. Counting pins wrong decides more club games than brilliancies do.',
  check:
    'Check means the king is attacked and must be saved: move the king, block the attack, or capture the attacker. Checkmate means the king is attacked and none of those three is possible. Then the game ends right there.',
}

function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, '').trim()
}

function lookupGlossary(raw: string): { term: string; def: string } | null {
  const q = normalizeTerm(raw)
  if (!q) return null
  if (GLOSSARY[q]) return { term: q, def: GLOSSARY[q] }
  for (const [k, v] of Object.entries(GLOSSARY)) {
    if (k.includes(q) || q.includes(k)) return { term: k, def: v }
  }
  return null
}

function lookupRules(raw: string): { term: string; def: string } | null {
  const q = normalizeTerm(raw)
  if (!q) return null
  if (RULES[q]) return { term: q, def: RULES[q] }
  const aliases: [RegExp, string][] = [
    [/castle|castl/, 'castling'],
    [/passant/, 'en passant'],
    [/promot/, 'promotion'],
    [/stale/, 'stalemate'],
    [/repetition|threefold|repeat/, 'repetition'],
    [/fifty|50/, 'fifty'],
    [/insufficient|draw.*material/, 'material'],
    [/touch/, 'touch'],
    [/pin/, 'pinned'],
    [/check/, 'check'],
  ]
  for (const [re, key] of aliases) {
    if (re.test(q) && RULES[key]) return { term: key, def: RULES[key] }
  }
  return null
}

async function funVocab(req: CommandRequest, arg: string): Promise<CommandOutcome> {
  const hit = lookupGlossary(arg)
  if (hit) return { content: `${hit.term.charAt(0).toUpperCase() + hit.term.slice(1)}: ${hit.def}` }
  const term = normalizeTerm(arg)
  if (term) {
    try {
      const text = await runChat(
        req.cfg,
        'You define chess terms for a ChessX student. Two to four sentences, plain words, one tiny concrete example if it helps. Never use the em dash character. No lists.',
        [{ role: 'user', content: `Define the chess term "${term}" for a club student.` }],
        260,
      )
      const clean = text.replace(/[—―]/g, ',').trim()
      if (clean) return { content: clean }
    } catch {
      /* fall through to the honest miss */
    }
  }
  const suggestions = Object.keys(GLOSSARY).slice(0, 8).join(', ')
  return { content: `I do not have "${term || 'that'}" in my glossary yet. Terms I keep ready: ${suggestions}... Try /vocab fork, or just ask in plain words and I will explain.` }
}

async function funRules(req: CommandRequest, arg: string): Promise<CommandOutcome> {
  const hit = lookupRules(arg)
  if (hit) return { content: `${hit.term.charAt(0).toUpperCase() + hit.term.slice(1)}: ${hit.def}` }
  const topic = normalizeTerm(arg)
  if (topic) {
    try {
      const text = await runChat(
        req.cfg,
        'You answer rules questions for a ChessX student, using standard FIDE-rules chess knowledge. Three to five sentences, plain words, concrete. Never use the em dash character. No lists.',
        [{ role: 'user', content: `Answer this chess rules question precisely: "${topic}".` }],
        320,
      )
      const clean = text.replace(/[—―]/g, ',').trim()
      if (clean) return { content: clean }
    } catch {
      /* fall through to the honest miss */
    }
  }
  const keys = Object.keys(RULES).join(', ')
  return { content: `That one is outside my prepared rules cards. I keep ready: ${keys}. Ask with /rules castling or in plain words.` }
}

function funJoke(coach: Coach): CommandOutcome {
  return { content: pick(JOKES) + (coach.id === 'sasha' ? ' ...Irresistible humor aside: the board is still there.' : '') }
}

function funQuote(): CommandOutcome {
  const q = pick(QUOTES)
  return { content: `"${q.text}"\n${q.by}` }
}

// ---------------------------------------------------------------------------
// Curated line library: traps and famous games, verified before shipping
// ---------------------------------------------------------------------------

interface LineEntry {
  title: string
  kind: 'trap' | 'game'
  opening?: string
  story: string
  /** SAN moves from the standard starting position. */
  moves: string[]
  /** Comment for specific move numbers (1-based ply). */
  notes: Record<number, string>
}

const LINE_LIBRARY: LineEntry[] = [
  {
    title: "Légal's mate: the queen is a decoy",
    kind: 'trap',
    opening: "Philidor Defence",
    story:
      'White gives up the queen with full confidence. If Black grabs it, three minor pieces mate the king in two checks. The lesson: a hanging queen can be a hook, count the follow-up before you take.',
    moves: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'],
    notes: {
      9: 'The knight takes a pawn and pretends the queen is not hanging. It is, on purpose.',
      10: 'Black takes the bait. The greedy capture loses by force.',
      11: 'First check, dragging the king onto e7.',
      13: 'Mate with three minor pieces while the white queen is already gone.',
    },
  },
  {
    title: 'Shepherd\'s mate punishment',
    kind: 'trap',
    opening: 'Open game',
    story:
      'The four-move checkmate pattern works only against players who forget to defend f7 or block the queen. Here Black blocks with the knight and walks into the punishment. The lesson: develop a defender before wandering.',
    moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    notes: {
      5: 'The queen eyes f7 from day one, helped by the bishop on c4.',
      6: 'The losing move: the knight abandons the defense of f7 and even blocks its own queen.',
      7: 'Mate on the weakest square of the board, supported by the bishop.',
    },
  },
  {
    title: 'Blackburne Shilling: the bait on e5',
    kind: 'trap',
    opening: "Italian Game",
    story:
      'Black plays an early Nd4, inviting the greedy Nxe5. The punishment is a queen sortie against g2 that turns lethal. The lesson: counting material before counting threats is how the trap pays its bills.',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#'],
    notes: {
      7: 'White grabs the pawn, believing the knight is defended by the bishop.',
      8: 'The queen lands on g5, hitting e5 and g2 with one stroke.',
      10: 'The pawn grab on f7 was the second greedy move. The queen invades g2.',
      14: 'If this card reached you, the replay check confirmed the mate is real.',
    },
  },
  {
    title: 'The Opera Game, 1858',
    kind: 'game',
    opening: "Philidor Defence",
    story:
      'Morphy, in a Paris opera box, dismantles two amateurs who played the second best moves available. Development first, threats second, and the game ends with two minor pieces mating after a queen sacrifice.',
    moves: [
      'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6',
      'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7',
      'Qb8+', 'Nxb8', 'Rd8#',
    ],
    notes: {
      5: 'Morphy hits the center at once; every move has a threat behind it.',
      9: 'Recapturing with the queen keeps f7 hanging.',
      13: 'The double attack: f7 again, and Black must react.',
      19: 'The first piece goes in. Morphy pays material for open lines.',
      25: 'Rook takes knight, rook recaptures: the black position crumbles.',
      31: 'Qb8+!! The famous queen sacrifice, forcing Nxb8 and abandoning d7.',
      35: 'Mate with rook and bishop. The whole game, eighteen moves of pure development.',
    },
  },
  {
    title: 'The Immortal Game, 1851',
    kind: 'game',
    opening: "King's Gambit",
    story:
      'Anderssen sacrifices a bishop, a knight, both rooks and finally the queen, mating with three minor pieces against a king that never castled. Romantic chess at full speed.',
    moves: [
      'e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5', 'Bxb5', 'Nf6', 'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5',
      'Nf5', 'c6', 'g4', 'Nf6', 'Rg1', 'cxb5', 'h4', 'Qg6', 'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6', 'Nc3', 'Bc5',
      'Nd5', 'Qxb2', 'Bd6', 'Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6', 'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6', 'Be7#',
    ],
    notes: {
      21: 'Rg1!! A rook offered just to keep the black queen busy and the king in the center.',
      33: 'Nd5: the knight leaps in; the black queen starts collecting shiny objects.',
      35: 'Bd6 blocks the escape and threatens mate.',
      43: 'Qf6+!! The queen goes too, only so the bishop can land on e7.',
      45: 'Be7#: three minor pieces mate the uncastled king.',
    },
  },
  {
    title: 'The Evergreen Game, 1852',
    kind: 'game',
    opening: "Evans Gambit",
    story:
      'Anderssen again, this time with the Evans Gambit. The final combination, queen and both bishops offered, is called the evergreen because it stays beautiful forever.',
    moves: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6',
      'e5', 'Qg6', 'Re1', 'Nge7', 'Ba3', 'b5', 'Qxb5', 'Rb8', 'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5', 'Bxd3',
      'Qh5', 'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+', 'Nxe7', 'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+',
      'Kf8', 'Bxe7#',
    ],
    notes: {
      21: 'Ba3 pins the queenside into paralysis.',
      33: 'Nf6+ gxf6: the first leap of the immortal pair.',
      37: 'Rad1!! The quiet move: everything is offered, nothing can be taken.',
      41: 'Qxd7+!! The queen joins the sacrifice queue.',
      47: 'Bxe7#: mate by the two bishops. The evergreen, forever green.',
    },
  },
  {
    title: 'The Game of the Century, 1956',
    kind: 'game',
    opening: "Réti Opening",
    story:
      'Robert James Fischer, 13 years old, dismantles Donald Byrne with a knight excursion that ends in a rook-and-bishop mate. A future world champion announces himself.',
    moves: [
      'Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'd4', 'O-O', 'Bf4', 'd5', 'Qb3', 'dxc4', 'Qxc4', 'c6', 'e4', 'Nbd7',
      'Rd1', 'Nb6', 'Qc5', 'Bg4', 'Bg5', 'Na4', 'Qa3', 'Nxc3', 'bxc3', 'Nxe4', 'Bxe7', 'Qb6', 'Bc4', 'Nxc3', 'Bc5',
      'Rfe8+', 'Kf1', 'Be6', 'Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+', 'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1',
      'axb6', 'Qb4', 'Ra4', 'Qxb6', 'Nxd1', 'h3', 'Rxa2', 'Kh2', 'Nxf2', 'Re1', 'Rxe1', 'Qd8+', 'Bf8', 'Nxe1', 'Bd5',
      'Nf3', 'Ne4', 'Qb8', 'b5', 'h4', 'h5', 'Ne5', 'Kg7', 'Kg1', 'Bc5+', 'Kf1', 'Ng3+', 'Ke1', 'Bb4+', 'Kd1', 'Bb3+',
      'Kc1', 'Ne2+', 'Kb1', 'Nc3+', 'Kc1', 'Rc2#',
    ],
    notes: {
      21: 'Bg5 grabs a pawn but loses the thread; Fischer grabs the initiative instead.',
      22: 'Na4!! A 13-year-old starts giving away material for time.',
      26: 'Nxe4: Byrne takes the knight, Fischer takes over the game.',
      34: 'Be6!! Quiet, untouchable, crushing.',
      38: 'Ne2+ begins the knight dance: e2, d4, e2, c3.',
      54: 'Nxf2! The knight returns to finish the hunt.',
      82: 'Rc2#: rook and bishop mate. The Game of the Century.',
    },
  },
]

/** Replay a line entry with chess.js; entries that fail legality or (for
 * traps) fail to end in mate are dropped, never shipped. */
function verifyEntry(entry: LineEntry): { steps: LineStep[]; mate: boolean } | null {
  try {
    const g = new Chess()
    const steps: LineStep[] = []
    for (let i = 0; i < entry.moves.length; i++) {
      const san = entry.moves[i]
      const mv = g.move(san)
      if (!mv || mv.san !== san) return null
      steps.push({ san: mv.san, note: entry.notes[i + 1] })
    }
    const mate = g.isCheckmate()
    if (entry.kind === 'trap' && !mate) return null
    return { steps, mate }
  } catch {
    return null
  }
}

function sanToPgnText(moves: string[]): string {
  const out: string[] = []
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.`)
    out.push(moves[i])
  }
  return out.join(' ')
}

async function runLineLibrary(req: CommandRequest, kind: 'trap' | 'game'): Promise<CommandOutcome> {
  const pool = LINE_LIBRARY.filter((e) => e.kind === kind).map((e) => ({ entry: e, ok: verifyEntry(e) }))
  const valid = pool.filter((p) => p.ok !== null)
  if (!valid.length) {
    return {
      content:
        kind === 'trap'
          ? 'My verified trap cards are unavailable this second (the replay check failed, and I do not ship unverified material). Try /puzzle meanwhile.'
          : 'My famous-game shelf did not pass its replay check this second. Ask again in a moment.',
    }
  }
  const chosen = pick(valid)
  const entry = chosen.entry
  const steps = chosen.ok!.steps
  const artifact = await db.coachArtifact.create({
    data: {
      profileId: req.profile.id,
      kind: 'line',
      title: entry.title,
      fen: null,
      solution: entry.moves.join(' '),
      sideToMove: null,
      payloadJson: JSON.stringify({
        steps,
        story: entry.story,
        opening: entry.opening ?? null,
        explanation: `${entry.opening ? `${entry.opening}. ` : ''}${entry.story}`,
      }),
      themes: JSON.stringify([kind === 'trap' ? 'openingTrap' : 'famousGame']),
      engineVerified: false, // legality-checked by replay; no engine opinion on move quality
    },
  })
  return {
    content: leadIn(kind === 'trap' ? 'trap' : 'famous') + ' Every move below was replayed and checked before it reached you.',
    artifacts: [artifactFromRow(artifact as unknown as Record<string, unknown>)],
  }
}

// ---------------------------------------------------------------------------
// Pivotal moment skill: rebuild the exact miss from the student's last game
// ---------------------------------------------------------------------------

const FINAL_WIN = 250

async function runPivot(req: CommandRequest): Promise<CommandOutcome> {
  const limited = checkRateLimit(req.profile.id, dayKeyLocal())
  if (limited) throw new SkillError(limited)
  const game = await db.gameRecord.findFirst({
    where: { profileId: req.profile.id, analyzedAt: { not: null }, pivotFen: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (!game?.pivotFen) {
    return {
      content:
        'No pivotal moment on file yet. Play a practice game and run Game review on it; I will then turn your biggest miss into a drill from the exact position. Meanwhile, /puzzle keeps you sharp.',
    }
  }
  const fen = game.pivotFen
  let probe: Chess
  try {
    probe = new Chess(fen)
  } catch {
    return { content: 'The stored pivotal position no longer parses, which should never happen. Try /puzzle meanwhile.' }
  }
  if (probe.isGameOver()) {
    return { content: 'The stored pivotal position is already decided, so there is nothing to drill there. Run Game review on your latest game and try again.' }
  }

  const deadline = Date.now() + 24_000
  const line = await craftWinningLine(fen, { requireWin: false, minMargin: 40, maxSolverMoves: 2 })
  if (!line) {
    return { content: `I found your pivotal moment (you played ${game.pivotSan}), but the position before it offers no clean training point for the engine. Try /drill on a sharper setup, or review the game in the Analysis tab.` }
  }
  const check = await verifyLine({ fen, solution: line.solution, allowStartCheck: true, deadline, finalFloor: line.winning ? FINAL_WIN : null })
  if (!check.ok) {
    return { content: 'I found your pivotal moment but could not verify a clean task from it this time. Try again in a moment, or open the Analysis tab for the full report.' }
  }

  const moveNo = Math.floor((game.pivotPly ?? 0) / 2) + 1
  const lossPawns = game.pivotLoss != null ? Math.round(game.pivotLoss) / 100 : null
  const explanation = [
    `Move ${moveNo} of your game against ${game.botName}: you played ${game.pivotSan}${lossPawns ? `, throwing away roughly ${lossPawns} pawns of evaluation` : ''}.`,
    'This is the position right before that move, with the chance to play it better.',
  ].join(' ')

  const ctx = resolveLevelContext(req.ctx.tier, req.ctx.level, req.profile.skillLevel)
  const copy = await writeCopy(req.cfg, line, ctx, 'drill', null).catch(() => null)
  const title = copy?.title ? `${copy.title} (your game)` : 'Your pivotal moment'
  const goal = line.mateIn ? 'Deliver mate.' : line.winning ? 'Convert your advantage.' : 'Find the strongest continuation.'
  const row = await db.coachArtifact.create({
    data: {
      profileId: req.profile.id,
      kind: 'drill',
      title,
      fen,
      solution: line.solution.join(' '),
      sideToMove: fen.split(' ')[1] === 'b' ? 'b' : 'w',
      payloadJson: JSON.stringify({
        hint: copy?.hint ?? 'This is your own game. List every check, capture and threat, then choose better than you did.',
        goal,
        explanation,
      }),
      themes: JSON.stringify([copy?.theme && (CONCEPTS as readonly string[]).includes(copy.theme) ? copy.theme : 'calculation']),
      levelRef: ctx.levelRef,
      engineVerified: check.engineVerified,
    },
  })
  return {
    content: `Found it: move ${moveNo} against ${game.botName}, where ${game.pivotSan} cost you${lossPawns ? ` about ${lossPawns} pawns` : ' the thread'}. The position right before your move is now a drill, verified by the engine.`,
    artifacts: [artifactFromRow(row as unknown as Record<string, unknown>)],
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function helpReply(): CommandOutcome {
  const byCat = new Map<string, CommandDef[]>()
  for (const c of COMMANDS) {
    const arr = byCat.get(c.category) ?? []
    arr.push(c)
    byCat.set(c.category, arr)
  }
  const labels: Record<string, string> = {
    generate: 'Generate (verified before you see it)',
    board: 'Board (reads your position)',
    progress: 'Progress (your real numbers)',
    app: 'App control',
    fun: 'Fun',
  }
  const lines: string[] = ['Type a command, or tap / in the box to browse them. Plain words work too.']
  for (const cat of ['generate', 'board', 'progress', 'app', 'fun']) {
    const defs = byCat.get(cat) ?? []
    if (!defs.length) continue
    lines.push('')
    lines.push(labels[cat] + ':')
    for (const d of defs) lines.push(`${d.cmd}${d.args ? ` ${d.args}` : ''} · ${d.desc}`)
  }
  return { content: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Command executor
// ---------------------------------------------------------------------------

async function runCommand(req: CommandRequest, def: CommandDef, arg: string): Promise<CommandOutcome> {
  switch (def.id) {
    // generation (via the injected runner: rate limits live there)
    case 'puzzle':
    case 'mate':
    case 'endgame':
    case 'drill':
    case 'quiz': {
      const skill: SkillId =
        def.id === 'puzzle'
          ? 'level_puzzle'
          : def.id === 'mate'
            ? 'mate_hunt'
            : def.id === 'endgame'
              ? 'endgame_drill'
              : def.id === 'drill'
                ? 'position_drill'
                : 'level_quiz'
      const theme = arg && (CONCEPTS as readonly string[]).includes(arg) ? arg : req.ctx.theme
      const artifact = await req.runGeneration(skill, theme)
      const kindKey = skill === 'mate_hunt' ? 'mate' : skill === 'endgame_drill' ? 'endgame' : skill === 'position_drill' ? 'drill' : skill === 'level_quiz' ? 'quiz' : 'puzzle'
      return { content: leadIn(kindKey), artifacts: [artifact] }
    }
    case 'daily': {
      const puzzle = await req.runGeneration('level_puzzle')
      let quiz: ArtifactView | null = null
      try {
        quiz = await req.runGeneration('level_quiz')
      } catch {
        quiz = null
      }
      const artifacts = quiz ? [puzzle, quiz] : [puzzle]
      return {
        content: leadIn('daily') + (quiz ? '' : ' The quiz did not make it through verification; the puzzle did.'),
        artifacts,
      }
    }
    case 'pivot':
      return runPivot(req)
    case 'trap':
    case 'famous':
      return runLineLibrary(req, def.id === 'trap' ? 'trap' : 'game')

    // board
    case 'analyze':
      return boardAnalyze(req)
    case 'best':
      return boardBest(req)
    case 'hint':
      return boardHint(req)
    case 'eval':
      return boardEval(req)
    case 'threats':
      return boardThreats(req)
    case 'describe':
      return boardDescribe(req)
    case 'moves':
      return boardMoves(req)

    // progress
    case 'recap':
      return progressRecap(req)
    case 'weakness':
      return progressWeakness(req)
    case 'next':
      return progressNext(req)
    case 'level':
      return progressLevel(req)

    // app control
    case 'flip':
      return { content: pick(['Board turned around.', 'Flipped. Same position, other side of the river.', 'There you go.']), action: { type: 'flip_board' } }
    case 'reset':
      return { content: 'Back to the start. Fresh canvas.', action: { type: 'reset_board' } }
    case 'goto': {
      const view = normalizeTerm(arg)
      if (VIEWS.includes(view)) {
        return { content: `Off to the ${view} section.`, action: { type: 'goto', view } }
      }
      return { content: `Which section? I can open: ${VIEWS.filter((v) => v !== 'lesson').join(', ')}. Example: /goto puzzles.` }
    }
    case 'newgame':
      return { content: 'Pick a bot and take the board. I will be here for the review.', action: { type: 'goto', view: 'play' } }
    case 'dark': {
      const next = req.profile.darkMode === 'dark' ? 'light' : 'dark'
      return { content: `${next === 'dark' ? 'Lights out' : 'Lights on'}: switching to ${next} mode.`, action: { type: 'toggle_dark' } }
    }
    case 'coach': {
      const q = normalizeTerm(arg)
      if (!q) {
        return {
          content: `The roster: ${COACHES.map((c) => `${c.name} (${c.title})`).join(', ')}. Pick with /coach victor, for example.`,
        }
      }
      const target = COACHES.find((c) => c.id === q || c.name.toLowerCase().startsWith(q))
      if (!target) {
        return { content: `I could not find a coach called "${arg}". The roster: ${COACHES.map((c) => c.name).join(', ')}.` }
      }
      if (target.id === req.profile.coach) {
        return { content: `${target.name} is already on duty. Persistent, is what that is.` }
      }
      return {
        content: `${target.name} takes the chair. ${target.blurb}`,
        action: { type: 'switch_coach', coachId: target.id },
      }
    }
    case 'help':
      return helpReply()

    // fun
    case 'joke':
      return funJoke(req.coach)
    case 'quote':
      return funQuote()
    case 'vocab':
      return funVocab(req, arg)
    case 'rules':
      return funRules(req, arg)

    default:
      return { content: 'That command exists in the catalog but has no runner wired. That is on me; try another one.' }
  }
}

// ---------------------------------------------------------------------------
// The router the chat route calls
// ---------------------------------------------------------------------------

/** Handle everything that should never reach the language model: /commands,
 * greetings, app actions and unambiguous generation requests. Returns null
 * when the message is genuine conversation for the model. */
export async function routeMessage(req: CommandRequest): Promise<CommandOutcome | null> {
  const text = req.message.trim()
  if (!text) return null

  // 1. explicit /command: fastest, most reliable path
  const parsed = parseClientCommand(text)
  if (parsed) {
    return await runCommand(req, parsed.def, parsed.arg)
  }

  // 2. social: greet, identity, thanks, bye (short anchored messages only).
  // The greeting is enriched with one honest hook from the student's real
  // ledger (weakest motif, unsolved material, last game, open daily goal).
  const social = socialIntent(text)
  if (social) {
    if (social === 'greeting') {
      const base = greetingReply(req.coach, req.profile.name)
      const hook = await memoryHook(req.profile.id).catch(() => null)
      return { content: hook ? `${base}\n\n${hook}` : base }
    }
    if (social === 'identity') return { content: identityReply(req.coach) }
    if (social === 'thanks') return { content: thanksReply(req.coach) }
    return { content: byeReply(req.coach) }
  }

  // 3. app actions in natural language ("flip white and black")
  const action = actionIntent(text)
  if (action) {
    if (action.type === 'goto' && action.view === 'progress-recap') {
      return await progressRecap(req)
    }
    const confirmations: Record<string, string[]> = {
      flip_board: ['Flipped. Look from their side now.', 'Board turned around.'],
      reset_board: ['Back to the start.'],
      toggle_dark: ['Switched the lights.'],
      toggle_sound: ['Sound switched.'],
    }
    const confirm = pick(confirmations[action.type] ?? ['Done.'])
    return { content: confirm, action }
  }

  // 4. engine questions in plain words: the engine answers, not a guess
  const boardAsk = engineQuestionRoute(text)
  if (boardAsk) {
    const def = COMMANDS.find((c) => c.id === boardAsk)
    if (def) return await runCommand(req, def, '')
  }

  // 5. unambiguous generation request: build it now, no model in the loop
  const gen = directGenRoute(text)
  if (gen) {
    if (gen.skill === 'pivot') return await runPivot(req)
    const artifact = await req.runGeneration(gen.skill, gen.theme)
    const kindKey = gen.skill === 'mate_hunt' ? 'mate' : gen.skill === 'endgame_drill' ? 'endgame' : gen.skill === 'position_drill' ? 'drill' : gen.skill === 'level_quiz' ? 'quiz' : 'puzzle'
    return { content: leadIn(kindKey), artifacts: [artifact] }
  }

  // 6. genuine conversation: the model's stage
  return null
}
