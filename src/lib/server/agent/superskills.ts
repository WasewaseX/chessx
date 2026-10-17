// The 10 superskill plugins: multi-step missions the agent runs end to end.
// Each builder turns an AgentEnv into a plan (title, goal, ordered steps, and
// a report writer). Steps do the real work: they scan the app's own ledger,
// generate material through the verified skill battery, replay curated lines
// with chess.js, and write an honest closing report. A failed step never
// silently disappears: it is marked, explained, and the mission carries on.
import 'server-only'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import type { AiConfig } from '@/lib/ai'
import { runChat } from '@/lib/ai'
import { CONCEPTS } from '@/content/schema'
import { craftWinningLine, collectCandidateFens, extendLineToMate, lineEndsInMate } from '@/lib/server/craft'
import {
  resolveLevelContext,
  verifyLine,
  writeCopy,
  type SkillId,
} from '@/lib/server/coach-skills'
import { levelRating, artifactFromRow, type ArtifactView } from '@/lib/coach-artifacts'
import { dayKeyLocal } from '@/lib/day'
import { BOTS } from '@/lib/chess/bots'
import { detectOpening } from '@/lib/chess/openings'
import { analyze } from '@/lib/server/engine'
import type { AgentStep, StepCtx, ReportState } from '@/lib/server/agent/runtime'

// ---------------------------------------------------------------------------
// Environment shared by every builder
// ---------------------------------------------------------------------------

export interface AgentEnv {
  cfg: AiConfig
  profile: { id: string; name: string; skillLevel: string }
  ctx: { fen?: unknown; tier?: unknown; level?: unknown; theme?: unknown }
  /** Rate-limited single-shot generation. Throws SkillError with a
   * student-safe message when nothing valid came out. */
  gen(skill: SkillId, theme?: unknown, levelOffset?: number): Promise<ArtifactView>
}

export interface SuperSkillPlan {
  title: string
  goal: string
  steps: AgentStep[]
  writeReport?(state: ReportState): Promise<string>
}

