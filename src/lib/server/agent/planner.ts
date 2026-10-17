// The planning agent: every mission now runs as observe -> plan -> act ->
// report. Step one gathers REAL data from this app (ledger, games, mastery,
// the board). Step two hands that data to the model, which designs the rest
// of the mission; the plan is validated against a strict whitelist and then
// injected live into the running checklist. Fixed templates are only the
// fallback when the model cannot produce a valid plan, never the default.
import 'server-only'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { runChat } from '@/lib/ai'
import { analyze } from '@/lib/server/engine'
import { StepSkip } from '@/lib/server/agent/runtime'
import { resolveLevelContext } from '@/lib/server/coach-skills'
import { boardAnalyze, boardBest, boardEval, boardThreats, boardDescribe, type CommandOutcome } from '@/lib/server/coach-commands'
import { coachById } from '@/lib/coaches'
import type { AgentEnv, SuperSkillPlan } from '@/lib/server/agent/superskills'
import { scanLedger, focusConcept, composeReport, validTheme, artifactDetail } from '@/lib/server/agent/superskills'
import { stepGenEscalate } from '@/lib/server/agent/superskills'
import type { AgentStep, StepCtx, ReportState } from '@/lib/server/agent/runtime'
import type { SkillId } from '@/lib/server/coach-skills'

const GEN_SKILLS: SkillId[] = ['level_puzzle', 'mate_hunt', 'endgame_drill', 'level_quiz', 'position_drill']
const BOARD_CMDS = ['analyze', 'best', 'eval', 'threats', 'describe'] as const
type BoardCmd = (typeof BOARD_CMDS)[number]

export interface PlanOp {
  op: 'scan' | 'gen' | 'board' | 'game'
  skill?: string
  theme?: string
  cmd?: string
  title?: string
  why?: string
  /** game op only: which stored game to pull ('last', 'loss', 'win'). */
  which?: string
}

interface PlannedSpec {
  title: string
  ops: PlanOp[]
}

/** What a named mission type hands the planner: its intent, not its script. */
export interface MissionRecipe {
  id: string
  title: string
  goal: string
  stepTitles: string[]
}

const MAX_OPS = 8
const MAX_GEN = 5

