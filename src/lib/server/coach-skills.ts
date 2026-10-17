// Coach skills: the tutor's hands inside the app. Each skill generates
// training material with the configured AI, then runs it through the same
// honesty battery the shipped content pool passes (chess.js replay, strict
// SAN, engine verification with a time budget). Nothing reaches a student
// unless it validates; if the engine could not finish in time the artifact
// is still delivered but honestly marked engineVerified=false.
//
// Skills:
//   level_puzzle   fresh puzzle calibrated to a curriculum level
//   mate_hunt      same, but the line must end in a verified forced mate
//   endgame_drill  puzzle built only from sparse endgame course positions
//   position_drill training task built from a specific position (the board)
//   level_quiz     multiple-choice quiz question calibrated to a level
import 'server-only'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { runChat, type AiConfig } from '@/lib/ai'
import { CONCEPTS } from '@/content/schema'
import { TIERS } from '@/content/levels'
import { SKILL_TIER_N } from '@/lib/unlock'
import { analyze } from '@/lib/server/engine'
import { describeFen } from '@/lib/server/chess-describe'
import { collectCandidateFens, craftWinningLine, extendLineToMate, lineEndsInMate, type CraftedLine } from '@/lib/server/craft'
import { pickMasterPuzzle, bankToCrafted, servedBoardsFor, BANK_TRIES } from '@/lib/server/puzzle-bank'
import { levelRating, type ArtifactView, type QuizOptionView, artifactFromRow } from '@/lib/coach-artifacts'

export type SkillId = 'level_puzzle' | 'mate_hunt' | 'endgame_drill' | 'position_drill' | 'level_quiz'

export const SKILL_IDS: SkillId[] = ['level_puzzle', 'mate_hunt', 'endgame_drill', 'position_drill', 'level_quiz']

// Engine verification budget per artifact: single-threaded wasm, depth 12.
// Raised to 30s because a winning puzzle now plays its whole line out to
// checkmate, and the extension searches need room to finish honestly.
const ENGINE_BUDGET_MS = 30_000
// Whole-skill budget (generation attempts + engine) so the route answers.
const SKILL_BUDGET_MS = 55_000
const GENERATION_ATTEMPTS = 3
const MAX_TOKENS = 900

// Thresholds mirror scripts/verify-puzzles.ts.
const CP_LOSS_OPP = 90
const FINAL_WIN = 250

export class SkillError extends Error {}

// ---------------------------------------------------------------------------
// Level context
// ---------------------------------------------------------------------------

const SKILL_TIER = SKILL_TIER_N

export interface LevelContext {
  tierId: string
  tierN: number
  tierTitle: string
  levelN: number
  levelTitle: string
  concepts: string[]
  levelRef: string
}

/** Resolve a curriculum anchor from loose request params. Never throws:
 * falls back to the profile's self-assessed skill tier. */
export function resolveLevelContext(
  rawTier: unknown,
  rawLevel: unknown,
  skillLevel: string,
): LevelContext {
  let tier = TIERS.find((t) => t.id === String(rawTier ?? ''))
  if (!tier) {
    const n = Number(rawTier)
    if (Number.isFinite(n) && n >= 1 && n <= 6) {
      tier = TIERS.find((t) => t.n === Math.round(n))
    }
  }
  if (!tier) {
    const n = SKILL_TIER[skillLevel] ?? 2
    tier = TIERS.find((t) => t.n === n) ?? TIERS[0]
  }
  const levelN = Math.min(20, Math.max(1, Math.round(Number(rawLevel) || 1)))
  const level = tier.levels[levelN - 1] ?? tier.levels[0]
  return {
    tierId: tier.id,
    tierN: tier.n,
    tierTitle: tier.title,
    levelN: level.n,
    levelTitle: level.title,
    concepts: (level.concepts ?? []).slice(0, 4),
    levelRef: `${tier.id}:${level.n}`,
  }
}

function pickTheme(requested: unknown, ctx: LevelContext | null): string {
  const r = String(requested ?? '')
  if ((CONCEPTS as readonly string[]).includes(r)) return r
  if (ctx && ctx.concepts.length) return ctx.concepts[Math.floor(Math.random() * ctx.concepts.length)]
  const pool = ['fork', 'pin', 'mate', 'winningMaterial', 'discoveredAttack', 'defense']
  return pool[Math.floor(Math.random() * pool.length)]
}

// ---------------------------------------------------------------------------
// Copy cleaning and JSON extraction
// ---------------------------------------------------------------------------

/** The app bans em dashes everywhere and CI fails on them. Also drop code
 * fences and collapse whitespace that LLMs love to sprinkle. */
