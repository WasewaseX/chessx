// Mission launcher: the one entry point the chat router uses to start agent
// work. Every mission now runs the same agentic loop: assess real data ->
// the model plans the steps -> validated steps execute -> LLM-written report.
// The old superskill templates serve as the recipe (intent) and the fallback
// (when the model plan will not validate), never as a rigid script.
import 'server-only'
import type { AiConfig } from '@/lib/ai'
import { runSkill, checkRateLimit, resolveLevelContext, SkillError, type SkillId } from '@/lib/server/coach-skills'
import { startAgentTask } from '@/lib/server/agent/runtime'
import type { AgentTaskView } from '@/lib/agent-types'
import { buildSuperskill, type AgentEnv } from '@/lib/server/agent/superskills'
import { planDynamicMission, recipeFrom } from '@/lib/server/agent/planner'
import { dayKeyLocal } from '@/lib/day'

export interface LaunchInput {
  profileId: string
  name: string
  skillLevel: string
  cfg: AiConfig
  ctx: { fen?: unknown; tier?: unknown; level?: unknown; theme?: unknown }
  /** Superskill id, 'agent' for a free-form goal, or 'fixit'. */
  skill: string
  /** Free-form goal for the 'agent' skill. */
  goal?: string
  /** True for admin accounts: skips the generation budget entirely. */
  unlocked?: boolean
}

export type LaunchResult = { ok: true; task: AgentTaskView } | { ok: false; error: string }

function makeEnv(input: LaunchInput, baseLevel: { tierId: string; levelN: number }): AgentEnv {
  return {
    cfg: input.cfg,
    profile: { id: input.profileId, name: input.name, skillLevel: input.skillLevel },
    ctx: input.ctx,
    gen: async (skill: SkillId, theme?: unknown, offset = 0) => {
      const limited = checkRateLimit(input.profileId, dayKeyLocal(), { admin: input.unlocked === true })
      if (limited) throw new SkillError(limited)
      return runSkill({
        skill,
        cfg: input.cfg,
        profileId: input.profileId,
        skillLevel: input.skillLevel,
        tier: baseLevel.tierId,
        level: Math.min(20, baseLevel.levelN + offset),
        theme,
        fen: input.ctx.fen,
      })
    },
  }
}

export async function launchMission(input: LaunchInput): Promise<LaunchResult> {
  const base = resolveLevelContext(input.ctx.tier, input.ctx.level, input.skillLevel)
  const env = makeEnv(input, base)

  // Fix It is an investigation, not an open-ended plan: the re-verification
  // must be real, deterministic engine work, so it keeps its fixed shape.
  if (input.skill === 'fixit') {
    const plan = buildSuperskill('fixit', env)
    if (!plan) return { ok: false, error: 'Fix It is unavailable.' }
    return startAgentTask({
      profileId: input.profileId,
      skill: 'fixit',
      title: plan.title,
      goal: plan.goal,
      steps: plan.steps,
      writeReport: plan.writeReport,
    })
  }

  if (input.skill === 'agent') {
    const goal = (input.goal ?? '').trim()
    if (goal.length < 4) {
      return { ok: false, error: 'Give the mission a goal: "/agent build me a complete training evening", for example.' }
    }
  }

  // The recipe (mission intent) comes from the named template when there is
  // one; free-form goals plan without a recipe. Either way the model sees
  // the real assessment data before it commits to steps.
  const template = input.skill === 'agent' ? null : buildSuperskill(input.skill, env)
  if (input.skill !== 'agent' && !template) {
    return { ok: false, error: 'Unknown mission type.' }
  }
  const recipe = template ? recipeFrom(template, input.skill) : null
  const plan = planDynamicMission(env, input.goal?.trim() || recipe?.goal || 'Training mission', recipe)

  return startAgentTask({
    profileId: input.profileId,
    skill: input.skill,
    title: plan.title,
    goal: plan.goal,
    steps: plan.steps,
    writeReport: plan.writeReport,
  })
}