function cleanLine(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/[—―]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function validateSpec(raw: Record<string, unknown>, hasFen: boolean): PlannedSpec | null {
  const title = cleanLine(raw.title, 60) || 'Custom mission'
  const opsRaw = Array.isArray(raw.steps) ? raw.steps : []
  if (opsRaw.length < 1 || opsRaw.length > MAX_OPS) return null
  const ops: PlanOp[] = []
  let genCount = 0
  let quizCount = 0
  for (const item of opsRaw) {
    const o = (item ?? {}) as Record<string, unknown>
    const op = String(o.op ?? '')
    if (op === 'scan') {
      // A second full scan is wasted work: the assessment already ran.
      continue
    }
    if (op === 'gen') {
      const skill = String(o.skill ?? '') as SkillId
      if (!GEN_SKILLS.includes(skill)) return null
      if (genCount >= MAX_GEN) return null
      genCount++
      // One quiz per mission, ever: quizzes are a side dish, and a plan with
      // three quiz steps is filler, not training.
      if (skill === 'level_quiz') {
        quizCount++
        if (quizCount > 1) continue
      }
      // position_drill is only honest when a real position stands on the
      // board; otherwise it would fail verification on arrival.
      const resolved: SkillId = skill === 'position_drill' && !hasFen ? 'level_puzzle' : skill
      ops.push({
        op: 'gen',
        skill: resolved,
        theme: validTheme(cleanLine(o.theme, 40)) ?? undefined,
        title: cleanLine(o.title, 60) || undefined,
        why: cleanLine(o.why, 120) || undefined,
      })
      continue
    }
    if (op === 'board') {
      const cmd = String(o.cmd ?? '') as BoardCmd
      if (!(BOARD_CMDS as readonly string[]).includes(cmd)) return null
      // Board reads without a position would just answer the start position.
      if (!hasFen && cmd !== 'describe') return null
      ops.push({ op: 'board', cmd, title: cleanLine(o.title, 60) || undefined, why: cleanLine(o.why, 120) || undefined })
      continue
    }
    if (op === 'game') {
      // Reads a REAL stored game: overview (numbers) or pivot (engine verdict
      // on the move that turned it). This is how "analyze my loss" becomes
      // real work instead of a mislabeled read of the practice board.
      const cmd = String(o.cmd ?? 'overview')
      if (cmd !== 'overview' && cmd !== 'pivot') return null
      ops.push({ op: 'game', cmd, which: cleanLine(o.which, 20) || undefined, title: cleanLine(o.title, 60) || undefined, why: cleanLine(o.why, 120) || undefined })
      continue
    }
    return null
  }
  if (!ops.some((o) => o.op === 'gen' || o.op === 'board' || o.op === 'game')) return null
  return { title, ops }
}

function boardOutcome(env: AgentEnv, cmd: BoardCmd): Promise<CommandOutcome> {
  const req = {
    message: '',
    cfg: env.cfg,
    profile: { id: env.profile.id, name: env.profile.name, skillLevel: env.profile.skillLevel, coach: 'nina', darkMode: 'system', soundEnabled: true },
    ctx: { fen: env.ctx.fen, tier: env.ctx.tier, level: env.ctx.level, theme: env.ctx.theme },
    coach: coachById('nina'),
    runGeneration: async () => {
      throw new Error('generation is not available inside a board read')
    },
  }
  switch (cmd) {
    case 'analyze':
      return boardAnalyze(req)
    case 'best':
      return boardBest(req)
    case 'eval':
      return boardEval(req)
    case 'threats':
      return boardThreats(req)
    default:
      return Promise.resolve(boardDescribe(req))
  }
}

interface StoredGameOp {
  which?: string
  cmd: 'overview' | 'pivot'
}

function pickGame<T extends { result: string }>(rows: T[], which: string | undefined): T {
  const w = (which ?? 'last').toLowerCase()
  if (w.startsWith('loss') && rows.some((r) => r.result === 'loss')) return rows.find((r) => r.result === 'loss')!
  if (w.startsWith('win') && rows.some((r) => r.result === 'win')) return rows.find((r) => r.result === 'win')!
  if (w.startsWith('draw') && rows.some((r) => r.result === 'draw')) return rows.find((r) => r.result === 'draw')!
  return rows[0]
}

/**
 * The honest version of "analyze my game": real stored rows, real engine
 * numbers, no invented anything. overview reports the stored analysis (result,
 * accuracy, error labels, the turning move and what it cost). pivot goes one
 * deeper and puts the pivotal position under the engine so the student sees
 * what should have been played instead.
 */
async function gameOutcome(env: AgentEnv, op: StoredGameOp): Promise<string> {
  const rows = await db.gameRecord.findMany({
    where: { profileId: env.profile.id },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })
  if (!rows.length) {
    return 'No games on file yet, so there was nothing to analyze here. Play one against a bot and run Game review; then this step has real material to chew on.'
  }
  const g = pickGame(rows, op.which)
  let blunders = 0
  let mistakes = 0
  let inaccuracies = 0
  try {
    const labels = JSON.parse(g.labelsJson ?? '{}') as Record<string, { w: number; b: number }>
    const own = g.color === 'w' ? 'w' : 'b'
    blunders = labels.blunder?.[own] ?? 0
    mistakes = labels.mistake?.[own] ?? 0
    inaccuracies = labels.inaccuracy?.[own] ?? 0
  } catch {
    /* malformed labels stay out */
  }
  const head = `Game vs ${g.botName}: ${g.result} by ${g.reason}${g.opening ? `, ${g.opening}` : ''}${g.playerAcc != null ? `, your accuracy ${Math.round(g.playerAcc)}%` : ''}, ${blunders} blunder${blunders === 1 ? '' : 's'}, ${mistakes} mistake${mistakes === 1 ? '' : 's'} and ${inaccuracies} inaccurac${inaccuracies === 1 ? 'y' : 'ies'} on your side`
  // Unanalyzed games must not read as clean games: zero counts on a game
  // that was never reviewed mean NOTHING WAS MEASURED, and a report that
  // praises them is inventing a performance review out of thin air. The
  // qualifier travels with the facts so the report writer cannot misread it.
  const reviewed = g.analyzedAt
    ? ''
    : ' This game has not been through a full Game review yet, so these counts are just the stored labels, not a clean bill of play.'
  if (op.cmd === 'overview') {
    const pivot = g.pivotSan
      ? ` The move that bent the game was ${g.pivotSan} at move ${Math.floor((g.pivotPly ?? 0) / 2) + 1}${g.pivotLoss != null ? `, costing about ${Math.round(g.pivotLoss / 100)} pawns of evaluation` : ''}.`
      : ' Game review has not flagged a single turning move for this one.'
    return head + reviewed + pivot
  }
  // pivot: the engine's verdict on the position right before the turning move.
  if (!g.pivotFen || !g.pivotSan) {
    return head + '. No pivotal position is stored for this game, so the deep cut is unavailable; run Game review on it first.'
  }
  let probe: Chess
  try {
    probe = new Chess(g.pivotFen)
  } catch {
    return head + '. The stored pivotal position no longer parses, so the deep cut is unavailable.'
  }
  if (probe.isGameOver()) {
    return head + `. The game was already decided at the pivotal position, so there is nothing for the engine to add there. The turning move was ${g.pivotSan}.`
  }
  const a = await analyze(g.pivotFen, 3)
  if (!a) {
    return head + `. The engine could not score the pivotal position inside the budget. The turning move was ${g.pivotSan}${g.pivotLoss != null ? `, about ${Math.round(g.pivotLoss / 100)} pawns gone` : ''}.`
  }
  const gameWasWhite = g.color === 'w'
  const moverWasWhite = probe.turn() === 'w'
  const engineSan = (() => {
    try {
      return new Chess(g.pivotFen!).move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best.slice(4, 5) || undefined })?.san ?? null
    } catch {
      return null
    }
  })()
  const moverEval = moverWasWhite === gameWasWhite ? a.bestScore : -a.bestScore
  const evalText = moverEval >= 99_000 ? 'a forced mate was on the board' : `about ${(moverEval / 100).toFixed(1)} pawns ${moverEval >= 0 ? 'in your favor' : 'against you'}`
  const verdict = engineSan && engineSan !== g.pivotSan
    ? `At that moment the engine's best was ${engineSan}, while the game continued ${g.pivotSan}. The position stood at ${evalText}.`
    : `At that moment the game's move ${g.pivotSan} was already the engine's top choice; the damage came later. The position stood at ${evalText}.`
  return `${head}. ${verdict}`
}