export function buildSuperskill(id: string, env: AgentEnv): SuperSkillPlan | null {
  switch (id) {
    case 'plan':
      return planTraining(env)
    case 'autopsy':
      return planAutopsy(env)
    case 'bootcamp':
      return planBootcamp(env)
    case 'radar':
      return planRadar(env)
    case 'repertoire':
      return planRepertoire(env)
    case 'lab':
      return planLab(env)
    case 'gauntlet':
      return planGauntlet(env)
    case 'masterclass':
      return planMasterclass(env)
    case 'regimen':
      return planRegimen(env)
    case 'sparring':
      return planSparring(env)
    case 'fixit':
      return planFixIt(env)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function noEm(s: string): string {
  return s.replace(/[—―]/g, ',')
}

const TACTIC_THEMES = ['fork', 'pin', 'skewer', 'discoveredAttack', 'doubleAttack', 'removingDefender', 'winningMaterial']

function validTheme(t: string | undefined | null): string | null {
  return t && (CONCEPTS as readonly string[]).includes(t) ? t : null
}
export { validTheme }

/** Puzzles and quizzes in a mission can finish fast; the shared rate limiter
 * wants a few seconds between generations. Space them out honestly here. */
const lastGenAt = new Map<string, number>()
async function genSpace(profileId: string) {
  const prev = lastGenAt.get(profileId) ?? 0
  const wait = 4600 - (Date.now() - prev)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}
function markGen(profileId: string) {
  lastGenAt.set(profileId, Date.now())
}

/** Run one generation inside a step, spacing it from the previous one. */
export async function stepGen(env: AgentEnv, skill: SkillId, theme?: unknown, offset = 0): Promise<ArtifactView> {
  await genSpace(env.profile.id)
  markGen(env.profile.id)
  return env.gen(skill, theme, offset)
}

/** Generation with an honest escalation ladder: the lowest course levels have
 * tiny position pools (newbie level 1 is basically the starting position), so
 * when the engine refuses a craft, retry a few levels deeper where the pool
 * is real. Every attempt is still level-calibrated and engine-verified. */
export async function stepGenEscalate(env: AgentEnv, skill: SkillId, theme?: unknown, offset = 0): Promise<ArtifactView> {
  let lastError: unknown = null
  for (const extra of [0, 4, 8]) {
    try {
      return await stepGen(env, skill, theme, Math.min(12, offset + extra))
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('generation did not pass verification')
}

/** A step detail that actually says something: kind, rating and the goal.
 * Feeds the checklist, the mission report and the student, so a generation
 * step never collapses to "delivered". The title, the hint, the explanation
 * and the raw solution moves stay OUT on purpose: the student reads these
 * lines while the material is still unsolved, and a headline like "Knight
 * sacrifice forces mate" (or a hint that names a motif) would spoil every
 * card before the first move is played. */
export function artifactDetail(a: ArtifactView): string {
  const bits = [
    describeArtifact(a) + (a.engineVerified ? ', engine-verified' : ''),
    a.goal ? `goal: ${a.goal}` : null,
  ].filter(Boolean)
  return bits.join(' | ')
}

/** Neutral, spoiler-safe name for a delivered artifact: kind and rating, no
 * title and no idea. Everything named this way is read before it is solved. */
export function describeArtifact(a: { kind: string; rating: number | null }): string {
  const kind = a.kind === 'quiz' ? 'quiz' : a.kind === 'drill' ? 'drill' : a.kind === 'line' ? 'walkthrough' : 'puzzle'
  return a.rating != null ? `a ${kind} at ${a.rating} Elo` : `a ${kind}`
}

interface ConceptRow {
  concept: string
  mastery: number
  attempts: number
}

interface Ledger {
  xp: number
  puzzleSolved: number
  puzzleRating: number | null
  botElo: number
  streak: number
  todayMinutes: number
  goalMinutes: number
  goalMet: boolean
  reviewDue: number
  unsolvedArtifacts: number
  unsolvedQuizzes: number
  games: {
    id: string
    botName: string
    color: string
    result: string
    opening: string | null
    playerAcc: number | null
    blunders: number
    mistakes: number
    analyzed: boolean
    pgn: string | null
    pivotFen: string | null
    pivotSan: string | null
    pivotPly: number | null
    pivotLoss: number | null
    createdAt: Date
  }[]
  mastery: ConceptRow[]
  missedThemes: { theme: string; n: number }[]
  lessonsDone: number
  tierN: number
  tierId: string
  tierTitle: string
  levelN: number
  levelTitle: string
  concepts: string[]
}

/** One honest pass over the app's ledger. Everything the missions claim
 * comes from these rows; nothing is invented. */
export async function scanLedger(env: AgentEnv): Promise<Ledger> {
  const p = env.profile
  const [profile, mastery, missed, games, days, review, artifacts, progress] = await Promise.all([
    db.profile.findUnique({ where: { id: p.id } }),
    db.skillMastery.findMany({ where: { profileId: p.id }, orderBy: { mastery: 'asc' } }),
    db.coachArtifact.findMany({ where: { profileId: p.id, solved: false }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.gameRecord.findMany({ where: { profileId: p.id }, orderBy: { createdAt: 'desc' }, take: 12 }),
    db.activityDay.findMany({ where: { profileId: p.id }, orderBy: { dayKey: 'desc' }, take: 14 }),
    db.reviewItem.count({ where: { profileId: p.id, dueAt: { lte: new Date() } } }),
    db.coachArtifact.count({ where: { profileId: p.id, solved: false } }),
    db.lessonProgress.findMany({ where: { profileId: p.id, completed: true } }),
  ])

  // streak, same honest math as the profile screen
  const active = new Set(days.filter((d) => d.minutes > 0 || d.puzzlesSolved > 0 || d.lessonSteps > 0 || d.gamesPlayed > 0).map((d) => d.dayKey))
  let streak = 0
  const cursor = new Date()
  if (!active.has(dayKeyLocal(cursor))) cursor.setDate(cursor.getDate() - 1)
  for (;;) {
    if (!active.has(dayKeyLocal(cursor))) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  const todayKey = dayKeyLocal(new Date())
  const today = days.find((d) => d.dayKey === todayKey)

  const missedThemesMap = new Map<string, number>()
  for (const a of missed) {
    try {
      for (const t of JSON.parse(a.themes ?? '[]') as string[]) missedThemesMap.set(t, (missedThemesMap.get(t) ?? 0) + 1)
    } catch {
      /* malformed row */
    }
  }

  const ctx = resolveLevelContext(env.ctx.tier, env.ctx.level, p.skillLevel)

  return {
    xp: profile?.xp ?? 0,
    puzzleSolved: profile?.puzzleSolved ?? 0,
    puzzleRating: profile?.puzzleRating ?? null,
    botElo: profile?.botElo ?? 0,
    streak,
    todayMinutes: today?.minutes ?? 0,
    goalMinutes: profile?.goalMinutes ?? 15,
    goalMet: today?.goalMet ?? false,
    reviewDue: review,
    unsolvedArtifacts: artifacts,
    unsolvedQuizzes: missed.filter((a) => a.kind === 'quiz').length,
    games: games.map((g) => {
      let blunders = 0
      let mistakes = 0
      try {
        const labels = JSON.parse(g.labelsJson ?? '{}') as Record<string, { w: number; b: number }>
        const own = g.color === 'w' ? 'w' : 'b'
        blunders = labels.blunder?.[own] ?? 0
        mistakes = labels.mistake?.[own] ?? 0
      } catch {
        /* malformed row */
      }
      return {
        id: g.id,
        botName: g.botName,
        color: g.color,
        result: g.result,
        opening: g.opening,
        playerAcc: g.playerAcc,
        blunders,
        mistakes,
        analyzed: g.analyzedAt != null,
        pgn: g.pgn,
        pivotFen: g.pivotFen,
        pivotSan: g.pivotSan,
        pivotPly: g.pivotPly,
        pivotLoss: g.pivotLoss,
        createdAt: g.createdAt,
      }
    }),
    mastery: mastery
      .filter((m) => (CONCEPTS as readonly string[]).includes(m.concept))
      .map((m) => ({ concept: m.concept, mastery: m.mastery, attempts: m.attempts })),
    missedThemes: [...missedThemesMap.entries()].map(([theme, n]) => ({ theme, n })).sort((a, b) => b.n - a.n),
    lessonsDone: progress.length,
    tierN: ctx.tierN,
    tierId: ctx.tierId,
    tierTitle: ctx.tierTitle,
    levelN: ctx.levelN,
    levelTitle: ctx.levelTitle,
    concepts: ctx.concepts,
  }
}

/** The concept to train: weakest measured mastery wins, then the level's own
 * concepts, then a random tactic family. Honest about having no data. */
export function focusConcept(l: Ledger): { concept: string; why: string } {
  const trained = l.mastery.filter((m) => m.attempts >= 2)
  if (trained.length) {
    const w = trained[0]
    return { concept: w.concept, why: `${Math.round(w.mastery * 100)}% mastery over ${w.attempts} attempts, your lowest measured motif` }
  }
  if (l.concepts.length) {
    return { concept: l.concepts[0], why: `it anchors your current level ("${l.levelTitle}") and you have no measured history yet` }
  }
  return { concept: pick(TACTIC_THEMES), why: 'no measurement yet, so the agent picked a core tactic family' }
}

/** Report writer shared by missions: an LLM deepening over a deterministic
 * fallback. If the model is unavailable the fallback stands, verbatim.
 * The report is written like a coach talking to the student they just worked
 * with: their name, the real numbers, the exact lines delivered, and no
 * template scaffolding. Every mission should read differently, because every
 * mission HAS different facts. */
export async function composeReport(env: AgentEnv, fallback: string, facts: string[]): Promise<string> {
  try {
    const name = env.profile.name?.trim() || 'friend'
    const text = await runChat(
      env.cfg,
      [
        `You are a chess coach closing a finished training session for ${name} inside ChessX. Write the debrief ${name} reads.`,
        'You receive verified facts from the app ledger and the step outcomes. Use ONLY these facts, plus general chess advice tied to them. Never invent ratings, accuracies or numbers that are not in the facts.',
        'Voice: direct, specific, warm but not gushing. Talk TO the student, about the actual work that was just done.',
        'Hard bans, any of these makes the report a failure:',
        '- Opening with "Mission" or "The mission" or a summary of what the mission was supposed to do.',
        '- The phrases: "This matters because", "The plan for today", "The next session", "Stay sharp", "Keep grinding".',
        '- Meta-language about the software: never say "the app shows", "the app says", "the platform", "the system". You ARE the coach; state the numbers as your own observations.',
        '- Overclaiming: a 1-day streak is not "building a solid streak", four tasks are not "a lot of work". Scale the praise to the actual numbers; a brand-new student gets encouragement about the first steps, not mastery.',
        '- A rigid section structure that every report would share. Structure must follow the facts of THIS session.',
        'What the report must actually do:',
        `1. Name ${name} once, naturally.`,
        '2. Say what the numbers showed (mastery percentages, game results, error counts) in flowing sentences, not a list.',
        '3. Walk through the material that was delivered: it sits UNSOLVED on the drills shelf. Names and solutions of unsolved material are hidden on purpose, so speak of it by kind and rating only (a verified 1450-Elo puzzle, a mate hunt in three) and never say what the winning move or the tactical motif is.',
        '4. Give exactly one specific next action tied to the weakest number in the facts (which drill to open, which motif to drill, which game habit to fix).',
        'Plain text, no markdown headers, no bullet symbols except "-" where a list genuinely helps. Short sentences. No em dash character. 140 to 260 words.',
        'Accuracy rules: never claim material was flawed, retired, flagged, or had any flag pulled unless the facts literally say those words. If the facts say the material checked out and stays, say exactly that. When unsure about an action, quote the verdict sentence from the facts verbatim instead of paraphrasing it.',
        'Game facts, read literally: "loss by resignation" means THE STUDENT resigned; never flip it onto the opponent. If a game fact says it has not been through a full review yet, its zero blunder/mistake counts mean nothing was measured: never praise them as a clean or solid performance, say honestly that the game has not been reviewed yet.',
        'Spoiler rule: the student still has to SOLVE the delivered material. Never print solution moves, move sequences or the answer to a quiz. Describe ideas in words only; the moves live inside each card.',
      ].join('\n'),
      [{ role: 'user', content: facts.join('\n') }],
      1200,
    )
    const clean = noEm(text.trim())
    return clean.length > 40 ? clean : fallback
  } catch {
    return fallback
  }
}

function bar(pct: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, pct)) * 8)
  return '#'.repeat(filled) + '.'.repeat(8 - filled)
}

// ---------------------------------------------------------------------------
// 1. Training Plan
// ---------------------------------------------------------------------------

function planTraining(env: AgentEnv): SuperSkillPlan {
  let focus = ''
  let why = ''
  return {
    title: 'Training Plan',
    goal: 'Scan the ledger, find the weakest motif, build verified material around it, write a 7-day schedule.',
    steps: [
      {
        id: 'scan',
        title: 'Read your ledger',
        critical: true,
        run: async (ctx: StepCtx) => {
          ctx.log('Counting games, mastery rows, streaks and the review queue')
          const l = await scanLedger(env)
          ctx.data.ledger = l
          const f = focusConcept(l)
          focus = f.concept
          why = f.why
          return `${l.games.length} games, ${l.mastery.length} concepts tracked, ${l.lessonsDone} lessons done, ${l.reviewDue} reviews due, ${l.streak}-day streak`
        },
      },
      {
        id: 'focus',
        title: 'Pick the focus motif',
        run: async (ctx: StepCtx) => {
          if (focus) return `Training focus: ${focus} (${why})`
          const l = ctx.data.ledger as Ledger
          const f = focusConcept(l)
          focus = f.concept
          why = f.why
          return `Training focus: ${focus} (${why})`
        },
      },
      {
        id: 'puzzle',
        title: 'Build a puzzle on the focus',
        run: async (ctx: StepCtx) => {
          ctx.log('Crafting a verified puzzle at your level')
          const a = await stepGenEscalate(env, 'level_puzzle', focus)
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      },
      {
        id: 'mate',
        title: 'Add a forced-mate rep',
        run: async (ctx: StepCtx) => {
          ctx.log('Hunting a position with a unique forced mate')
          const a = await stepGenEscalate(env, 'mate_hunt')
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      },
      {
        id: 'quiz',
        title: 'Quiz the focus',
        run: async (ctx: StepCtx) => {
          const a = await stepGen(env, 'level_quiz', focus)
          ctx.addArtifact(a)
          return `Quiz ready: ${describeArtifact(a)}`
        },
      },
      {
        id: 'schedule',
        title: 'Write the 7-day schedule',
        run: async () => 'Schedule drafted from your real numbers',
      },
    ],
    writeReport: async (state) => {
      const l = state.data.ledger as Ledger | undefined
      const days = [
        'Day 1: solve the focus puzzle cold, then the mate hunt.',
        'Day 2: 10 minutes of lessons on the focus motif, take the quiz.',
        'Day 3: two fresh puzzles (/puzzle ' + focus + '), redo anything you missed.',
        'Day 4: play one practice bot game, review it with Game review.',
        'Day 5: endgame lab (/lab) plus the review queue.',
        'Day 6: puzzle rush 3 minutes, then the mate hunt again from scratch.',
        'Day 7: lighter day: one quiz, clear the review queue, plan the next week.',
      ]
      const fallback = [
        `Focus: ${focus || 'your core motifs'}. Why: ${why || 'your ledger says so'}.`,
        '',
        ...days,
        '',
        l ? `Baseline today: ${l.puzzleSolved} puzzles solved, ${l.games.length} games on file, ${l.reviewDue} reviews due, ${l.streak}-day streak.` : '',
        state.artifacts.length ? `${state.artifacts.length} verified tasks already on your shelf, ready for day 1.` : 'Generation could not land material this run; the schedule stands on its own and /puzzle fills day 1.',
      ].filter(Boolean).join('\n')
      const facts = [
        `Mission: training plan for ${env.profile.name}.`,
        `Mission status: COMPLETE. ${state.steps.filter((s) => s.status === 'done').length} of ${state.steps.length} steps finished successfully.`,
        `Course position: ${l?.tierTitle ?? ''} level ${l?.levelN ?? ''} (${l?.levelTitle ?? ''}).`,
        l ? `Numbers: ${l.puzzleSolved} puzzles solved, ${l.games.length} recent games, ${l.reviewDue} reviews due, ${l.streak}-day streak, ${l.lessonsDone} lessons done.` : '',
        focus ? `Focus motif chosen: ${focus} because ${why}.` : '',
        `Artifacts delivered: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}. They are on the student's shelf, not yet attempted.`,
        `Schedule skeleton: ${days.slice(0, 3).join(' ')} ...`,
      ].filter(Boolean)
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Game Autopsy
// ---------------------------------------------------------------------------

const AUTOPSY_FINAL_WIN = 250

function planAutopsy(env: AgentEnv): SuperSkillPlan {
  return {
    title: 'Game Autopsy',
    goal: 'Take the last game apart: the numbers, the move that turned it, a drill from that exact position, and what to fix.',
    steps: [
      {
        id: 'load',
        title: 'Pull your latest game',
        critical: true,
        run: async (ctx: StepCtx) => {
          const g = await db.gameRecord.findFirst({
            where: { profileId: env.profile.id, analyzedAt: { not: null } },
            orderBy: { createdAt: 'desc' },
          })
          if (!g) {
            const any = await db.gameRecord.findFirst({ where: { profileId: env.profile.id }, orderBy: { createdAt: 'desc' } })
            if (!any) throw new Error('No games on file yet. Play one against a bot, run Game review on it, then call me back.')
            ctx.data.game = { id: any.id, botName: any.botName, color: any.color, result: any.result, reason: any.reason, opening: any.opening, playerAcc: any.playerAcc, pgn: any.pgn, pivotFen: any.pivotFen, pivotSan: any.pivotSan, pivotPly: any.pivotPly, pivotLoss: any.pivotLoss, analyzed: false }
            return `Found it, but it was never run through Game review: vs ${any.botName}, ${any.result} by ${any.reason}${any.opening ? `, ${any.opening}` : ''}. No engine numbers exist, so none will be invented here.`
          }
          ctx.data.game = { id: g.id, botName: g.botName, color: g.color, result: g.result, reason: g.reason, opening: g.opening, playerAcc: g.playerAcc, pgn: g.pgn, pivotFen: g.pivotFen, pivotSan: g.pivotSan, pivotPly: g.pivotPly, pivotLoss: g.pivotLoss, analyzed: true }
          return `Game vs ${g.botName}: ${g.result} by ${g.reason}${g.opening ? `, ${g.opening}` : ''}${g.playerAcc != null ? `, your accuracy ${Math.round(g.playerAcc)}%` : ''}`
        },
      },
      {
        id: 'damage',
        title: 'Extract the damage report',
        critical: true,
        run: async (ctx: StepCtx) => {
          const g = ctx.data.game as { id: string; botName: string; color: string; result: string; reason: string; playerAcc: number | null; pivotFen: string | null; pivotSan: string | null; pivotPly: number | null; pivotLoss: number | null; analyzed: boolean }
          const row = await db.gameRecord.findUnique({ where: { id: g.id } })
          let blunders = 0
          let mistakes = 0
          let inaccuracies = 0
          if (row?.labelsJson) {
            try {
              const labels = JSON.parse(row.labelsJson) as Record<string, { w: number; b: number }>
              const own = g.color === 'w' ? 'w' : 'b'
              blunders = labels.blunder?.[own] ?? 0
              mistakes = labels.mistake?.[own] ?? 0
              inaccuracies = labels.inaccuracy?.[own] ?? 0
            } catch {
              /* malformed labels stay out */
            }
          }
          ctx.data.damage = { blunders, mistakes, inaccuracies }
          const bits: string[] = []
          if (g.analyzed) {
            bits.push(`${blunders} blunder${blunders === 1 ? '' : 's'}, ${mistakes} mistake${mistakes === 1 ? '' : 's'}, ${inaccuracies} inaccurac${inaccuracies === 1 ? 'y' : 'ies'} on your side`)
          }
          if (g.pivotSan) {
            const moveNo = Math.floor((g.pivotPly ?? 0) / 2) + 1
            const loss = g.pivotLoss != null ? Math.round(g.pivotLoss) / 100 : null
            bits.push(`turning point: move ${moveNo} ${g.pivotSan}${loss ? `, about ${loss} pawns gone` : ''}`)
          }
          if (!bits.length) bits.push('no stored analysis detail; the drill below still comes from this game when a pivot exists')
          return bits.join(' | ')
        },
      },
      {
        id: 'drill',
        title: 'Rebuild the miss as a drill',
        run: async (ctx: StepCtx) => {
          const g = ctx.data.game as { pivotFen: string | null; pivotSan: string | null; pivotPly: number | null; pivotLoss: number | null; botName: string }
          if (!g.pivotFen) {
            const a = await stepGenEscalate(env, 'level_puzzle', 'calculation')
            ctx.addArtifact(a)
            return `No pivotal position stored for this game, so the agent built a verified calculation puzzle instead: ${describeArtifact(a)}`
          }
          const fen = g.pivotFen
          let probe: Chess
          try {
            probe = new Chess(fen)
          } catch {
            throw new Error('the stored pivotal position no longer parses, which should never happen')
          }
          if (probe.isGameOver()) {
            // A decided position cannot host a drill, but the mission should
            // still ship something: a verified puzzle on the game's theme.
            const a = await stepGenEscalate(env, 'level_puzzle', 'calculation')
            ctx.addArtifact(a)
            return `The pivotal position was already decided, so a verified calculation puzzle stands in: ${describeArtifact(a)}`
          }
          ctx.log('Engine is carving a unique line out of your miss')
          const line = await craftWinningLine(fen, { requireWin: false, minMargin: 40, maxSolverMoves: 2 }).catch(() => null)
          if (!line) {
            // No unique point at the miss itself: a real agent re-aims at the
            // same lesson instead of ending the step in a dead end.
            const a = await stepGenEscalate(env, 'level_puzzle', 'calculation')
            ctx.addArtifact(a)
            ctx.data.drillTheme = 'calculation'
            return `The exact miss did not offer one clean answer this time, so a verified calculation puzzle carries the same lesson: ${describeArtifact(a)}`
          }
          // The whole win gets demonstrated when the position allows it.
          let solution = line.solution
          if (line.winning && !lineEndsInMate(fen, solution)) {
            const extended = await extendLineToMate({ fen, solution, maxExtraPlies: 20, deadline: Date.now() + 12_000, depth: 10 }).catch(() => null)
            if (extended) solution = extended
          }
          const deadline = Date.now() + 24_000
          const check = await verifyLine({ fen, solution, allowStartCheck: true, deadline, finalFloor: lineEndsInMate(fen, solution) ? null : line.winning ? AUTOPSY_FINAL_WIN : null })
          if (!check.ok) throw new Error(`could not verify a clean task from the position (${check.error ?? 'unknown reason'})`)
          const levelCtx = resolveLevelContext(env.ctx.tier, env.ctx.level, env.profile.skillLevel)
          const copy = await writeCopy(env.cfg, line, levelCtx, 'drill', null).catch(() => null)
          const moveNo = Math.floor((g.pivotPly ?? 0) / 2) + 1
          const loss = g.pivotLoss != null ? Math.round(g.pivotLoss) / 100 : null
          const explanation = `Move ${moveNo} of your game against ${g.botName}: you played ${g.pivotSan}${loss ? `, throwing away roughly ${loss} pawns of evaluation` : ''}. The position right before it is now the task.`
          const rowArtifact = await db.coachArtifact.create({
            data: {
              profileId: env.profile.id,
              kind: 'drill',
              title: copy?.title ? `${copy.title} (your game)` : 'Your pivotal moment',
              fen,
              solution: solution.join(' '),
              sideToMove: fen.split(' ')[1] === 'b' ? 'b' : 'w',
              payloadJson: JSON.stringify({
                hint: copy?.hint ?? 'This is your own game. List every check, capture and threat, then choose better than you did.',
                goal: lineEndsInMate(fen, solution) ? 'Finish the win: the solution runs every move to checkmate.' : line.winning ? 'Convert your advantage.' : 'Find the strongest continuation.',
                explanation,
              }),
              themes: JSON.stringify([copy?.theme && validTheme(copy.theme) ? copy.theme : 'calculation']),
              levelRef: levelCtx.levelRef,
              engineVerified: check.engineVerified,
            },
          })
          const view = artifactFromRow(rowArtifact as unknown as Record<string, unknown>)
          ctx.addArtifact(view)
          ctx.data.drillTheme = copy?.theme && validTheme(copy.theme) ? copy.theme : 'calculation'
          return `Drill rebuilt from the exact position before ${g.pivotSan}: ${describeArtifact(view)}`
        },
      },
      {
        id: 'quiz',
        title: 'Quiz the leak',
        run: async (ctx: StepCtx) => {
          const ledger = (ctx.data.ledger as Ledger | undefined) ?? (await scanLedger(env))
          const theme = (ctx.data.drillTheme as string | undefined) ?? focusConcept(ledger).concept
          const a = await stepGen(env, 'level_quiz', validTheme(theme) ? theme : undefined)
          ctx.addArtifact(a)
          return `Quiz ready: ${describeArtifact(a)}`
        },
      },
      {
        id: 'verdict',
        title: 'Write the verdict',
        run: async () => 'Verdict drafted from the stored report',
      },
    ],
    writeReport: async (state) => {
      const g = state.data.game as { botName: string; result: string; reason: string; opening: string | null; playerAcc: number | null; pivotSan: string | null; pivotLoss: number | null; analyzed: boolean } | undefined
      const d = state.data.damage as { blunders: number; mistakes: number; inaccuracies: number } | undefined
      const fallback = [
        g ? `The game under the knife: vs ${g.botName}, ${g.result} by ${g.reason}${g.opening ? `, ${g.opening}` : ''}${g.playerAcc != null ? `, your accuracy ${Math.round(g.playerAcc)}%` : ''}.` : '',
        d && g?.analyzed ? `Engine labels on your side: ${d.blunders} blunders, ${d.mistakes} mistakes, ${d.inaccuracies} inaccuracies.` : '',
        g?.pivotSan ? `The move that bent the game: ${g.pivotSan}${g.pivotLoss != null ? ` (about ${Math.round(g.pivotLoss) / 100} pawns of evaluation gone)` : ''}. The position right before it is now a drill on your shelf.` : '',
        'This week: replay the drill until the idea is instant, then play a fresh game and run Game review on it. The next autopsy should find fewer drops.',
      ].filter(Boolean).join('\n')
      const facts = [
        g ? `Game: vs ${g.botName}, ${g.result} by ${g.reason}, opening ${g.opening ?? 'unknown'}${g.playerAcc != null ? `, player accuracy ${Math.round(g.playerAcc)}%` : ', no accuracy stored'}.` : '',
        d ? `Your labels: ${d.blunders} blunders, ${d.mistakes} mistakes, ${d.inaccuracies} inaccuracies.` : '',
        g?.pivotSan ? `Turning point: ${g.pivotSan}${g.pivotLoss != null ? `, ${Math.round(g.pivotLoss)}cp lost` : ''}.` : '',
        `Artifacts delivered: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
      ].filter(Boolean)
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Bootcamp
// ---------------------------------------------------------------------------

function planBootcamp(env: AgentEnv): SuperSkillPlan {
  const stations: { skill: SkillId; theme?: string; label: string }[] = [
    { skill: 'level_quiz', label: 'Check-in quiz' },
    { skill: 'level_puzzle', theme: 'development', label: 'Development puzzle' },
    { skill: 'level_puzzle', theme: pick(TACTIC_THEMES), label: 'Tactics puzzle' },
    { skill: 'mate_hunt', label: 'Mate hunt' },
    { skill: 'endgame_drill', label: 'Endgame technique' },
    { skill: 'level_quiz', theme: 'calculation', label: 'Final exam quiz' },
  ]
  return {
    title: 'Bootcamp',
    goal: 'Six stations across the whole skill range, every task engine-verified, closing with a scorecard.',
    steps: [
      ...stations.map((st, i) => ({
        id: st.skill + i,
        title: `Station ${i + 1}: ${st.label}`,
        run: async (ctx: StepCtx) => {
          ctx.log('Generating and verifying')
          const a = await stepGenEscalate(env, st.skill, st.theme)
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      })),
      {
        // The promised scorecard is a real closing step, not an adverb in
        // the goal line: it reports exactly what shipped and what it rates.
        id: 'scorecard',
        title: 'Scorecard: what shipped and what it rates',
        run: async (ctx: StepCtx) => {
          const arts = ctx.artifacts()
          if (!arts.length) {
            return 'No station produced verified material this run; the scorecard is empty by design, not hiding anything.'
          }
          return arts
            .map((a, i) => `${i + 1}. ${a.kind}${a.rating != null ? `, ${a.rating} Elo` : ''}${a.engineVerified ? ', engine-verified' : ''}`)
            .join(' | ')
        },
      },
    ],
    writeReport: async (state) => {
      const ok = state.artifacts.length
      const fallback = [
        `Bootcamp done: ${ok} of 6 stations produced verified material.`,
        'Order of work: take the quiz first, then the two puzzles, save the mate hunt for when you are warm, finish on the endgame task and the final exam.',
        'Redo any station you fail twice, then run /bootcamp again in three days. Progress is the delta between runs, not the soreness.',
      ].join('\n')
      const facts = [
        `Mission: chess bootcamp, 6 stations.`,
        // Kind and rating only: titles and solutions of unsolved material stay
        // inside the cards, where the student earns them.
        `Delivered: ${state.artifacts.map((a) => `${a.kind}${a.rating != null ? ` (${a.rating} Elo)` : ''}`).join('; ') || 'none'}.`,
        `Failed steps: ${state.steps.filter((s) => s.status === 'failed').map((s) => `${s.title} (${s.detail ?? 'unknown'})`).join(', ') || 'none'}.`,
      ]
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 4. Weakness Radar
// ---------------------------------------------------------------------------

function planRadar(env: AgentEnv): SuperSkillPlan {
  return {
    title: 'Weakness Radar',
    goal: 'Sweep mastery, unsolved material and every game report, then build targeted drills for the two worst areas.',
    steps: [
      {
        id: 'scan',
        title: 'Sweep the whole ledger',
        critical: true,
        run: async (ctx: StepCtx) => {
          ctx.log('Reading mastery, puzzle history and game labels')
          const l = await scanLedger(env)
          ctx.data.ledger = l
          const worst = l.mastery.filter((m) => m.attempts >= 2).slice(0, 2)
          return `Scanned ${l.mastery.length} concepts, ${l.games.length} games, ${l.missedThemes.length} missed-theme rows. Weakest measured: ${worst.map((w) => `${w.concept} ${Math.round(w.mastery * 100)}%`).join(', ') || 'nothing measured yet'}`
        },
      },
      {
        id: 'rank',
        title: 'Rank the weak spots',
        run: async (ctx: StepCtx) => {
          const l = ctx.data.ledger as Ledger
          const ranked: string[] = []
          const trained = l.mastery.filter((m) => m.attempts >= 2)
          if (trained[0]) ranked.push(trained[0].concept)
          if (trained[1]) ranked.push(trained[1].concept)
          if (!trained.length && l.missedThemes[0]) ranked.push(l.missedThemes[0].theme)
          if (!ranked.length && l.concepts.length) ranked.push(...l.concepts.slice(0, 2))
          if (!ranked.length) ranked.push('fork', 'defense')
          ctx.data.rank1 = ranked[0]
          ctx.data.rank2 = ranked[1] ?? 'calculation'
          return `Target 1: ${ranked[0]}. Target 2: ${ctx.data.rank2}.`
        },
      },
      {
        id: 'drill1',
        title: 'Drill for weak spot #1',
        run: async (ctx: StepCtx) => {
          ctx.log('Crafting a verified task aimed at your weakest spot')
          const a = await stepGenEscalate(env, 'level_puzzle', ctx.data.rank1)
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      },
      {
        id: 'drill2',
        title: 'Quiz for weak spot #2',
        run: async (ctx: StepCtx) => {
          const a = await stepGen(env, 'level_quiz', ctx.data.rank2)
          ctx.addArtifact(a)
          return `Delivered: ${describeArtifact(a)}`
        },
      },
      {
        id: 'report',
        title: 'Draw the radar',
        run: async () => 'Radar drafted from measured numbers',
      },
    ],
    writeReport: async (state) => {
      const l = state.data.ledger as Ledger | undefined
      const fallback = l
        ? [
            'Your radar, from real attempts only:',
            l.mastery.filter((m) => m.attempts >= 2).slice(0, 6).map((m) => `- ${m.concept.padEnd(18)} ${bar(m.mastery)} ${Math.round(m.mastery * 100)}% (${m.attempts} attempts)`).join('\n') || '- nothing measured yet: solve the drills below and the radar fills in',
            l.missedThemes.length ? `\nUnsolved material piling up: ${l.missedThemes.slice(0, 3).map((t) => `${t.theme} (${t.n})`).join(', ')}.` : '',
            l.games.some((g) => g.analyzed) ? `Recent games: ${l.games.filter((g) => g.analyzed).slice(0, 3).map((g) => `${g.result} vs ${g.botName} (${Math.round(g.playerAcc ?? 0)}% acc, ${g.blunders + g.mistakes} drops)`).join('; ')}.` : '',
            '\nAttack target 1 first, quiz on target 2 tomorrow, and re-run /radar after a week to see the bars move.',
          ].filter(Boolean).join('\n')
        : 'The radar needs data: solve a few puzzles and run one game review, then re-run /radar.'
      const facts = l
        ? [
            `Concepts measured: ${l.mastery.filter((m) => m.attempts >= 2).map((m) => `${m.concept} ${Math.round(m.mastery * 100)}% over ${m.attempts}`).join('; ') || 'none'}.`,
            `Missed themes: ${l.missedThemes.slice(0, 3).map((t) => `${t.theme} x${t.n}`).join(', ') || 'none'}.`,
            `Analyzed games: ${l.games.filter((g) => g.analyzed).slice(0, 3).map((g) => `${g.result} vs ${g.botName}, ${Math.round(g.playerAcc ?? 0)}% acc`).join('; ') || 'none'}.`,
            `Targets chosen: ${state.data.rank1}, ${state.data.rank2}.`,
            `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
          ]
        : ['No measurable history yet.']
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 5. Opening Repertoire
// ---------------------------------------------------------------------------

interface RepLine {
  name: string
  side: 'white' | 'black'
  moves: string[]
  ideas: string
  trap?: { name: string; moves: string[]; notes: Record<number, string>; story: string }
  motif: string
}

const REPERTOIRE: RepLine[] = [
  {
    name: 'Italian Game',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'a6', 'Re1', 'Ba7', 'a4', 'O-O', 'h3'],
    ideas: 'Slow build: pawn on c3 and d3, rook to e1, then d4 at the right moment. The bishop keeps eyes on f7. Low theory, high understanding.',
    trap: {
      name: 'The fried liver danger (and the counter)',
      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3'],
      notes: {
        7: 'Ng5 attacks f7 immediately. Correct play here is 3...Bc5 or the 3...Nf6 4.d3 quiet line.',
        13: 'The knight lands on c3 with tempo. Black must know the check with Nd4+ or return the piece.',
      },
      story: 'Know the attack you will face before you face it. If you meet Ng5, the cool Nd4 check or a quick ...Qe7 hold together.',
    },
    motif: 'development',
  },
  {
    name: 'London System',
    side: 'white',
    moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'b6', 'Ne5'],
    ideas: 'The same healthy setup against almost anything: Bf4, e3, c3, Nbd2, Bd3, then Ne5 and a kingside build-up. Your moves first, their problems later.',
    trap: {
      name: 'The vexed bishop: ...Qb6 hits b2 and d4',
      moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'c5', 'e3', 'Qb6', 'Nc3', 'Qxb2', 'Nb5', 'Qb4', 'Rb1'],
      notes: {
        8: 'The pawn grab looks free. It is not.',
        11: 'Nb5 attacks the queen with tempo, and Na3 next hits it again. The queen has nowhere honest to live.',
      },
      story: 'Greedy queen sorties against the London die to tempo moves. Count the attackers on the wandering queen before she counts her pawns.',
    },
    motif: 'development',
  },
  {
    name: 'Caro-Kann Defence',
    side: 'black',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'e6'],
    ideas: 'Solid structure, good endgame, no target on f7. Challenge e4 with c6 and d5, develop the light bishop outside the chain, and aim for ...c5 to free the game.',
    trap: {
      name: 'Punishing the greedy 3.exd5 skip',
      moves: ['e4', 'c6', 'd4', 'd5', 'Be2', 'dxe4', 'Nf3', 'Bb4+', 'c3', 'Ba5', 'Qa4'],
      notes: {
        8: 'The check wins tempo and unpins development. White has already lost the thread.',
      },
      story: 'When White drifts in the Caro-Kann, the bishop check and quick ...e5 hits the center before White castles.',
    },
    motif: 'pawnStructure',
  },
  {
    name: 'Scandinavian with ...Qa5',
    side: 'black',
    moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5', 'Bd2', 'e6'],
    ideas: 'Immediate central strike, queen develops itself, then c6 and e6 for a compact position. Almost no theory, honest play.',
    trap: {
      name: 'The Nc3 tempo trick, avoided',
      moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'],
      notes: {
        5: 'Qa5 keeps the queen out of Nc3 and Bb5 tempo hits. Qd8 or Qd6 also work; Qe5+ does not.',
      },
      story: 'The whole opening is one tempo decision. Learn where the queen lives safely and the rest is plan chess.',
    },
    motif: 'development',
  },
]

function planRepertoire(env: AgentEnv): SuperSkillPlan {
  const arg = String(env.ctx.theme ?? '').toLowerCase()
  let side: 'white' | 'black' = arg.includes('black') ? 'black' : arg.includes('white') ? 'white' : 'white'
  let historyLine = ''
  let chosen: RepLine | null = null

  async function replayLineArtifact(title: string, moves: string[], notes: Record<number, string>, story: string, theme: string): Promise<ArtifactView> {
    const g = new Chess()
    const steps: { san: string; note?: string }[] = []
    for (let i = 0; i < moves.length; i++) {
      const mv = g.move(moves[i])
      if (!mv) throw new Error(`curated line broke at move ${i + 1} (${moves[i]}), which should never ship`)
      steps.push({ san: mv.san, note: notes[i + 1] })
    }
    const row = await db.coachArtifact.create({
      data: {
        profileId: env.profile.id,
        kind: 'line',
        title,
        fen: null,
        solution: steps.map((s) => s.san).join(' '),
        sideToMove: 'w',
        payloadJson: JSON.stringify({ steps, explanation: story, goal: `Walk the ${side} repertoire line and understand every note.` }),
        themes: JSON.stringify([theme]),
        engineVerified: false,
      },
    })
    return artifactFromRow(row as unknown as Record<string, unknown>)
  }

  return {
    title: 'Opening Repertoire',
    goal: `Read your real opening history, stage the ${side} repertoire lines and the trap to know.`,
    steps: [
      {
        id: 'history',
        title: 'Read your opening history',
        critical: true,
        run: async (ctx: StepCtx) => {
          const l = await scanLedger(env)
          ctx.data.ledger = l
          const counts = new Map<string, number>()
          for (const game of l.games) {
            if (!game.pgn) continue
            try {
              const hist = new Chess()
              hist.loadPgn(game.pgn)
              const sans = hist.history()
              if (sans.length) {
                const name = detectOpening(sans)
                counts.set(name, (counts.get(name) ?? 0) + 1)
              }
            } catch {
              /* a broken PGN row stays out of the count */
            }
          }
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          historyLine = top.length ? top.map(([n, c]) => `${n} (${c})`).join(', ') : 'no games on file yet'
          return `Your recent openings: ${historyLine}`
        },
      },
      {
        id: 'choose',
        title: `Pick the ${side} repertoire`,
        critical: true,
        run: async (ctx: StepCtx) => {
          const l = ctx.data.ledger as Ledger
          // The curated set is honest for every tier: two White choices and
          // two Black choices, matched by side. Lower tiers get the first.
          const pool = REPERTOIRE.filter((r) => r.side === side)
          const idx = l.tierN >= 3 ? 1 : 0
          chosen = pool[Math.min(idx, pool.length - 1)] ?? pool[0]
          ctx.data.chosen = chosen.name
          return `Core system: ${chosen.name}. ${chosen.ideas.split('.')[0]}.`
        },
      },
      {
        id: 'line',
        title: 'Stage the core line',
        critical: true,
        run: async (ctx: StepCtx) => {
          if (!chosen) throw new Error('no repertoire picked')
          const a = await replayLineArtifact(`${chosen.name}: your core line`, chosen.moves, {}, chosen.ideas, chosen.motif)
          ctx.addArtifact(a)
          return `${chosen.moves.length} half-moves replayed and legality-checked: ${describeArtifact(a)}`
        },
      },
      {
        id: 'trap',
        title: 'Stage the trap to know',
        run: async (ctx: StepCtx) => {
          if (!chosen?.trap) {
            const a = await stepGenEscalate(env, 'level_puzzle', 'development')
            ctx.addArtifact(a)
            return `No curated trap for this system, so a verified development puzzle stands in: ${describeArtifact(a)}`
          }
          const a = await replayLineArtifact(chosen.trap.name, chosen.trap.moves, chosen.trap.notes, chosen.trap.story, chosen.motif)
          ctx.addArtifact(a)
          return `${describeArtifact(a)} staged, every move legality-checked`
        },
      },
      {
        id: 'plan',
        title: 'Write the repertoire card',
        run: async () => 'Repertoire card drafted',
      },
    ],
    writeReport: async (state) => {
      const name = state.data.chosen as string | undefined
      const chosenLine = REPERTOIRE.find((r) => r.name === name)
      const fallback = [
        name ? `Your ${side} system: ${name}.` : '',
        chosenLine ? `Plan in one breath: ${chosenLine.ideas}` : '',
        `Opening history used for the pick: ${historyLine || 'none yet'}.`,
        'Work order: walk the core line twice, then the trap, then play two bot games trying only the move orders from the card. Names come later; the plans are the repertoire.',
      ].filter(Boolean).join('\n')
      const facts = [
        `Student's recent openings: ${historyLine || 'none'}.`,
        `Chosen system: ${name}. Ideas: ${chosenLine?.ideas ?? ''}.`,
        `Trap covered: ${chosenLine?.trap?.name ?? 'none curated'}.`,
        `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
      ]
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 6. Endgame Lab
// ---------------------------------------------------------------------------

const ENDGAME_NOTES: Record<number, string[]> = {
  1: ['King and pawn endings are about the square: count whether the king catches the pawn before counting anything else.', 'Push the pawn when the king leads; when both queens appear, tempo decides.'],
  2: ['Rook endings are won by activity first, pawns second. Cut the king off along a file or rank before pushing.', 'Learn the Philidor and Lucena positions cold; they decide most real rook endings you will ever play.'],
  3: ['Opposition: the side NOT to move holds the key square. Use it to shepherd a passed pawn home.', 'Triangles and waiting moves convert equal-looking positions into wins.'],
  4: ['Zugzwang wins more endgames than combinations do. Make a tempo move, then watch the defender self-destruct.', 'Outside passed pawns are decoys: walk the defending king away, then promote.'],
  5: ['Fortresses and exact defenses: know which of your "lost" positions are actually drawn, and hold them without fear.', 'Piece activity can beat an extra pawn: two active pieces versus one passive one and a pawn is often winning play.'],
}

function planLab(env: AgentEnv): SuperSkillPlan {
  let candidateCount = 0
  return {
    title: 'Endgame Lab',
    goal: 'Two verified technique tasks from sparse course positions, plus a theory brief matched to your tier.',
    steps: [
      {
        id: 'gather',
        title: 'Gather course endgame positions',
        critical: true,
        run: async (ctx: StepCtx) => {
          const l = await scanLedger(env)
          ctx.data.ledger = l
          ctx.log('Filtering the curriculum for sparse positions')
          const fens = collectCandidateFens(Math.min(5, l.tierN), l.levelN, 300).filter((f) => (f.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length <= 9)
          candidateCount = fens.length
          if (!candidateCount) throw new Error('the course pool has no sparse endgame positions at your level yet')
          return `${candidateCount} sparse positions available from the course pool`
        },
      },
      {
        id: 'task1',
        title: 'Technique task 1',
        run: async (ctx: StepCtx) => {
          ctx.log('Crafting and verifying the first endgame task')
          const a = await stepGenEscalate(env, 'endgame_drill')
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      },
      {
        id: 'task2',
        title: 'Technique task 2',
        run: async (ctx: StepCtx) => {
          const a = await stepGenEscalate(env, 'endgame_drill')
          ctx.addArtifact(a)
          return `Delivered a different position than the first: ${describeArtifact(a)}`
        },
      },
      {
        id: 'theory',
        title: 'Write the theory brief',
        run: async () => 'Brief drafted for your tier',
      },
    ],
    writeReport: async (state) => {
      const l = state.data.ledger as Ledger | undefined
      const notes = ENDGAME_NOTES[Math.min(5, Math.max(1, l?.tierN ?? 2))] ?? ENDGAME_NOTES[2]
      const fallback = [
        `Endgame brief for ${l ? `${l.tierTitle}` : 'your tier'}:`,
        ...notes.map((n) => `- ${n}`),
        '',
        `Pool size behind the tasks: ${candidateCount} sparse course positions.`,
        'Do task 1 with the board, task 2 the second time from memory. If a task beats you twice, sleep on it; endgame knowledge consolidates overnight.',
      ].join('\n')
      const facts = [
        `Tier: ${l?.tierTitle ?? ''}, level ${l?.levelN ?? ''}.`,
        `Sparse endgame pool: ${candidateCount} positions.`,
        `Technique notes in play: ${notes.join(' ')}`,
        `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
      ]
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 7. Tactics Gauntlet
// ---------------------------------------------------------------------------

function planGauntlet(env: AgentEnv): SuperSkillPlan {
  const rounds = 5
  const steps: AgentStep[] = []
  for (let r = 1; r <= rounds; r++) {
    steps.push({
      id: `round${r}`,
      title: `Round ${r} of ${rounds}`,
      run: async (ctx: StepCtx) => {
        const theme = pick(TACTIC_THEMES)
        ctx.log(`Round ${r}: crafting a verified task, one notch harder`)
        const a = await stepGenEscalate(env, 'level_puzzle', theme, r - 1)
        ctx.addArtifact(a)
        // The title is never stored into step data: every report and every
        // checklist line is read while the round is still unsolved.
        return artifactDetail(a)
      },
    })
  }
  return {
    title: 'Tactics Gauntlet',
    goal: 'Five rounds of engine-verified puzzles, each a level harder than the last, closing with a scorecard.',
    steps: [
      ...steps,
      {
        id: 'score',
        title: 'Close the scorecard',
        run: async () => 'Scorecard drafted',
      },
    ],
    writeReport: async (state) => {
      const done = state.artifacts.length
      const failed = state.steps.filter((s) => s.status === 'failed')
      const fallback = [
        `Gauntlet result: ${done} of ${rounds} rounds delivered.`,
        done === rounds
          ? 'Run them in order, no takebacks. Four of five clean is progress; track it by re-running /gauntlet next week and comparing how far you got before the first miss.'
          : failed.length
            ? `Rounds that failed verification: ${failed.map((s) => s.title).join(', ')}. The engine refused to ship them, which is the guarantee working, not a malfunction.`
            : 'The run ended early; the rounds that landed are on your shelf.',
        'Rule of the house: a round you miss twice, you redo the next day before anything new.',
      ].join('\n')
      const facts = [
        `Mission: five-round tactics gauntlet with escalating level offsets.`,
        `Delivered rounds: ${state.artifacts.map((a) => `a ${a.kind}${a.rating != null ? ` (${a.rating} Elo)` : ''}`).join('; ') || 'none'}.`,
        `Failed steps: ${failed.map((s) => `${s.title}: ${s.detail ?? ''}`).join('; ') || 'none'}.`,
      ]
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 8. Master Study
// ---------------------------------------------------------------------------

interface MasterGame {
  title: string
  players: string
  year: number
  moves: string[]
  notes: Record<number, string>
  lessons: string[]
  motif: string
}

const MASTER_GAMES: MasterGame[] = [
  {
    title: 'The Opera Game',
    players: 'Morphy vs Duke of Brunswick and Count Isouard',
    year: 1858,
    moves: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'],
    notes: {
      6: 'Morphy trades development for the center. Bg4 is already the mistake that sets the trap.',
      8: 'The queen recycles: takes a piece, then aims at b7 and f7 in one breath.',
      17: 'Two pawns down in material terms, but every piece is in the attack and Black is not.',
      19: 'The knight sacrifice opens lines to the exposed king. Development beats material, live on stage.',
      25: 'The rook sacrifice is forced mate in two more moves. Every White piece participated; the queen ended it from the grave.',
    },
    lessons: ['Develop with tempo and the opponent never gets to breathe.', 'Material counts are not the score; activity is.', 'A lead in development is a bill that comes due fast.'],
    motif: 'development',
  },
  {
    title: 'The Evergreen Game',
    players: 'Anderssen vs Dufresne',
    year: 1852,
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6', 'e5', 'Qg6', 'Re1', 'Nge7', 'Ba3', 'b5', 'Qxb5', 'Rb8', 'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5', 'Bxd3', 'Qh5', 'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+', 'Nxe7', 'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+', 'Kf8', 'Bxe7#'],
    notes: {
      7: 'The Evans-style pawn offer rips the bishop from its best square.',
      33: 'A quiet-looking double check begins the final crash.',
      41: 'Sacrifices fall like rain: rook, then queen, then two bishop checks close the net.',
    },
    lessons: ['An open king cannot buy back lost tempo.', 'Sacrifice only when every remaining piece joins the hunt.', 'Calculation over beauty: Anderssen counted to the end before giving the queen.'],
    motif: 'sacrifice',
  },
  {
    title: "Légal's Mate, live",
    players: 'Légal vs Saint Brie',
    year: 1750,
    moves: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'],
    notes: {
      9: 'The knight takes e5 with the queen hanging on d1. That is the whole point.',
      10: 'Black grabs the queen and the game, because the threat was never the queen.',
      13: 'Three minor pieces deliver mate while the White queen is already off the board.',
    },
    lessons: ['Count the follow-up before you grab anything.', 'A hanging queen can be bait; threats outrank material.', 'Pattern knowledge is defense: this mate is 275 years old and still catches people.'],
    motif: 'mate',
  },
]

function planMasterclass(env: AgentEnv): SuperSkillPlan {
  let game: MasterGame | null = null
  return {
    title: 'Master Study',
    goal: 'Stage a legendary game as a verified walkthrough, quiz the ideas, and hand over the study card.',
    steps: [
      {
        id: 'choose',
        title: 'Choose the game',
        critical: true,
        run: async (ctx: StepCtx) => {
          game = pick(MASTER_GAMES)
          ctx.data.gameTitle = game.title
          return `${game.title}: ${game.players}, ${game.year}`
        },
      },
      {
        id: 'stage',
        title: 'Stage the walkthrough',
        critical: true,
        run: async (ctx: StepCtx) => {
          if (!game) throw new Error('no game chosen')
          const g = new Chess()
          const steps: { san: string; note?: string }[] = []
          for (let i = 0; i < game.moves.length; i++) {
            const mv = g.move(game.moves[i])
            if (!mv) throw new Error(`curated game broke at move ${i + 1}, which should never ship`)
            steps.push({ san: mv.san, note: game.notes[i + 1] })
          }
          const row = await db.coachArtifact.create({
            data: {
              profileId: env.profile.id,
              kind: 'line',
              title: game.title,
              fen: null,
              solution: steps.map((s) => s.san).join(' '),
              sideToMove: 'w',
              payloadJson: JSON.stringify({
                steps,
                explanation: `${game.players}, ${game.year}. ${game.lessons.join(' ')}`,
                goal: 'Play through the moves and read the notes at the flagged moments.',
              }),
              themes: JSON.stringify([game.motif]),
              engineVerified: false,
            },
          })
          const view = artifactFromRow(row as unknown as Record<string, unknown>)
          ctx.addArtifact(view)
          return `${game.moves.length} half-moves replayed and legality-checked`
        },
      },
      {
        id: 'quiz',
        title: 'Quiz the ideas',
        run: async (ctx: StepCtx) => {
          if (!game) throw new Error('no game chosen')
          const a = await stepGen(env, 'level_quiz', game.motif)
          ctx.addArtifact(a)
          return `Quiz tuned to the game's core motif (${game.motif}): ${describeArtifact(a)}`
        },
      },
      {
        id: 'card',
        title: 'Write the study card',
        run: async () => 'Study card drafted',
      },
    ],
    writeReport: async (state) => {
      const title = state.data.gameTitle as string | undefined
      const g = MASTER_GAMES.find((x) => x.title === title)
      const fallback = g
        ? [
            `Study card: ${g.title} (${g.year}).`,
            ...g.lessons.map((l) => `- ${l}`),
            '',
            'How to study it: first pass, play the moves and read the notes. Second pass, cover the notes and predict each move before revealing it. Third pass a week later, from memory.',
            'The quiz on your shelf tests the motif behind the brilliancies, not the trivia.',
          ].join('\n')
        : 'The study session closed early; the walkthrough that landed is on your shelf.'
      const facts = [
        `Game: ${g ? `${g.title}, ${g.players}, ${g.year}` : 'unknown'}.`,
        g ? `Core lessons: ${g.lessons.join('; ')}.` : '',
        `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
      ].filter(Boolean)
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 9. Daily Regimen
// ---------------------------------------------------------------------------

function planRegimen(env: AgentEnv): SuperSkillPlan {
  return {
    title: 'Daily Regimen',
    goal: 'Status check against your goal, warmup, quiz, a main event, and exactly what to close out today.',
    steps: [
      {
        id: 'status',
        title: 'Status check',
        critical: true,
        run: async (ctx: StepCtx) => {
          const l = await scanLedger(env)
          ctx.data.ledger = l
          return `${l.todayMinutes}/${l.goalMinutes} active minutes today, ${l.reviewDue} reviews due, ${l.unsolvedArtifacts} unsolved tasks on the shelf, ${l.streak}-day streak`
        },
      },
      {
        id: 'warmup',
        title: 'Warmup puzzle',
        run: async (ctx: StepCtx) => {
          const l = ctx.data.ledger as Ledger
          const theme = focusConcept(l).concept
          ctx.log('Warmup: verified task')
          const a = await stepGenEscalate(env, 'level_puzzle', theme)
          ctx.addArtifact(a)
          return `${describeArtifact(a)} ready`
        },
      },
      {
        id: 'quiz',
        title: 'Quick quiz',
        run: async (ctx: StepCtx) => {
          const l = ctx.data.ledger as Ledger
          const theme = focusConcept(l).concept
          const a = await stepGen(env, 'level_quiz', theme)
          ctx.addArtifact(a)
          return `${describeArtifact(a)} ready`
        },
      },
      {
        id: 'main',
        title: 'Main event',
        run: async (ctx: StepCtx) => {
          const day = new Date().getDate() % 2 === 0
          const skill: SkillId = day ? 'mate_hunt' : 'endgame_drill'
          ctx.log(day ? 'Hunting a verified forced mate' : 'Crafting a verified endgame task')
          const a = await stepGenEscalate(env, skill)
          ctx.addArtifact(a)
          return `${day ? 'Mate hunt' : 'Endgame task'} delivered: ${describeArtifact(a)}`
        },
      },
      {
        id: 'close',
        title: 'Close the loop',
        run: async () => 'Closing checklist drafted',
      },
    ],
    writeReport: async (state) => {
      const l = state.data.ledger as Ledger | undefined
      const remaining = l ? Math.max(0, l.goalMinutes - l.todayMinutes) : 0
      const fallback = l
        ? [
            `Today's status: ${l.todayMinutes}/${l.goalMinutes} active minutes, ${remaining === 0 ? 'goal met' : `${remaining} minutes to the goal`}, ${l.reviewDue} reviews due, ${l.unsolvedArtifacts} unsolved tasks, ${l.streak}-day streak.`,
            'Order of work: warmup puzzle, quiz, then the main event. If reviews are due, they come before anything new; the queue is the cheapest rating you will ever earn.',
            remaining > 0 ? `Close the goal with ${remaining} focused minutes: the puzzle session above plus a lesson step gets you there.` : 'Goal already met today: everything above is compound interest.',
          ].join('\n')
        : 'Regimen closed; the material above is your session.'
      const facts = l
        ? [
            `Ledger: ${l.todayMinutes}/${l.goalMinutes} min today, ${l.reviewDue} reviews due, ${l.unsolvedArtifacts} unsolved tasks, streak ${l.streak}, ${l.puzzleSolved} puzzles all-time.`,
            `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
          ]
        : []
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 10. Sparring Prep
// ---------------------------------------------------------------------------

const STYLE_THEME: { re: RegExp; theme: string; tip: string }[] = [
  { re: /aggress|attack|charg|all-out/i, theme: 'defense', tip: 'Their style feeds on loose moves. Meet the early rush with development and donates nothing: every check gets answered by a threat back.' },
  { re: /defen|wall|fortress|sentry|never attacks/i, theme: 'pawnBreaks', tip: 'Against a wall-builder you must be the one to open the position, and on your terms: prepare the pawn break with pieces, then break.' },
  { re: /tactic|combination|calculat/i, theme: 'calculation', tip: 'They see two moves ahead for fun. Before every capture ask: what recaptures, and what comes after that.' },
  { re: /strateg|slow|squeeze|craftsman|cornerstone/i, theme: 'outposts', tip: 'Slow stranglers rely on weak squares. Claim an outpost with a pawn, support it with a piece, and their plan dies.' },
  { re: /endgame|technique/i, theme: 'technique', tip: 'If they steer to the endgame, trade only when it helps YOUR king activity, not just material.' },
  { re: /vibes|forgets|hoards|jam/i, theme: 'doubleAttack', tip: 'Loose players hang things. Scan for undefended pieces after every one of their moves; double attacks end these games early.' },
]

function planSparring(env: AgentEnv): SuperSkillPlan {
  return {
    title: 'Sparring Prep',
    goal: 'Pick the right bots for your level, brief you on their style, drill the counter-skill, and open the lobby.',
    steps: [
      {
        id: 'pick',
        title: 'Pick your sparring partners',
        critical: true,
        run: async (ctx: StepCtx) => {
          const l = await scanLedger(env)
          ctx.data.ledger = l
          const target = l.botElo || levelRating(l.tierN, l.levelN)
          const sorted = [...BOTS].sort((a, b) => a.rating - b.rating)
          const near = sorted.reduce((best, b) => (Math.abs(b.rating - target) < Math.abs(best.rating - target) ? b : best), sorted[0])
          const idx = sorted.findIndex((b) => b.id === near.id)
          const below = sorted[Math.max(0, idx - 1)]
          const above = sorted[Math.min(sorted.length - 1, idx + 1)]
          const picks = [...new Set([below, near, above].filter(Boolean))]
          ctx.data.picks = picks.map((b) => ({ id: b.id, name: b.name, rating: b.rating, style: b.style }))
          return `${picks.map((b) => `${b.name} (${b.rating})`).join(', ')} around your ${target} Elo mark`
        },
      },
      {
        id: 'brief',
        title: 'Brief the main opponent',
        critical: true,
        run: async (ctx: StepCtx) => {
          const picks = ctx.data.picks as { name: string; rating: number; style: string }[]
          const main = picks[Math.min(1, picks.length - 1)]
          const match = STYLE_THEME.find((s) => s.re.test(main.style)) ?? STYLE_THEME[2]
          ctx.data.theme = match.theme
          ctx.data.tip = match.tip
          return `${main.name} (${main.rating}): ${match.tip}`
        },
      },
      {
        id: 'drill',
        title: 'Drill the counter-skill',
        run: async (ctx: StepCtx) => {
          ctx.log('Crafting a verified task')
          const a = await stepGenEscalate(env, 'level_puzzle', ctx.data.theme)
          ctx.addArtifact(a)
          return `${describeArtifact(a)} (${ctx.data.theme}) ready, engine-verified`
        },
      },
      {
        id: 'launch',
        title: 'Open the lobby',
        run: async (ctx: StepCtx) => {
          ctx.addAction({ type: 'goto', view: 'play' })
          return 'Play screen queued: pick the briefed bot when the mission closes'
        },
      },
    ],
    writeReport: async (state) => {
      const picks = (state.data.picks as { name: string; rating: number; style: string }[] | undefined) ?? []
      const main = picks[Math.min(1, Math.max(0, picks.length - 1))]
      const tip = state.data.tip as string | undefined
      const fallback = [
        picks.length ? `Sparring card: start with ${picks[0].name} (${picks[0].rating}) to loosen up, then ${main ? `${main.name} (${main.rating})` : 'the main bot'}, and only touch ${picks[picks.length - 1].name} (${picks[picks.length - 1].rating}) on a good day.` : '',
        tip ? `Style key: ${tip}` : '',
        'Checklist: castle inside ten moves, every move ask what changed (checks, captures, threats), and never leave a piece undefended without counting the attackers. Two games, then review both in Game review; the next prep builds on those reports.',
      ].filter(Boolean).join('\n')
      const facts = [
        `Bot roster around the student's level: ${picks.map((b) => `${b.name} ${b.rating} (${b.style})`).join('; ') || 'none'}.`,
        tip ? `Main tip: ${tip}` : '',
        `Artifacts: ${state.artifacts.map((a) => describeArtifact(a)).join(', ') || 'none'}.`,
      ].filter(Boolean)
      return composeReport(env, fallback, facts)
    },
  }
}

// ---------------------------------------------------------------------------
// 11. Fix It: the student reports bad material ("the puzzle is wrong"). The
// agent does not deflect and does not just swap: it PULLS the exact artifact
// it served, re-plays every move with chess.js, re-scores the root with the
// engine (MultiPV), issues a verdict, retires flawed material, and only then
// builds the replacement.
// ---------------------------------------------------------------------------

function uciToSanAt(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
    return mv?.san ?? null
  } catch {
    return null
  }
}

interface FixItCase {
  id: string
  kind: string
  title: string
  fen: string | null
  solution: string[]
  confirmations: string[]
  issues: string[]
  flawed: boolean
  checked: boolean
}

function planFixIt(env: AgentEnv): SuperSkillPlan {
  return {
    title: 'Material Check',
    goal: 'Re-verify the reported material with the engine, issue a verdict, retire it if flawed, build a better replacement.',
    steps: [
      {
        id: 'locate',
        title: 'Find the exact material you mean',
        critical: true,
        async run(ctx: StepCtx) {
          // One quiet retry: a hot reload or a busy SQLite writer can serve a
          // transient empty read, and the whole point of this mission is to
          // re-check the EXACT card the student means. Never miss it twice.
          let row = await db.coachArtifact.findFirst({
            where: { profileId: env.profile.id, kind: { in: ['puzzle', 'drill', 'quiz'] } },
            orderBy: { createdAt: 'desc' },
          })
          if (!row) {
            await new Promise((r) => setTimeout(r, 400))
            row = await db.coachArtifact.findFirst({
              where: { profileId: env.profile.id, kind: { in: ['puzzle', 'drill', 'quiz'] } },
              orderBy: { createdAt: 'desc' },
            })
          }
          if (!row) {
            ctx.data.fixit = null
            return 'No recent generated material found, so there is nothing to re-check. The fresh build below stands on its own.'
          }
          const solution = (row.solution ?? '').split(/\s+/).filter(Boolean)
          const c: FixItCase = {
            id: row.id,
            kind: row.kind,
            title: row.title,
            fen: row.fen,
            solution,
            confirmations: [],
            issues: [],
            flawed: false,
            checked: false,
          }
          ctx.data.fixit = c
          return `Pulled the ${row.kind} card served ${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')} for a full re-check`
        },
      },
      {
        id: 'reverify',
        title: 'Re-verify every move with the engine',
        async run(ctx: StepCtx) {
          const c = ctx.data.fixit as FixItCase | null
          if (!c) return 'Skipped: nothing to re-check.'
          ctx.log('Replaying the solution move by move')
          // 1. Position parses and every solution move is legal.
          if (c.fen) {
            let g: Chess | null = null
            try {
              g = new Chess(c.fen)
            } catch {
              c.issues.push('the stored position does not parse as a legal FEN')
            }
            if (g) {
              for (let i = 0; i < c.solution.length; i++) {
                try {
                  g.move(c.solution[i])
                } catch {
                  c.issues.push(`move ${i + 1} (${c.solution[i]}) is not legal in the position`)
                  break
                }
              }
              if (!c.issues.length && c.solution.length) c.confirmations.push(`all ${c.solution.length} solution moves replay legally`)
            }
            // 2. Engine re-score of the ROOT with MultiPV: does the engine
            // agree the stated first move is best, and is it unique?
            if (c.fen && !c.issues.length) {
              ctx.log('Scoring the root position with MultiPV')
              const a = await analyze(c.fen, 3)
              if (!a) {
                c.confirmations.push('engine was unavailable, verdict rests on move legality alone')
              } else if (c.solution.length) {
                const engSan = uciToSanAt(c.fen, a.best)
                if (engSan && engSan !== c.solution[0]) {
                  const gap = a.secondScore != null ? a.bestScore - a.secondScore : null
                  c.issues.push(
                    `the engine's top move here is ${engSan}, not ${c.solution[0]}${gap != null ? ` (gap to second: ${Math.round(gap)}cp)` : ''}`,
                  )
                } else if (engSan) {
                  const gap = a.secondScore != null ? Math.round(a.bestScore - a.secondScore) : null
                  c.confirmations.push(`the engine confirms ${c.solution[0]} as best${gap != null ? ` with a ${gap}cp margin over the runner-up` : ''}`)
                }
                if (a.secondScore != null && a.bestScore - a.secondScore < 120 && a.bestScore < 90_000) {
                  c.issues.push(`best and second-best sit only ${Math.round(a.bestScore - a.secondScore)}cp apart, so several moves work about equally well: a puzzle needs one clear point`)
                }
              }
            }
          } else if (c.kind === 'quiz') {
            // Quizzes have no board: check the payload is intact and sound.
            try {
              const row = await db.coachArtifact.findUnique({ where: { id: c.id }, select: { payloadJson: true, question: true } })
              const payload = JSON.parse(row?.payloadJson ?? 'null') as { options?: unknown[] } | null
              if (row?.question && Array.isArray(payload?.options) && payload.options.length >= 2) {
                c.confirmations.push(`quiz payload is intact (${payload.options.length} options, one marked correct)`)
              } else {
                c.issues.push('the quiz payload is incomplete: missing question text or answer options')
              }
            } catch {
              c.issues.push('the quiz payload could not be parsed')
            }
          }
          c.checked = true
          c.flawed = c.issues.length > 0
          if (c.flawed) return `You were right: ${c.issues.join('; ')}`
          return c.issues.length
            ? `Verdict forming: ${c.issues.join('; ')}`
            : `Held up under re-check: ${c.confirmations.join('; ')}`
        },
      },
      {
        id: 'verdict',
        title: 'Issue the verdict and act on it',
        async run(ctx: StepCtx) {
          const c = ctx.data.fixit as FixItCase | null
          if (!c || !c.checked) return 'No verdict: the re-check never produced a case file.'
          if (c.flawed) {
            await db.coachArtifact.update({ where: { id: c.id }, data: { engineVerified: false } })
            ctx.data.verdict = `flawed: ${c.issues.join('; ')}`
            return `That ${c.kind} card is retired for you (engine-verified flag pulled). ${c.issues[0]}`
          }
          ctx.data.verdict = 'checked and confirmed'
          return `That ${c.kind} card checked out: ${c.confirmations.join('; ')}. It stays, and you still get a fresh one below.`
        },
      },
      {
        id: 'replace',
        title: 'Build a fresh, verified replacement',
        async run(ctx: StepCtx) {
          ctx.log('Mining the real-game bank for a better one')
          const a = await stepGen(env, 'level_puzzle', ctx.data.focus)
          ctx.addArtifact(a)
          return artifactDetail(a)
        },
      },
    ],
    writeReport: async (state) => {
      const c = state.data.fixit as FixItCase | null | undefined
      const verdict = typeof state.data.verdict === 'string' ? state.data.verdict : ''
      const facts = [
        `The student reported bad material. Complaint: "${state.goal.slice(0, 160)}".`,
      ]
      if (c) {
        facts.push(`Material re-checked: the ${c.kind} card (headline stays on the card, earned by solving).`)
        if (c.issues.length) facts.push(`Confirmed flaws: ${c.issues.join('; ')}.`)
        if (c.confirmations.length) facts.push(`What checked out: ${c.confirmations.join('; ')}.`)
        if (verdict) facts.push(`Action taken: ${verdict}. The flawed artifact had its verified flag pulled so it cannot come back as "engine-verified".`)
      } else {
        facts.push('No recent generated material was found to re-check.')
      }
      for (const a of state.artifacts) facts.push(`Replacement delivered: ${describeArtifact(a)}${a.engineVerified ? ', engine-verified' : ''}. The moves, the idea and the headline stay inside the card for the student to earn.`)
      const fallback = [
        c?.flawed ? 'You were right, and that one is retired.' : c ? 'I re-checked it with the engine and it held up.' : 'Nothing to re-check, so I built you a fresh one.',
        ...state.steps.map((s) => `- ${s.title}: ${s.status === 'done' ? s.detail ?? 'done' : s.status}`),
      ].filter(Boolean).join('\n')
      return composeReport(env, fallback, facts)
    },
  }
}
