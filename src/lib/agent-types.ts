// Shared agent types and the superskill (plugin) catalog. Client-safe by
// design: pure metadata and shapes, no server imports. The server runtime
// (src/lib/server/agent/*), the chat router and the mission card UI all
// import from here, so the catalog can never drift between them.

import type { ArtifactView } from '@/lib/coach-artifacts'
import type { CoachAction } from '@/lib/coach-commands-catalog'

export type AgentStepStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export interface AgentStepView {
  id: string
  title: string
  status: AgentStepStatus
  /** One-line result when the step finished (or the honest failure reason). */
  detail: string | null
  /** Latest progress line while the step runs. */
  log: string | null
}

export type AgentTaskStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface AgentTaskView {
  id: string
  /** Superskill id, or 'agent' for a free-form planned mission. */
  skill: string
  title: string
  goal: string
  status: AgentTaskStatus
  steps: AgentStepView[]
  /** Final markdown-ish plain text report, written when the mission ends. */
  report: string | null
  artifacts: ArtifactView[]
  /** App actions to run when the mission finishes (open a section, etc). */
  actions: CoachAction[]
  startedAt: string
  finishedAt: string | null
}

export type AgentEvent =
  | { type: 'snapshot'; task: AgentTaskView }
  | { type: 'step'; index: number; step: AgentStepView }
  | { type: 'steps'; steps: AgentStepView[] }
  | { type: 'log'; index: number; text: string }
  | { type: 'artifact'; artifact: ArtifactView }
  | { type: 'status'; status: AgentTaskStatus }
  | { type: 'done'; task: AgentTaskView }
  | { type: 'error'; message: string }

export interface SuperSkillMeta {
  id: string
  cmd: string
  name: string
  desc: string
  /** Optional free-text argument, like an opponent color for /repertoire. */
  args?: string
  example?: string
}

/** The 10 superskill plugins. Each one is a multi-step mission the agent
 * runs end to end: scans real app data, generates engine-verified material,
 * and writes a report. */
export const SUPER_SKILLS: SuperSkillMeta[] = [
  {
    id: 'plan',
    cmd: '/plan',
    name: 'Training Plan',
    desc: 'Scans your whole ledger, finds the weakest motif, builds verified drills around it and hands you a 7-day schedule',
    example: '/plan',
  },
  {
    id: 'autopsy',
    cmd: '/autopsy',
    name: 'Game Autopsy',
    desc: 'Pulls your last game apart: accuracy, the move that lost it, a drill from the exact position, and a quiz on the leak',
    example: '/autopsy',
  },
  {
    id: 'bootcamp',
    cmd: '/bootcamp',
    name: 'Bootcamp',
    desc: 'Six-station full session: quiz, two tactics puzzles, a mate hunt, endgame technique, final exam, then a scorecard',
    example: '/bootcamp',
  },
  {
    id: 'radar',
    cmd: '/radar',
    name: 'Weakness Radar',
    desc: 'Sweeps mastery, puzzle history and every game report, then builds targeted drills for your two worst areas',
    example: '/radar',
  },
  {
    id: 'repertoire',
    cmd: '/repertoire',
    args: '[white|black]',
    name: 'Opening Repertoire',
    desc: 'Reads your real opening history, picks a repertoire that fits your tier, replays the core line and the trap to know',
    example: '/repertoire black',
  },
  {
    id: 'lab',
    cmd: '/lab',
    name: 'Endgame Lab',
    desc: 'Two verified endgame technique tasks from course positions plus a theory brief for your level',
    example: '/lab',
  },
  {
    id: 'gauntlet',
    cmd: '/gauntlet',
    name: 'Tactics Gauntlet',
    desc: 'Five rounds of engine-verified puzzles, each harder than the last, with a closing scorecard',
    example: '/gauntlet',
  },
  {
    id: 'masterclass',
    cmd: '/masterclass',
    name: 'Master Study',
    desc: 'Stages a legendary game as a verified walkthrough, quizzes you on the critical moment, writes the study card',
    example: '/masterclass',
  },
  {
    id: 'regimen',
    cmd: '/regimen',
    name: 'Daily Regimen',
    desc: 'Status check against your goal, warmup puzzle, quiz, a main event, and what to close out today',
    example: '/regimen',
  },
  {
    id: 'sparring',
    cmd: '/sparring',
    name: 'Sparring Prep',
    desc: 'Picks bots that match your level, briefs you on their style, drills the counter-skills, opens the lobby',
    example: '/sparring',
  },
]

export const AGENT_CMD = '/agent'

export function superSkillById(id: string): SuperSkillMeta | null {
  return SUPER_SKILLS.find((s) => s.id === id) ?? null
}

export function superSkillByCmd(cmd: string): SuperSkillMeta | null {
  const c = cmd.toLowerCase()
  return SUPER_SKILLS.find((s) => s.cmd === c) ?? null
}

/** Free-form agent command: `/agent build me a complete training evening`. */
export function parseAgentGoalCommand(text: string): string | null {
  const t = text.trim()
  const m = t.match(/^\/agent\s+(.{3,300})$/i)
  return m ? m[1].trim() : null
}