function defaultOpTitle(op: PlanOp): string {
  if (op.op === 'gen') {
    const label: Record<string, string> = {
      level_puzzle: 'Generate an engine-verified puzzle',
      mate_hunt: 'Generate a verified forced-mate puzzle',
      endgame_drill: 'Generate a verified endgame task',
      level_quiz: 'Generate a level quiz',
      position_drill: 'Turn the board position into a drill',
    }
    const base = label[op.skill ?? ''] ?? 'Generate verified material'
    // The theme is deliberately NOT named: the step title is read while the
    // generated card is still unsolved, and "Generate a puzzle on fork" hands
    // the student the answer's family before the first move.
    return base
  }
  if (op.op === 'game') {
    return op.cmd === 'pivot' ? 'Put the turning move under the engine' : 'Pull the numbers from a stored game'
  }
  const boardLabel: Record<string, string> = {
    analyze: 'Analyze the position on the board',
    best: "Ask the engine for the best move here",
    eval: 'Weigh up the position',
    threats: 'List what the opponent threatens',
    describe: 'Describe the position in words',
  }
  return boardLabel[op.cmd ?? 'describe'] ?? 'Read the board'
}

// ---------------------------------------------------------------------------
// Phase 1: OBSERVE. Real data, really gathered, streamed as it happens.
// ---------------------------------------------------------------------------