function cleanCopy(s: unknown, max = 600): string {
  return String(s ?? '')
    .replace(/[—―]/g, ',')
    .replace(/[–]/g, '-')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export interface ExtractedSkill {
  params: Record<string, unknown>
  content: string
}

/** Pull the last ```skill {...}``` block out of a coach reply. The block is
 * removed from the content; text before it stays. */
export function extractSkillBlock(content: string): ExtractedSkill | null {
  const matches = [...content.matchAll(/```(?:skill|chessx-skill)\s*\n?([\s\S]*?)```/gi)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const raw = last[1].trim()
  const braceStart = raw.indexOf('{')
  const braceEnd = raw.lastIndexOf('}')
  if (braceStart === -1 || braceEnd <= braceStart) return null
  try {
    const parsed = JSON.parse(raw.slice(braceStart, braceEnd + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const cleaned = (content.slice(0, last.index) + content.slice(last.index + last[0].length))
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { params: parsed as Record<string, unknown>, content: cleaned }
  } catch {
    return null
  }
}

/** Parse the model's JSON answer whether or not it wrapped it in fences. */
function parseModelJson(text: string): Record<string, unknown> {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) throw new SkillError('The model did not return a JSON object.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new SkillError('The model returned malformed JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SkillError('The model did not return a JSON object.')
  }
  return parsed as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Position validation (chess.js battery, shared by puzzle and drill)
// ---------------------------------------------------------------------------

interface LineCheck {
  ok: boolean
  error?: string
  engineVerified: boolean
}

export async function verifyLine(opts: {
  fen: string
  solution: string[]
  allowStartCheck: boolean
  deadline: number
  /** Minimum solver eval at the end, cp. Null skips the floor check (quiet
   * best-move drills where winning is not the point). */
  finalFloor: number | null
}): Promise<LineCheck> {
  const { fen, solution, allowStartCheck, deadline, finalFloor } = opts
  // Long lines are the point now: a winning puzzle plays the whole kill to
  // checkmate, which can run 20+ plies. The cap only bounds runaway input.
  if (solution.length < 1 || solution.length > 34) {
    return { ok: false, error: 'the solution line must hold at least 1 ply and at most 34 plies', engineVerified: false }
  }
  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return { ok: false, error: 'the FEN did not parse', engineVerified: false }
  }
  if (game.isGameOver()) return { ok: false, error: 'the position is already decided, pick a livelier one', engineVerified: false }
  if (!allowStartCheck && game.isCheck()) {
    return { ok: false, error: 'the side to move is already in check, set up a quieter position', engineVerified: false }
  }

  // Strict SAN replay with suffix enforcement: what the model wrote must be
  // exactly what chess.js produces (check/mate/capture marks included).
  const replay = new Chess(fen)
  for (let i = 0; i < solution.length; i++) {
    let mv
    try {
      mv = replay.move(solution[i])
    } catch {
      return { ok: false, error: `move ${i + 1} (${solution[i]}) is not legal in the line`, engineVerified: false }
    }
    if (!mv || mv.san !== solution[i]) {
      return { ok: false, error: `move ${i + 1} must be written "${mv?.san ?? solution[i]}" in exact SAN`, engineVerified: false }
    }
  }

  const solverWhite = new Chess(fen).turn() === 'w'

  // Mate uniqueness, pure chess.js and always enforced: when the line ends
  // in mate by the solver, no other mating move may exist at that node.
  const mateNode = new Chess(fen)
  for (let i = 0; i < solution.length - 1; i++) mateNode.move(solution[i])
  const matingMoves = mateNode.moves().filter((s) => {
    try {
      const probe = new Chess(mateNode.fen())
      return probe.move(s)?.san.endsWith('#') ?? false
    } catch {
      return false
    }
  })
  const lastSan = solution[solution.length - 1]
  const endsInMate = (() => {
    try {
      const probe = new Chess(mateNode.fen())
      return probe.move(lastSan) ? probe.isCheckmate() : false
    } catch {
      return false
    }
  })()
  if (endsInMate && matingMoves.length > 1 && solution.length <= 6) {
    // Unique-mating-move is a hard standard for short compositions. Long
    // converted wins often have two equal mating moves at the final node;
    // there the engine-best line is the answer and duals are acceptable.
    return { ok: false, error: `${matingMoves.length} moves give mate there (${matingMoves.slice(0, 3).join(', ')}...), the solution must be unique`, engineVerified: false }
  }

  // Engine battery, bounded by the deadline. A null analyze result (engine
  // unavailable or budget gone) degrades to chess.js-only verdicts, honestly.
  let engineVerified = true
  const outOfTime = () => Date.now() > deadline
  const scoredNow = async (g: Chess): Promise<number | null> => {
    if (g.isCheckmate()) return -100000
    if (g.isStalemate() || g.isDraw()) return 0
    const a = await analyze(g.fen(), 2)
    return a ? a.bestScore : null
  }

  let pre = outOfTime() ? null : await analyze(fen, 3)
  if (!pre) engineVerified = false
  // Fresh walker: the strict replay above left `replay` at the line's end.
  // The battery scores every SOLVER move against the engine's best; defender
  // replies on long lines are only replayed, because the craft chose them as
  // engine-best already and re-scoring each one would blow the wasm budget.
  const walk = new Chess(fen)
  for (let i = 0; i < solution.length && pre; i++) {
    const solverMove = i % 2 === 0
    let mv
    try {
      mv = walk.move(solution[i])
    } catch {
      return { ok: false, error: `move ${i + 1} (${solution[i]}) could not be replayed`, engineVerified }
    }
    if (!mv) return { ok: false, error: `move ${i + 1} (${solution[i]}) could not be replayed`, engineVerified }
    const uci = mv.from + mv.to + (mv.promotion ?? '')
    if (solverMove || walk.isCheckmate()) {
      const after = await scoredNow(walk)
      if (after == null) {
        engineVerified = false
        break
      }
      const moverScore = -after
      if (uci !== pre.best) {
        const loss = pre.bestScore - moverScore
        if (loss > CP_LOSS_OPP) {
          return { ok: false, error: `move ${i + 1} (${mv.san}) loses about ${Math.round(loss)}cp compared to ${pre.best}, the line must be sound`, engineVerified }
        }
      }
    }
    if (i < solution.length - 1 && solverMove) {
      pre = outOfTime() ? null : await analyze(walk.fen(), 2)
      if (!pre) engineVerified = false
    }
  }

  if (!engineVerified) return { ok: true, engineVerified: false }
  if (walk.isCheckmate()) return { ok: true, engineVerified: true }

  const fin = await analyze(walk.fen(), 1)
  if (!fin) return { ok: true, engineVerified: false }
  const solverAtEnd = (walk.turn() === 'w') === solverWhite
  const solverFinal = solverAtEnd ? fin.bestScore : -fin.bestScore
  if (finalFloor != null && solverFinal < finalFloor) {
    return { ok: false, error: `the final position is only about ${Math.round(solverFinal / 100)} pawns for the solver, it must be clearly winning (or mate)`, engineVerified: true }
  }
  return { ok: true, engineVerified: true }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CONCEPT_LINES: Record<string, string> = {
  mate: 'checkmate (mate-in-1 or a short forced mate)',
  fork: 'a fork (one piece attacks two or more)',
  pin: 'a pin',
  skewer: 'a skewer',
  discoveredAttack: 'a discovered attack',
  doubleAttack: 'a double attack',
  removingDefender: 'removing the defender',
  promotion: 'a promotion trick',
  endgame: 'endgame technique',
  winningMaterial: 'winning material',
  sacrifice: 'a sound sacrifice',
  defense: 'a defensive resource',
  development: 'development',
  center: 'central control',
  castlingSafety: 'king safety and castling',
  kingSafety: 'king safety',
  pawnStructure: 'pawn structure',
  openFiles: 'open files',
  pieceActivity: 'piece activity',
  kingActivity: 'king activity',
  opposition: 'opposition',
  outposts: 'outposts',
  zugzwang: 'zugzwang',
  calculation: 'calculation',
  prophylaxis: 'prophylaxis',
  coordination: 'piece coordination',
  pawnBreaks: 'pawn breaks',
  bishopPair: 'the bishop pair',
  initiative: 'initiative',
  technique: 'technique',
  tempo: 'tempo',
  tradeDecisions: 'trade decisions',
}

function systemFor(): string {
  return [
    'You write chess quiz material for ChessX. Answer with ONE JSON object and nothing else: no fences, no prose before or after.',
    'Never use the em dash character.',
    'Questions are short, plain and concrete. Name squares and pieces.',
  ].join('\n')
}

function copySystem(): string {
  return [
    'You write teaching copy for ChessX training material. The position and every move are already engine-verified; never invent or change a move.',
    'Answer with ONE JSON object and nothing else: no fences, no prose before or after.',
    'Plain, direct chess language. Short sentences. Never use the em dash character.',
  ].join('\n')
}

function quizPrompt(ctx: LevelContext, theme: string, avoidTitles: string[]): string {
  const concept = CONCEPT_LINES[theme] ?? 'general chess understanding'
  const band = levelRating(ctx.tierN, ctx.levelN)
  return [
    `Write one multiple-choice quiz question for a student on "${ctx.tierTitle}", Level ${ctx.levelN}: "${ctx.levelTitle}".`,
    `Topic: ${concept}. Difficulty about ${band} Elo: the right answer should require thinking, the wrong ones should each be tempting for the level with a real reason they fail.`,
    'Answer with this exact JSON shape:',
    '{"title":"<4-8 words naming the exact idea this question tests, not the level name>","question":"<the question>","options":[{"text":"<answer>","correct":true,"why":"<why it is right>"},{"text":"<answer>","correct":false,"why":"<why it fails>"},{"text":"<answer>","correct":false,"why":"<why it fails>"}]}',
    'Exactly one option has correct true. 3 or 4 options. Each why is one short sentence. No em dashes.',
    avoidTitles.length ? `Do not reuse any of these exact titles from earlier quizzes: ${avoidTitles.join(' | ')}.` : '',
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Generation with verification-driven retries
// ---------------------------------------------------------------------------

/** Ask the model, validate with the builder, feed the exact failure back.
 * The builder returns null when the candidate passed (after any side effects
 * it performs on its own closure state), or a student-safe failure line. */
async function generateWithRetry(
  cfg: AiConfig,
  prompt: string,
  build: (json: Record<string, unknown>) => Promise<string | null>,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + SKILL_BUDGET_MS
  let feedback = ''
  let lastError = 'the coach could not craft valid material this time, try again'
  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS; attempt++) {
    if (Date.now() > deadline) break
    const userMsg = feedback
      ? `${prompt}\n\nYour previous attempt failed verification: ${feedback} Produce a corrected attempt.`
      : prompt
    const text = await runChat(cfg, systemFor(), [{ role: 'user', content: userMsg }], MAX_TOKENS)
    let json: Record<string, unknown>
    try {
      json = parseModelJson(text)
    } catch (e) {
      feedback = e instanceof Error ? e.message : String(e)
      lastError = feedback
      continue
    }
    const fail = await build(json)
    if (!fail) return json
    feedback = fail
    lastError = fail
  }
  throw new SkillError(lastError)
}

// ---------------------------------------------------------------------------
// Skill runners
// ---------------------------------------------------------------------------

export interface RunSkillOpts {
  skill: SkillId
  cfg: AiConfig
  profileId: string
  skillLevel: string
  tier?: unknown
  level?: unknown
  theme?: unknown
  fen?: unknown
}

function rowToView(row: Record<string, unknown>): ArtifactView {
  return artifactFromRow(row)
}

/** Recent card titles for this profile: the dedupe input for fresh copy. */
async function recentTitlesFor(profileId: string): Promise<string[]> {
  const rows = await db.coachArtifact.findMany({
    where: { profileId },
    select: { title: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })
  return rows.map((r) => r.title).filter(Boolean)
}

/** Run one skill end to end: generate, validate, persist. Throws SkillError
 * with a student-safe message when nothing valid came out. */
export async function runSkill(opts: RunSkillOpts): Promise<ArtifactView> {
  if (opts.skill === 'level_quiz') return runLevelQuiz(opts)
  if (opts.skill === 'level_puzzle') return runLevelPuzzle(opts)
  if (opts.skill === 'mate_hunt') return runLevelPuzzle(opts, { requireMate: true })
  if (opts.skill === 'endgame_drill') return runLevelPuzzle(opts, { endgameOnly: true })
  return runPositionDrill(opts)
}

interface PuzzleVariant {
  /** The crafted line must end in checkmate (mate hunt). */
  requireMate?: boolean
  /** Only accept sparse endgame positions as the root. */
  endgameOnly?: boolean
}

function pieceCount(fen: string): number {
  return (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length
}

interface CraftCopy {
  title: string
  hint: string
  explanation: string
  theme: string
}

/** The LLM writes only the teaching copy: title, nudge, explanation, theme.
 * Every move in the line was already chosen and verified by the engine, so
 * no hallucination can reach the student through this path. avoidTitles are
 * the student's recent card headlines: a serve that would duplicate one
 * falls back to the mechanical title, which quotes the actual moves and is
 * therefore unique per position. */
export async function writeCopy(cfg: AiConfig, line: CraftedLine, ctx: LevelContext | null, kind: 'puzzle' | 'drill', requestedTheme: string | null, sourceLine?: string | null, completedToMate?: boolean, avoidTitles: string[] = []): Promise<CraftCopy> {
  const mover = line.fen.split(' ')[1] === 'b' ? 'Black' : 'White'
  const fallback: CraftCopy = {
    title: kind === 'puzzle' ? `${mover} to strike` : 'Position drill',
    hint: 'List every check, capture and threat, then choose the strongest.',
    explanation: line.mateIn ? `The line forces mate in ${line.mateIn}.` : '',
    theme: ctx?.concepts[0] ?? 'winningMaterial',
  }
  const anchor = ctx ? ` for a ${ctx.tierTitle} student (level ${ctx.levelN}, "${ctx.levelTitle}")` : ''
  const origin = sourceLine
    ? completedToMate
      ? `This position occurred in a real rated game: ${sourceLine}. The game's moves are the start of the solution; from there the engine played both sides to the checkmate that finishes the win.`
      : `This position occurred in a real rated game: ${sourceLine}. The moves were the game's continuation.`
    : `${kind === 'puzzle' ? 'A puzzle' : 'A drill'} was just built from this position${anchor}:`
  const prompt = [
    origin,
    line.fen,
    describeFen(line.fen) ?? '',
    `Engine-verified solution: ${line.solution.join(' ')}.`,
    line.mateIn
      ? 'It forces mate. The solution line runs all the way to the mating move.'
      : completedToMate
        ? 'The win is demonstrated all the way: the last move of the solution is checkmate.'
        : line.winning
          ? 'It wins material or a decisively better position.'
          : 'It is the strongest continuation in an unclear position.',
    'Only mention pieces and squares that exist on the board above. Verify every claim against the piece list before writing it.',
    'Title rules: name only pieces that actually move in the solution, and only claim a mate or a sacrifice when the line above really contains one. A false headline is a hard failure.',
    avoidTitles.length
      ? `Never reuse one of these exact titles from the student's recent material: ${avoidTitles.slice(0, 10).join(' | ')}.`
      : '',
    'Answer with ONE JSON object:',
    '{"title":"<max 8 words>","theme":"<one id from the list below>","hint":"<a process nudge: how to think (checks, captures, threats, what the defender wants). It must NOT name any piece, square, motif, or move: the student is still solving>","explanation":"<2-5 sentences: name the tactical idea, walk through WHY each move of the solution works and what the defender would like to do, then state the lesson the student should carry into their own games>"}',
    `Theme ids: ${CONCEPTS.join(', ')}.`,
  ].filter(Boolean).join('\n')
  // Two honest attempts: the second one is told exactly which claim broke.
  // Titles are checked for piece and claim honesty; hints and explanations
  // are checked for the same factual claims (mate, fork, sacrifice) minus
  // the piece scan, since an explanation may legitimately discuss the
  // defender's pieces. If both attempts fail, the mechanical title ships
  // and the explanation is dropped: a dull true card beats a vivid lie.
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await runChat(cfg, copySystem(), [{ role: 'user', content: feedback ? `${prompt}\n\nYour previous attempt violated the facts: ${feedback}. Rewrite honestly, only claiming what the verified line shows.` : prompt }], 900)
      const json = parseModelJson(text)
      const llmTheme = String(json.theme ?? '')
      const copy: CraftCopy = {
        title: cleanCopy(json.title, 80) || fallback.title,
        hint: cleanCopy(json.hint, 200) || fallback.hint,
        explanation: cleanCopy(json.explanation, 900),
        theme: requestedTheme ?? ((CONCEPTS as readonly string[]).includes(llmTheme) ? llmTheme : fallback.theme),
      }
      const titleV = copyTruthViolation(copy.title, line, true)
      if (titleV) {
        console.log(`[coach-copy] title rejected (${titleV}): "${copy.title}"`)
        feedback = `the title: ${titleV}`
        continue
      }
      if (avoidTitles.some((t) => t.trim().toLowerCase() === copy.title.trim().toLowerCase())) {
        // A near-copy of a card the student already holds: ship the mechanical
        // title instead, which quotes the verified moves and cannot collide.
        console.log(`[coach-copy] title deduped against recent material: "${copy.title}"`)
        return { ...copy, title: mechanicalTitle(line, kind) }
      }
      const hintV = copyTruthViolation(copy.hint, line, false)
      if (hintV) {
        console.log(`[coach-copy] hint rejected (${hintV}): "${copy.hint}"`)
        feedback = `the hint: ${hintV}`
        continue
      }
      const explV = copy.explanation ? copyTruthViolation(copy.explanation, line, false) : null
      if (explV) {
        console.log(`[coach-copy] explanation rejected (${explV}): "${copy.explanation.slice(0, 120)}..."`)
        feedback = `the explanation: ${explV}`
        continue
      }
      return copy
    } catch {
      break
    }
  }
  // The material is valid regardless; the copy stays mechanical and true.
  // The safe fallback is the mechanical title with a mechanical explanation
  // built from the verified line itself: nothing unverified ships, and the
  // card still carries a real idea the student can read.
  return { ...fallback, title: mechanicalTitle(line, kind), explanation: mechanicalExplanation(line) }
}

const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

/** A true, line-accurate explanation built mechanically from the verified
 * moves: names each key move, what it does on the board, and the finish.
 * Used when the model's copy failed the truth scan twice, so the card never
 * ships with an empty idea or a vivid lie. */
function mechanicalExplanation(line: CraftedLine): string {
  const sans = line.solution
  if (!sans.length) return ''
  const mover = line.fen.split(' ')[1] === 'b' ? 'Black' : 'White'
  const other = mover === 'White' ? 'Black' : 'White'
  const probe = replayFenQuiet(line.fen)
  if (!probe) return ''
  const gloss = (san: string): string => {
    try {
      const mv = probe.move(san)
      if (!mv) return san
      let text: string
      if (mv.flags.includes('k') || mv.flags.includes('q')) text = `castles on ${mv.to}`
      else if (mv.promotion) text = `promotes to a ${PIECE_NAME[mv.promotion] ?? 'queen'} on ${mv.to}`
      else if (mv.captured) text = `takes the ${PIECE_NAME[mv.captured] ?? 'piece'} on ${mv.to}`
      else text = `brings the ${PIECE_NAME[mv.piece] ?? 'piece'} to ${mv.to}`
      if (mv.san.includes('#')) text += ', mate'
      else if (mv.san.includes('+')) text += ', check'
      return text
    } catch {
      return san
    }
  }
  const parts: string[] = [`The verified line: ${sans.join(' ')}.`]
  parts.push(`${mover} opens with ${gloss(sans[0])}.`)
  if (sans.length >= 2) parts.push(`${other} answers ${gloss(sans[1])}.`)
  const lastSolverIdx = sans.length % 2 === 1 ? sans.length - 1 : sans.length - 2
  if (lastSolverIdx >= 2) parts.push(`${mover} finishes with ${gloss(sans[lastSolverIdx])}.`)
  if (line.endsInMate || line.mateIn != null) parts.push('The final move ends the game by checkmate.')
  return parts.join(' ')
}

/** Quiet replay used only by the explanation builder; null on any failure. */
function replayFenQuiet(fen: string): Chess | null {
  try {
    return new Chess(fen)
  } catch {
    return null
  }
}

/** Mechanical truth check on generated copy: a title that names a piece
 * which never moves in the verified line, or claims a sacrifice or a mate
 * that did not actually happen, is exactly the slop this pipeline exists to
 * prevent ("Knight Sacrifice Forces Mate" above a bishop line). Returns the
 * violation, or null when the headline is honest. A piece is fairly named
 * when it either MOVES as the solver or is CAPTURED by a solver move: "wins
 * the queen" over Rxd8 is a true sentence and must pass. */
function copyTruthViolation(text: string, line: CraftedLine, checkPieces: boolean): string | null {
  const t = text.toLowerCase()
  const moverLetters = new Set<string>()
  try {
    const g = new Chess(line.fen)
    line.solution.forEach((san, i) => {
      const mv = g.move(san)
      if (!mv) throw new Error('illegal')
      if (i % 2 === 0) {
        if (mv.piece) moverLetters.add(mv.piece.toUpperCase())
        if (mv.promotion) moverLetters.add(mv.promotion.toUpperCase())
        if (mv.captured) moverLetters.add(mv.captured.toUpperCase())
      }
    })
  } catch {
    // Malformed line: fall back to a pure SAN-letter scan so the cheap
    // checks still run.
    for (const san of line.solution.filter((_, i) => i % 2 === 0)) {
      const m = san.match(/^[KQRBN]/)
      if (m) moverLetters.add(m[1])
      else if (/^[a-h]/.test(san)) moverLetters.add('P')
    }
  }
  const pieceWords: [RegExp, string, string][] = [
    [/knight/, 'N', 'knight'],
    [/bishop/, 'B', 'bishop'],
    [/rook/, 'R', 'rook'],
    [/queen/, 'Q', 'queen'],
    [/king/, 'K', 'king'],
    [/pawn/, 'P', 'pawn'],
  ]
  for (const [re, letter, word] of pieceWords) {
    if (checkPieces && re.test(t) && !moverLetters.has(letter)) {
      return `the copy names a ${word} but no ${word} is moved or captured by the solver in the verified line`
    }
  }
  if (/\bmat(e|ed|ing|es)\b|\bcheckmate\b/.test(t) && !line.endsInMate && line.mateIn == null) {
    return 'the copy claims a mate but the verified line does not end in one'
  }
  if (/\bfork/.test(t)) {
    // A fork claim is checkable: some solver move must land a piece where it
    // attacks at least two enemy pieces worth a knight or more (king counts).
    let forked = false
    try {
      const g = new Chess(line.fen)
      line.solution.forEach((san, i) => {
        if (i % 2 !== 0) return
        const mv = g.move(san)
        if (!mv) throw new Error('illegal')
        let targets = 0
        for (const row of ['1', '2', '3', '4', '5', '6', '7', '8'] as const) {
          for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
            const sq = `${file}${row}` as never
            const pc = g.get(sq)
            if (!pc || pc.color === mv.color) continue
            if (pc.type === 'p') continue
            if (g.attackers(sq, mv.color).includes(mv.to as never)) targets++
          }
        }
        if (targets >= 2) forked = true
      })
    } catch {
      return null // malformed line: leave it to the engine checks
    }
    if (!forked) {
      return 'the copy claims a fork but no solver move attacks two enemy pieces in the verified line'
    }
  }
  if (/\bsacrific/.test(t)) {
    // A real sacrifice: a solver move's destination square gets captured by
    // the defender later in the line. Replay decides, not the model.
    let sacrificed = false
    try {
      const g = new Chess(line.fen)
      const solverDests = new Set<string>()
      line.solution.forEach((san, i) => {
        const mv = g.move(san)
        if (!mv) throw new Error('illegal')
        if (i % 2 === 0) solverDests.add(mv.to)
        else if (mv.captured && solverDests.has(mv.to)) sacrificed = true
      })
    } catch {
      return null // malformed line: leave it to the engine checks
    }
    if (!sacrificed) {
      return 'the copy claims a sacrifice but the solver never leaves a piece en prise in the verified line'
    }
  }
  return null
}

/** Always-true mechanical title, quoted from the verified moves themselves. */
function mechanicalTitle(line: CraftedLine, kind: 'puzzle' | 'drill'): string {
  const mover = line.fen.split(' ')[1] === 'b' ? 'Black' : 'White'
  if (line.endsInMate || line.mateIn != null) {
    const lastSolver = line.solution.filter((_, i) => i % 2 === 0).at(-1)
    if (lastSolver) return `${mover} mates with ${lastSolver.replace(/[+#]/g, '')}`
  }
  if (kind === 'puzzle') {
    const first = line.solution[0]
    if (first) return `${mover} strikes: ${first.replace(/[+#]/g, '')}`
  }
  return kind === 'puzzle' ? `${mover} to strike` : 'Position drill'
}

/** Persist a bank pick as a puzzle artifact with its real-game source line. */
async function storeBankPuzzle(
  opts: RunSkillOpts,
  pick: ReturnType<typeof pickMasterPuzzle> & object,
  line: { fen: string; solution: string[]; mateIn: number | null },
  copy: CraftCopy,
  ctx: LevelContext,
  engineVerified: boolean,
  extendedToMate: boolean,
): Promise<ArtifactView> {
  const side = line.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  const goal = line.mateIn
    ? `Deliver mate in ${line.mateIn}. The line keeps going until the king falls.`
    : extendedToMate
      ? 'Finish the win: the solution runs every move to checkmate.'
      : 'Win it, then keep pressing the advantage to the end.'
  const row = await db.coachArtifact.create({
    data: {
      profileId: opts.profileId,
      kind: 'puzzle',
      title: copy.title,
      fen: line.fen,
      solution: line.solution.join(' '),
      sideToMove: side,
      payloadJson: JSON.stringify({
        hint: copy.hint,
        goal,
        explanation: copy.explanation || null,
        source: pick.source,
        gameUrl: (pick as { gameUrl?: string }).gameUrl ?? null,
      }),
      themes: JSON.stringify([copy.theme]),
      rating: pick.rating,
      levelRef: ctx.levelRef,
      engineVerified,
    },
  })
  return rowToView(row)
}

async function runLevelPuzzle(opts: RunSkillOpts, variant: PuzzleVariant = {}): Promise<ArtifactView> {
  const ctx = resolveLevelContext(opts.tier, opts.level, opts.skillLevel)
  const requestedTheme = variant.requireMate
    ? 'mate'
    : (CONCEPTS as readonly string[]).includes(String(opts.theme ?? ''))
      ? String(opts.theme)
      : null

  // ---- Real-game bank first --------------------------------------------
  // The bank holds only positions mined from real rated games that passed
  // the strict offline battery. Serving from it means the student always
  // gets a position with a genuine, crowd-rated point and a source line.
  // A short bank line that will not extend to mate is NOT served straight
  // away: the loop tries other candidates first, because the standard is a
  // puzzle that plays on, not a three-ply poke that stops at the tactic.
  try {
    const exclude = await servedBoardsFor(opts.profileId)
    const recentTitles = await recentTitlesFor(opts.profileId)
    const triedFens: string[] = []
    for (let attempt = 0; attempt < BANK_TRIES; attempt++) {
      const pick = pickMasterPuzzle({
        rating: levelRating(ctx.tierN, ctx.levelN),
        theme: requestedTheme,
        requireMate: variant.requireMate,
        endgameOnly: variant.endgameOnly,
        exclude,
        excludeFen: triedFens.at(-1) ?? null,
      })
      if (!pick) break
      triedFens.push(pick.fen)
      const base = bankToCrafted(pick)
      // The bank line is the real game's continuation, but the user-standard
      // is a puzzle that does not stop early: when the stored line does not
      // end in mate, the engine plays BOTH sides on from the game position
      // until the king actually falls. If mate cannot be demonstrated inside
      // the budget, the candidate is skipped and the next one is tried; only
      // when the whole bank fails does the honest real-game line stand.
      let solution = base.solution
      let extendedToMate = false
      let endsInMate = lineEndsInMate(base.fen, solution)
      if (!endsInMate) {
        const extended = await extendLineToMate({
          fen: base.fen,
          solution,
          maxExtraPlies: 22,
          deadline: Date.now() + 10_000,
          depth: 10,
        })
        if (extended) {
          solution = extended
          extendedToMate = true
          endsInMate = true
        }
      }
      // The early-stop standard applies to the bank too: a served line must
      // end in mate or carry at least two solver moves. A fragment that
      // stops right at the tactic is dropped here and the next candidate
      // (or the live craft path) gets the turn instead.
      if (!endsInMate && solution.length < 4) {
        console.log(`[coach-bank] ${pick.id} is a ${solution.length}-ply fragment with no demonstrable mate; skipping it`)
        continue
      }
      const deadline = Date.now() + ENGINE_BUDGET_MS
      const check = await verifyLine({
        fen: base.fen,
        solution,
        allowStartCheck: true,
        deadline,
        finalFloor: FINAL_WIN,
      })
      if (!check.ok) {
        // The offline battery already passed this line; a runtime disagreement
        // means the engine budget ran out, not that the puzzle is wrong.
        console.log(`[coach-bank] runtime recheck soft-failed for ${pick.id}: ${check.error ?? 'unknown'}`)
      }
      const copy = await writeCopy(opts.cfg, { ...base, solution, margin: null, endsInMate } as CraftedLine, ctx, 'puzzle', requestedTheme, pick.source, extendedToMate, recentTitles)
      return await storeBankPuzzle(opts, pick, { fen: base.fen, solution, mateIn: base.mateIn }, copy, ctx, check.ok, extendedToMate)
    }
  } catch (e) {
    console.log('[coach-bank] bank serve failed, falling back to craft:', e instanceof Error ? e.message : String(e))
  }

  // ---- Verified live craft (fallback) -----------------------------------
  const deadline = Date.now() + ENGINE_BUDGET_MS
  let candidates = collectCandidateFens(ctx.tierN, ctx.levelN, variant.endgameOnly ? 140 : 80)
  if (variant.endgameOnly) candidates = candidates.filter((f) => pieceCount(f) <= 9)
  // Mate puzzles no longer shrink to one solver move: craftWinningLine now
  // walks the whole forced line until the mate is actually delivered, so the
  // numbers below only bound the non-mate tactic length. The floor is TWO
  // solver moves at every tier: a one-move material win stops before the
  // point lands, which is exactly the early-stop slop this pipeline bans.
  const maxSolverMoves = variant.requireMate
    ? 4
    : ctx.tierN >= 5
      ? 3
      : 2

  let crafted: CraftedLine | null = null
  let engineVerified = false
  let probes = 0
  for (const fen of candidates) {
    if (Date.now() > deadline || probes >= (variant.requireMate ? 30 : 20)) break
    probes++
    const line = await craftWinningLine(fen, {
      requireWin: true,
      minMargin: variant.requireMate ? 0 : 150,
      maxSolverMoves,
      maxRootScore: 400,
      deadline,
      // Mate hunts demand a demonstrated kill. Regular puzzles extend to the
      // checkmate whenever the engine can show it inside the budget; longer
      // conversions keep the tactical point and the card's pressing phase
      // (engine defends, student presses) carries the win to the actual mate.
      // This is the fix for "puzzles stop so fast".
      toMate: variant.requireMate,
      tryMate: !variant.requireMate,
    })
    if (!line) {
      console.log(`[coach-craft] probe ${probes} rejected: ${fen.split(' ').slice(0, 2).join(' ')}`)
      continue
    }
    if (variant.requireMate && line.mateIn == null) continue
    if (variant.endgameOnly && !line.winning) continue
    // The early-stop ban, enforced on the candidate itself: a non-mate win
    // must at least carry two solver moves (4 plies). A three-ply poke that
    // the extension could not finish is rejected here, and the next position
    // gets its chance, instead of the student receiving a fragment.
    if (!line.endsInMate && line.mateIn == null && line.solution.length < 4) continue
    const check = await verifyLine({
      fen: line.fen,
      solution: line.solution,
      allowStartCheck: false,
      deadline,
      finalFloor: line.endsInMate ? null : FINAL_WIN,
    })
    if (!check.ok) {
      console.log(`[coach-craft] probe ${probes} failed verify: ${check.error ?? 'unknown'}`)
      continue
    }
    // Every mate claim gets the cheap structural double-check.
    if (line.endsInMate && !checkLineEndsInMate(line.fen, line.solution)) continue
    crafted = line
    engineVerified = check.engineVerified
    break
  }
  if (!crafted) {
    throw new SkillError(
      variant.requireMate
        ? 'The coach could not land a verified forced mate from course positions right now. Try again in a moment, or ask for a regular puzzle.'
        : variant.endgameOnly
          ? 'The coach could not craft a verified endgame task right now. Try again in a moment.'
          : 'The coach could not craft a verified puzzle from course positions right now. Try again in a moment, or ask for a quiz instead.',
    )
  }

  const recentTitles = await recentTitlesFor(opts.profileId)
  const copy = await writeCopy(opts.cfg, crafted, ctx, 'puzzle', requestedTheme, null, false, recentTitles)
  const side = crafted.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  const row = await db.coachArtifact.create({
    data: {
      profileId: opts.profileId,
      kind: 'puzzle',
      title: copy.title,
      fen: crafted.fen,
      solution: crafted.solution.join(' '),
      sideToMove: side,
      payloadJson: JSON.stringify({
        hint: copy.hint,
        goal: crafted.endsInMate
          ? 'Finish the win: the solution runs every move to checkmate.'
          : 'Win it, then keep pressing the advantage to the end.',
        explanation: copy.explanation || null,
      }),
      themes: JSON.stringify([copy.theme]),
      rating: levelRating(ctx.tierN, ctx.levelN),
      levelRef: ctx.levelRef,
      engineVerified,
    },
  })
  return rowToView(row)
}

/** Pure chess.js double check that the line ends in checkmate (the engine
 * score already said so; this makes the mate claim structural). */
function checkLineEndsInMate(fen: string, solution: string[]): boolean {
  try {
    const g = new Chess(fen)
    for (const san of solution) g.move(san)
    return g.isCheckmate()
  } catch {
    return false
  }
}

async function runPositionDrill(opts: RunSkillOpts): Promise<ArtifactView> {
  const fen = String(opts.fen ?? '').trim()
  if (!fen) throw new SkillError('Set up a position on the board first.')
  let probe: Chess
  try {
    probe = new Chess(fen)
  } catch {
    throw new SkillError('That board position did not parse as a FEN.')
  }
  // chess.js accepts positions where the side NOT to move is already in
  // check; the engine rejects them outright. Catch that class here with a
  // student-safe message instead of a generic "no training point" later.
  if (probe.isCheck()) {
    const parts = fen.split(' ')
    if (parts.length >= 2) {
      try {
        const flipped = new Chess([parts[0], parts[1] === 'w' ? 'b' : 'w', ...parts.slice(2)].join(' '))
        if (flipped.isCheck()) throw new SkillError('That position is illegal: the side that is not moving is already in check. Fix the king safety and set it up again.')
      } catch (e) {
        if (e instanceof SkillError) throw e
        /* a flipped FEN that does not parse just skips this extra guard */
      }
    }
  }
  if (probe.isGameOver()) throw new SkillError('That position is already decided. Set up something playable.')
  const ctx = opts.tier != null || opts.level != null ? resolveLevelContext(opts.tier, opts.level, opts.skillLevel) : null
  const requestedTheme = (CONCEPTS as readonly string[]).includes(String(opts.theme ?? '')) ? String(opts.theme) : null
  const deadline = Date.now() + ENGINE_BUDGET_MS

  const line = await craftWinningLine(fen, { requireWin: false, minMargin: 40, maxSolverMoves: 2 })
  if (!line) {
    throw new SkillError('The coach could not find a clear training point in that position. Set up something sharper and try again.')
  }
  // A winning drill owes the student the whole win: extend the engine line to
  // the actual checkmate when the position allows it. Quiet positions keep
  // the short honest best-move task.
  let solution = line.solution
  let finishedToMate = false
  if (line.winning && !lineEndsInMate(fen, solution)) {
    const extended = await extendLineToMate({ fen, solution, maxExtraPlies: 20, deadline: Date.now() + 12_000, depth: 10 })
    if (extended) {
      solution = extended
      finishedToMate = true
    }
  }
  const check = await verifyLine({ fen, solution, allowStartCheck: true, deadline, finalFloor: finishedToMate ? null : line.winning ? FINAL_WIN : null })
  if (!check.ok) {
    throw new SkillError(`The coach could not build a clean task there (${check.error}). Try another setup.`)
  }

  const goal = finishedToMate || line.mateIn
    ? 'Finish the win: the solution runs every move to checkmate.'
    : line.winning
      ? 'Convert your advantage, then press the win to the end.'
      : 'Find the strongest continuation.'
  const copy = await writeCopy(opts.cfg, line, ctx, 'drill', requestedTheme, null, false, await recentTitlesFor(opts.profileId))
  const row = await db.coachArtifact.create({
    data: {
      profileId: opts.profileId,
      kind: 'drill',
      title: copy.title,
      fen,
      solution: solution.join(' '),
      sideToMove: fen.split(' ')[1] === 'b' ? 'b' : 'w',
      payloadJson: JSON.stringify({
        hint: copy.hint,
        goal,
        explanation: copy.explanation || null,
      }),
      themes: JSON.stringify([copy.theme]),
      rating: line.mateIn ? Math.max(600, (ctx ? levelRating(ctx.tierN, ctx.levelN) : 800) + (line.mateIn - 1) * 100) : ctx ? levelRating(ctx.tierN, ctx.levelN) : 800,
      levelRef: ctx ? ctx.levelRef : null,
      engineVerified: check.engineVerified,
    },
  })
  return rowToView(row)
}

async function runLevelQuiz(opts: RunSkillOpts): Promise<ArtifactView> {
  const ctx = resolveLevelContext(opts.tier, opts.level, opts.skillLevel)
  const theme = pickTheme(opts.theme, ctx)

  // Recent quiz titles, so a new quiz never repeats a stale one verbatim:
  // three "Level quiz: Develop your pieces" cards in one shelf is slop.
  const recentQuiz = await db.coachArtifact.findMany({
    where: { profileId: opts.profileId, kind: 'quiz' },
    select: { title: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })
  const avoidTitles = recentQuiz.map((r) => r.title).filter(Boolean)

  let goodQuestion = ''
  let goodOptions: QuizOptionView[] = []
  let goodTitle = ''

  const json = await generateWithRetry(opts.cfg, quizPrompt(ctx, theme, avoidTitles), async (raw) => {
    const question = cleanCopy(raw.question, 300)
    const optionsRaw = Array.isArray(raw.options) ? raw.options : []
    const options: QuizOptionView[] = []
    for (const o of optionsRaw.slice(0, 4)) {
      const obj = (o ?? {}) as Record<string, unknown>
      const text = cleanCopy(obj.text, 160)
      const why = cleanCopy(obj.why, 220)
      if (!text || !why) return 'an option is missing its text or its why'
      options.push({ text, correct: Boolean(obj.correct), why })
    }
    if (options.length < 3) return 'a quiz needs at least 3 options'
    if (options.filter((o) => o.correct).length !== 1) return 'exactly one option must be marked correct'
    if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) {
      return 'two options repeat the same answer'
    }
    goodQuestion = question
    goodOptions = options
    const rawTitle = cleanCopy(raw.title, 80)
    goodTitle = rawTitle && !avoidTitles.some((t) => t.toLowerCase() === rawTitle.toLowerCase())
      ? rawTitle
      : rawTitle
        ? `${rawTitle} (${theme})`
        : `Quiz: ${CONCEPT_LINES[theme]?.slice(0, 40) ?? theme}`
    return null
  })

  const row = await db.coachArtifact.create({
    data: {
      profileId: opts.profileId,
      kind: 'quiz',
      title: goodTitle,
      question: goodQuestion,
      payloadJson: JSON.stringify({
        options: shuffleOptions(goodOptions, goodTitle + goodQuestion),
        explanation: cleanCopy(json.explanation, 400) || null,
      }),
      themes: JSON.stringify([theme]),
      // A quiz is level material: it carries the level's rating band like any
      // other artifact, so the shelf never shows a meaningless "?".
      rating: levelRating(ctx.tierN, ctx.levelN),
      levelRef: ctx.levelRef,
    },
  })
  return rowToView(row)
}

/** Deterministic option shuffle so the correct answer is never always first. */
function shuffleOptions(options: QuizOptionView[], seed: string): QuizOptionView[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t >>> 0) % 100000) / 100000
  }
  const out = [...options]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------------------------------------------------------------------------
// Chat integration and rate limiting
// ---------------------------------------------------------------------------

/** Lines injected into the coach chat system prompt: how to request a skill. */
export function skillProtocolLines(): string[] {
  return [
    'Generating training material (your skills):',
    'When the student asks you to create something for them to solve or answer (a puzzle, a drill from the position, a quiz), end your reply with ONE fenced block:',
    '```skill',
    '{"skill":"level_puzzle","theme":"fork"}',
    '```',
    `Valid skill values: ${SKILL_IDS.join(', ')}.`,
    '- level_puzzle: a fresh puzzle calibrated to the student\'s current course level. Use it when they ask for a puzzle or more practice at their level.',
    '- mate_hunt: a puzzle whose solution is a forced mate. Use it when they ask to hunt mates or practice checkmates.',
    '- endgame_drill: a puzzle built from a sparse endgame position. Use it when they ask for endgame practice.',
    '- position_drill: a training task built from the position currently on the board. Use it when they want to practice this position.',
    '- level_quiz: a multiple-choice quiz question for the level.',
    'Optional "theme" key from this list: ' + CONCEPTS.join(', ') + '.',
    'The app generates the material, verifies every move with the engine and renders it under your reply. Never write the material yourself, and never claim you generated something without the block. Only include the block when the student actually wants material; a normal analysis question gets a plain answer.',
  ]
}

/** Simple honest rate limiting from local memory: one generation per profile
 * every few seconds, a daily cap, so nobody burns tokens in a loop. */
const lastRun = new Map<string, number>()
const dayCount = new Map<string, { key: string; n: number }>()
const MIN_GAP_MS = 4_000
const DAILY_CAP = 40

export function checkRateLimit(profileId: string, dayKey: string): string | null {
  const prev = lastRun.get(profileId) ?? 0
  if (Date.now() - prev < MIN_GAP_MS) {
    return 'The coach is still catching up. Give it a few seconds between generations.'
  }
  const c = dayCount.get(profileId)
  const n = c && c.key === dayKey ? c.n : 0
  if (n >= DAILY_CAP) return 'You hit the daily limit of 40 generated items. Come back tomorrow.'
  lastRun.set(profileId, Date.now())
  dayCount.set(profileId, { key: dayKey, n: n + 1 })
  return null
}