export interface Assessment {
  ledger: Awaited<ReturnType<typeof scanLedger>>
  facts: string[]
  focus: { concept: string; why: string }
  summary: string
}

export async function runAssessment(env: AgentEnv, ctx: StepCtx): Promise<Assessment> {
  ctx.log('Reading your ledger: games, mastery, streaks, review queue')
  const l = await scanLedger(env)
  ctx.data.ledger = l
  const f = focusConcept(l)
  ctx.data.focus = f.concept

  const facts: string[] = [
    `Student: ${env.profile.name || 'unnamed'}, self-level ${env.profile.skillLevel}, course ${l.tierTitle} level ${l.levelN} ("${l.levelTitle}").`,
    `Activity: ${l.games.length} games stored, ${l.lessonsDone} lessons done, ${l.puzzleSolved} puzzles solved, ${l.streak}-day streak, ${l.todayMinutes}/${l.goalMinutes} active minutes today, ${l.reviewDue} reviews due.`,
  ]
  // The two rating signals are pre-compared here, verdict included, because a
  // model given two bare numbers will occasionally invent a comparison that
  // runs the wrong way ("1206 is below 1171"). State the gap once, truthfully.
  if (l.puzzleRating != null && l.botElo > 0) {
    const gap = l.puzzleRating - l.botElo
    if (Math.abs(gap) < 50) {
      facts.push(`Puzzle rating ${l.puzzleRating} and bot-play estimate ${l.botElo} agree (within 50 points).`)
    } else if (gap > 0) {
      facts.push(`Puzzle rating ${l.puzzleRating} sits ${gap} points above the bot-play estimate ${l.botElo}: measured tactics are currently the stronger signal. If you plan around a weakness, do not call tactics the weak side.`)
    } else {
      facts.push(`Puzzle rating ${l.puzzleRating} sits ${-gap} points below the bot-play estimate ${l.botElo}: tactics are trailing the game-play estimate, which makes tactical material a strong candidate for the plan.`)
    }
  } else {
    if (l.puzzleRating != null) facts.push(`Puzzle rating: ${l.puzzleRating}.`)
    if (l.botElo > 0) facts.push(`Bot-play Elo estimate: ${l.botElo}.`)
  }
  if (l.mastery.length) {
    const trained = l.mastery.filter((m) => m.attempts >= 2).slice(0, 6)
    if (trained.length) {
      facts.push(`Measured motif mastery (lowest first): ${trained.map((m) => `${m.concept} ${Math.round(m.mastery * 100)}% over ${m.attempts} attempts`).join('; ')}.`)
    } else {
      facts.push(`Motifs seen but not yet measured twice: ${l.mastery.slice(0, 6).map((m) => m.concept).join(', ')}.`)
    }
  }
  if (l.missedThemes.length) {
    facts.push(`Most-missed themes on recent material: ${l.missedThemes.slice(0, 5).map((m) => `${m.theme} (${m.n}x)`).join(', ')}.`)
  }
  const recent = l.games.slice(0, 3)
  if (recent.length) {
    const lines = recent.map((g, i) => {
      const acc = g.playerAcc != null ? ` ${g.playerAcc}% accuracy` : ''
      const piv = g.pivotSan != null && g.pivotLoss != null ? ` pivotal miss: ${g.pivotSan} (-${Math.round(g.pivotLoss / 100)} pawns)` : ''
      return `${i + 1}. ${g.result} as ${g.color === 'w' ? 'White' : 'Black'} vs ${g.botName}${acc}${piv}`
    })
    facts.push(`Games on file, newest first (the game op takes which: "last" | "loss" | "win" | "draw"): ${lines.join('; ')}.`)
  }
  if (l.unsolvedArtifacts > 0) facts.push(`${l.unsolvedArtifacts} generated tasks are still unsolved on the drills shelf${l.unsolvedQuizzes ? `, ${l.unsolvedQuizzes} of them quizzes: prefer a puzzle or a drill over another quiz unless the goal really is a quiz` : ''}.`)

  // The board, when a real position stands there.
  if (typeof env.ctx.fen === 'string' && env.ctx.fen) {
    try {
      const out = await boardDescribe({
        message: '',
        cfg: env.cfg,
        profile: { id: env.profile.id, name: env.profile.name, skillLevel: env.profile.skillLevel, coach: 'nina', darkMode: 'system', soundEnabled: true },
        ctx: env.ctx,
        coach: coachById('nina'),
        runGeneration: async () => {
          throw new Error('no generation inside assessment')
        },
      })
      if (out?.content) facts.push(`Position on the practice board: ${out.content.slice(0, 300)}`)
    } catch {
      /* a broken FEN simply contributes no facts */
    }
  }

  ctx.data.facts = facts
  // The summary must not claim a measurement that does not exist: when no
  // motif has two attempts on record, say "focus", not "weakest measured".
  const measured = l.mastery.some((m) => m.attempts >= 2)
  const summary = `${l.games.length} games, ${l.mastery.length} concepts tracked, ${l.lessonsDone} lessons done, ${l.streak}-day streak, ${l.reviewDue} reviews due; ${measured ? `weakest measured motif: ${f.concept}` : `focus concept (no measurements yet, chosen from the level): ${f.concept}`}`
  return { ledger: l, facts, focus: f, summary }
}

// ---------------------------------------------------------------------------
// Phase 2: PLAN. The model designs the remaining steps from the real facts.
// ---------------------------------------------------------------------------

function planPrompt(goal: string, facts: string[], recipe: MissionRecipe | null, hasFen: boolean, feedback: string): string {
  return [
    recipe
      ? `Mission type: "${recipe.title}" (${recipe.id}). The student asked for: ${recipe.goal}`
      : `The student's goal: "${goal.slice(0, 300)}"`,
    recipe ? `A ${recipe.title} usually covers steps like: ${recipe.stepTitles.join(' -> ')}. Treat that as the intent to cover, NOT a fixed script: reorder, drop or replace steps based on what the data below actually says.` : '',
    feedback ? `Your previous plan was rejected: ${feedback}. Fix it.` : '',
    'REAL DATA gathered this second (your plan must be justified by it):',
    ...facts.map((f) => `- ${f}`),
    hasFen ? 'There IS a position on the practice board, so board ops and position_drill are allowed.' : 'There is NO real position on the board (just the start), so do NOT use position_drill and do NOT use board ops.',
    'Design the REST of the mission (assessment already ran). Answer with ONE JSON object, no fences:',
    '{"title":"<max 6 words>","steps":[{"op":"gen","skill":"level_puzzle","theme":"discoveredAttack","title":"Drill your weakest motif","why":"<cite a number from the REAL DATA above, like the exact mastery % or miss count>"}]}',
    'Allowed ops: "gen" (skill: level_puzzle | mate_hunt | endgame_drill | level_quiz | position_drill; optional theme from: fork, pin, skewer, discoveredAttack, doubleAttack, removingDefender, winningMaterial, sacrifice, defense, development, center, castlingSafety, kingSafety, pawnStructure, openFiles, pieceActivity, kingActivity, opposition, outposts, zugzwang, calculation, prophylaxis, coordination, pawnBreaks, bishopPair, initiative, technique, tempo, tradeDecisions, endgame, promotion, mate), "game" (cmd: overview | pivot; which: last | loss | win | draw; reads a REAL stored game, overview reports its numbers, pivot puts the turning move under the engine) and "board" (cmd: analyze | best | eval | threats | describe; acts ONLY on the practice board, never on a stored game).',
    'Use the game op (not a board op) for anything about a played game, its result, its turning move or the mistakes in it. Use position_drill or board ops only for the position standing on the practice board right now.',
    'A "pivot" game read only pays off when the chosen game was actually analyzed (its facts say analyzed: true). For an unanalyzed game a pivot step can only say "no data", so plan at most one game read for it. Never plan two steps that read the same data and would report the same thing twice.',
    'Rules: 3 to 7 steps. At most 5 gen steps and at most ONE level_quiz step. Every step title must name the CONCRETE thing chosen from the data (the motif, the game by opponent name, the weakness), never "your weakness" generically. Every step needs a why that cites the number or fact that justified it (mastery %, miss count, the game result). Every number in a why must come from the REAL DATA above: never reuse the example JSON, never invent a percentage. End with a gen step so the mission ships something to solve. Never invent other ops.',
    'Numeric honesty: never claim one number is higher or lower than another unless the facts line already states that comparison. The rating fact carries its verdict in words; quote it instead of re-deriving it.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function planWithFacts(env: AgentEnv, goal: string, facts: string[], recipe: MissionRecipe | null, hasFen: boolean): Promise<PlannedSpec | null> {
  let spec: PlannedSpec | null = null
  let feedback = ''
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    try {
      const text = await runChat(
        env.cfg,
        'You are the planning core of a chess training agent. You design missions from real student data. Answer with ONE JSON object and nothing else. No em dashes.',
        [{ role: 'user', content: planPrompt(goal, facts, recipe, hasFen, feedback) }],
        600,
      )
      let raw = text.trim()
      const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
      if (fence) raw = fence[1].trim()
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start === -1 || end <= start) {
        feedback = 'the answer was not a JSON object'
        continue
      }
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
      spec = validateSpec(parsed, hasFen)
      if (!spec) feedback = 'the plan used unknown ops, too many steps, too many generations, or no deliverable at the end'
    } catch {
      feedback = 'the answer could not be parsed'
    }
  }
  return spec
}

// ---------------------------------------------------------------------------
// Phase 3: ACT. Ops become executable steps; each one still runs the verified
// skill battery, so the model plans but never writes chess content.
// ---------------------------------------------------------------------------

function buildOpStep(env: AgentEnv, op: PlanOp, i: number): AgentStep {
  const title = cleanLine(op.title, 60) || defaultOpTitle(op)
  return {
    id: `op${i}`,
    title,
    async run(ctx: StepCtx) {
      if (op.op === 'game') {
        // Runtime dedupe, two layers:
        // 1. the exact same read planned twice is skipped outright;
        // 2. a pivot read on a game that never went through Game review has
        //    no turning move to show, it can only repeat the overview line,
        //    so it skips itself with the honest reason instead.
        const key = `${op.cmd ?? 'overview'}:${op.which ?? 'last'}`
        const reads = (ctx.data.gameReads ??= {}) as Record<string, number>
        if (reads[key]) {
          throw new StepSkip(`Skipped: the ${op.which ?? 'last'} game was already read in step ${reads[key]}; repeating it would say the same thing twice.`)
        }
        reads[key] = i + 1
        if ((op.cmd ?? 'overview') === 'pivot') {
          const rows = await db.gameRecord.findMany({
            where: { profileId: env.profile.id },
            orderBy: { createdAt: 'desc' },
            take: 12,
          })
          const chosen = pickGame(rows, op.which ?? 'last')
          if (chosen && !chosen.analyzedAt) {
            throw new StepSkip('Skipped: this game never went through Game review, so there is no stored turning move to put under the engine. Review the game first, then re-run this mission.')
          }
        }
        ctx.log(op.cmd === 'pivot' ? 'Putting the turning move under the engine' : 'Reading the stored game report')
        return cleanLine(await gameOutcome(env, { cmd: (op.cmd ?? 'overview') as 'overview' | 'pivot', which: op.which }), 800)
      }
      if (op.op === 'gen') {
        const theme = op.theme ?? (ctx.data.focus as string | undefined)
        // Neutral log: naming the theme here would spoil the unsolved card.
        ctx.log('Generating and verifying')
        let a
        try {
          a = await stepGenEscalate(env, (op.skill ?? 'level_puzzle') as SkillId, theme)
        } catch (first) {
          // A real agent does not die on the first empty angle: it re-aims.
          // Same deliverable class, constraint dropped, honestly narrated.
          const wanted = (op.skill ?? 'level_puzzle') as SkillId
          if (wanted === 'position_drill') {
            ctx.log('The board position offered no unique point, so a level puzzle takes its place')
            a = await stepGenEscalate(env, 'level_puzzle')
          } else if (theme) {
            ctx.log('That angle produced nothing verified, re-crafting without the constraint')
            a = await stepGenEscalate(env, wanted === 'level_quiz' ? 'level_quiz' : 'level_puzzle')
          } else {
            throw first
          }
        }
        ctx.addArtifact(a)
        // The step detail carries the real teaching content: the line, the
        // hint and the idea, so the report and the checklist say something.
        return artifactDetail(a)
      }
      ctx.log('Reading the board with the engine')
      const out = await boardOutcome(env, (op.cmd ?? 'describe') as BoardCmd)
      const text = out.content ?? ''
      // The describe read ends in a square-by-square ASCII board built for the
      // chat transcript. Inside a mission checklist that dump is noise: the
      // step detail keeps the material/castling prose and drops the plate.
      const prose = op.cmd === 'describe' || text.includes('The full piece list is below')
        ? text.split('\n\n')[0] ?? text
        : text
      return cleanLine(prose, 400)
    },
  }
}

// ---------------------------------------------------------------------------
// The mission shell: assess -> plan -> (model-designed steps) -> report.
// ---------------------------------------------------------------------------

export function planDynamicMission(env: AgentEnv, goal: string, recipe: MissionRecipe | null): SuperSkillPlan {
  const base = resolveLevelContext(env.ctx.tier, env.ctx.level, env.profile.skillLevel)
  return {
    title: recipe?.title ?? (cleanLine(goal, 40) || 'Custom Mission'),
    goal: recipe?.goal ?? goal.slice(0, 200),
    steps: [
      {
        id: 'assess',
        title: 'Read the situation',
        critical: true,
        async run(ctx: StepCtx) {
          const a = await runAssessment(env, ctx)
          return a.summary
        },
      },
      {
        id: 'plan',
        title: 'Plan the work from what is true',
        async run(ctx: StepCtx) {
          const facts = (ctx.data.facts as string[] | undefined) ?? []
          ctx.log('Designing the mission from your real numbers')
          const spec = await planWithFacts(env, goal, facts, recipe, Boolean(env.ctx.fen))
          if (spec && spec.ops.length) {
            ctx.addSteps(spec.ops.map((op, i) => buildOpStep(env, op, i)))
            const why = spec.ops
              .map((o, i) => {
                const t = cleanLine(o.title, 60) || defaultOpTitle(o)
                return `${i + 1}. ${t}${o.why ? ` (because ${cleanLine(o.why, 100)})` : ''}`
              })
              .join('; ')
            ctx.data.planNote = `Planned ${spec.ops.length} steps for the goal "${goal.slice(0, 120)}": ${why}`
            // The plan is narrated with its reasons, not locked like a
            // template: each step names the fact that justified it, so the
            // student can see the plan was built from THEIR data.
            return `Plan built from your numbers (${spec.ops.length} steps): ${why}`
          }
          // The model could not produce a valid plan: fall back to the proven
          // playbook for this mission type, honestly labeled.
          const fallback = fallbackOps(goal, recipe)
          ctx.addSteps(fallback.ops.map((op, i) => buildOpStep(env, op, i)))
          ctx.data.planNote = `Model plan rejected three times; ran the proven ${recipe?.title ?? 'default'} playbook instead: ${fallback.ops.map((o) => defaultOpTitle(o)).join('; ')}`
          return `The model plan would not validate, so the proven ${recipe?.title ?? 'default'} playbook runs instead (${fallback.ops.length} steps), still aimed at your weakest measured motif`
        },
      },
    ],
    writeReport: async (state: ReportState) => {
      const facts: string[] = [`Mission goal: ${(recipe?.goal ?? goal).slice(0, 200)}`]
      if (state.data.planNote) facts.push(String(state.data.planNote))
      if (state.data.focus) facts.push(`Focus concept: ${String(state.data.focus)}`)
      for (const s of state.steps) {
        if (s.status === 'done' && s.detail) facts.push(`Step "${s.title}": ${s.detail}`)
        if (s.status === 'failed') facts.push(`Step "${s.title}" FAILED: ${s.detail ?? 'unknown reason'}`)
      }
      for (const a of state.artifacts) {
        // The report is read before the student solves the card: no solution
        // line, no title ("Knight sacrifice forces mate" gives the game away)
        // and no explanation (it walks the moves). Kind, verification and
        // rating only; the reward lives inside each card.
        facts.push(
          [
            `Delivered a ${a.kind}${a.engineVerified ? ' (engine-verified)' : ''}${a.rating != null ? ` at ${a.rating} Elo` : ''}`,
            a.goal ? `goal: ${a.goal}` : null,
          ]
            .filter(Boolean)
            .join('. '),
        )
      }
      const fallback = [
        `Mission "${recipe?.title ?? 'Custom'}" closed.`,
        ...state.steps.map((s) => `- ${s.title}: ${s.status === 'done' ? s.detail ?? 'done' : s.status}`),
        state.artifacts.length ? 'Everything above that shipped is verified and sitting on your drills shelf.' : '',
      ].filter(Boolean).join('\n')
      return composeReport(env, fallback, facts)
    },
  }
}

/** The honest fallback when the model plan will not validate: the classic
 * shape for this mission type, still data-driven (themes resolve to the
 * student's weakest motif at run time, scan already ran). */
function fallbackOps(goal: string, recipe: MissionRecipe | null): { ops: PlanOp[] } {
  const g = `${recipe?.id ?? ''} ${goal}`.toLowerCase()
  const gen = (skill: SkillId, theme?: string): PlanOp => ({ op: 'gen', skill, theme })
  if (recipe) {
    // Follow the recipe's own shape: material missions end with a deliverable.
    const wantsMate = recipe.id === 'plan' || recipe.id === 'bootcamp' || recipe.id === 'gauntlet'
    return {
      ops: [
        gen('level_puzzle'),
        ...(wantsMate ? [gen('mate_hunt')] : []),
        gen('level_quiz'),
      ],
    }
  }
  if (/\b(endgame)\b/.test(g)) return { ops: [gen('endgame_drill'), gen('level_quiz')] }
  if (/\b(mate|checkmate)\b/.test(g)) return { ops: [gen('mate_hunt'), gen('level_puzzle')] }
  if (/\b(opening|repertoire)\b/.test(g)) return { ops: [gen('level_puzzle', 'development'), gen('level_quiz', 'center')] }
  return { ops: [gen('level_puzzle'), gen('level_quiz')] }
}

/** Back-compat shim: the free-form /agent command. */
export async function planFreeform(env: AgentEnv, goal: string): Promise<SuperSkillPlan | null> {
  return planDynamicMission(env, goal, null)
}

/** Build the recipe description for a named superskill from its template. */
export function recipeFrom(template: { title: string; goal: string; steps: AgentStep[] }, id: string): MissionRecipe {
  return {
    id,
    title: template.title,
    goal: template.goal,
    stepTitles: template.steps.map((s) => s.title),
  }
}

export type { SuperSkillPlan }
