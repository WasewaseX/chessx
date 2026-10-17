// The agent runtime: an in-memory mission registry and executor. A mission is
// a sequence of steps the agent runs one by one, streaming progress events to
// any subscribed client (SSE). Steps do real work: they scan the app's ledger,
// generate engine-verified training material, drive the engine, and write the
// final report. Nothing here trusts the model with moves: generation goes
// through the same verified skill battery as single-shot commands.
import 'server-only'
import type { AgentEvent, AgentStepStatus, AgentStepView, AgentTaskStatus, AgentTaskView } from '@/lib/agent-types'
import { stripUnsolved, type ArtifactView } from '@/lib/coach-artifacts'
import type { CoachAction } from '@/lib/coach-commands-catalog'

export class AgentError extends Error {}

/** Thrown by a step that has nothing honest to do: the step is marked
 * skipped with the reason, not failed. Used when a mission planned a read
 * that would only repeat what an earlier step already reported. */
export class StepSkip extends Error {}

// ---------------------------------------------------------------------------
// Step and task shapes
// ---------------------------------------------------------------------------

export interface StepCtx {
  /** Emit a progress line under the running step. */
  log(text: string): void
  /** Attach a generated, verified artifact to the mission. */
  addArtifact(a: ArtifactView): void
  /** Queue an app action to run when the mission completes. */
  addAction(a: CoachAction): void
  /** Shared scratchpad across the mission's steps. */
  data: Record<string, unknown>
  /** Artifacts delivered so far in this mission (read-only view; use
   * addArtifact to ship one). Lets closing steps, like a scorecard, report
   * what actually shipped without each step stashing its own copy. */
  artifacts(): ArtifactView[]
  /** True when the student asked to cancel. */
  cancelled(): boolean
  /** Insert steps right after the one currently running. This is how a
   * planning step writes the rest of the mission once it has seen real
   * data: the checklist grows live in the UI. */
  addSteps(steps: AgentStep[]): void
}

export interface AgentStep {
  id: string
  title: string
  /** When a critical step fails the whole mission fails immediately. */
  critical?: boolean
  run(ctx: StepCtx): Promise<string>
}

export interface AgentTaskInput {
  profileId: string
  skill: string
  title: string
  goal: string
  steps: AgentStep[]
  /** Final report writer. Gets every step's outcome; returns the text the
   * student reads at the end. Falls back to an honest step-by-step summary. */
  writeReport?(state: ReportState): Promise<string>
}

export interface ReportState {
  goal: string
  steps: { id: string; title: string; status: AgentStepStatus; detail: string | null }[]
  artifacts: ArtifactView[]
  data: Record<string, unknown>
  cancelled: boolean
}

interface StepSlot extends AgentStep {
  status: AgentStepStatus
  detail: string | null
  log: string | null
}

interface Task {
  id: string
  profileId: string
  skill: string
  title: string
  goal: string
  status: AgentTaskStatus
  steps: StepSlot[]
  report: string | null
  artifacts: ArtifactView[]
  actions: CoachAction[]
  data: Record<string, unknown>
  writeReport?: (state: ReportState) => Promise<string>
  startedAt: Date
  finishedAt: Date | null
  cancelRequested: boolean
  subscribers: Set<(e: AgentEvent) => void>
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// Backed by globalThis on purpose: Next.js dev mode can give each route its
// own module instance, and a mission created inside /api/ai/chat must be
// visible to /api/agent/task and /api/agent/stream. A global registry keeps
// one source of truth across routes and across hot reloads.
const globalStore = globalThis as unknown as { __chessxAgentTasks?: Map<string, Task> }
const tasks: Map<string, Task> = (globalStore.__chessxAgentTasks ??= new Map())
const TASK_TTL_MS = 60 * 60_000 // an hour of after-life for the card
const MAX_TASKS_PER_PROFILE = 6
let seq = 0

function newId(): string {
  seq += 1
  return `m${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

function prune() {
  const now = Date.now()
  for (const [id, t] of tasks) {
    const done = t.finishedAt != null
    if (done && now - t.finishedAt!.getTime() > TASK_TTL_MS) tasks.delete(id)
  }
}

export function runningTaskFor(profileId: string): Task | null {
  for (const t of tasks.values()) {
    if (t.profileId === profileId && t.status === 'running') return t
  }
  return null
}

// ---------------------------------------------------------------------------
// Views and events
// ---------------------------------------------------------------------------

function stepView(s: StepSlot): AgentStepView {
  return { id: s.id, title: s.title, status: s.status, detail: s.detail, log: s.log }
}

function taskView(t: Task): AgentTaskView {
  return {
    id: t.id,
    skill: t.skill,
    title: t.title,
    goal: t.goal,
    status: t.status,
    steps: t.steps.map(stepView),
    report: t.report,
    // Spoiler guard: mission chips and the report reader must never receive
    // the headline of material the student has not solved yet.
    artifacts: t.artifacts.map(stripUnsolved),
    actions: [...t.actions],
    startedAt: t.startedAt.toISOString(),
    finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  }
}

function emit(t: Task, e: AgentEvent) {
  for (const fn of t.subscribers) {
    try {
      fn(e)
    } catch {
      /* a dead subscriber must never break the mission */
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runTask(t: Task) {
  const ctx: StepCtx = {
    log: (text: string) => {
      const idx = t.steps.findIndex((s) => s.status === 'running')
      if (idx === -1) return
      t.steps[idx].log = String(text).slice(0, 300)
      emit(t, { type: 'log', index: idx, text: t.steps[idx].log! })
    },
    addArtifact: (a: ArtifactView) => {
      if (t.artifacts.some((x) => x.id === a.id)) return
      t.artifacts.push(a)
      emit(t, { type: 'artifact', artifact: a })
    },
    addAction: (a: CoachAction) => {
      if (!t.actions.some((x) => JSON.stringify(x) === JSON.stringify(a))) t.actions.push(a)
    },
    data: t.data,
    artifacts: () => [...t.artifacts],
    cancelled: () => t.cancelRequested,
    addSteps: (steps: AgentStep[]) => {
      const idx = t.steps.findIndex((s) => s.status === 'running')
      const insertAt = idx === -1 ? t.steps.length : idx + 1
      const fresh = steps.map((s) => ({ ...s, status: 'queued' as AgentStepStatus, detail: null, log: null }))
      t.steps.splice(insertAt, 0, ...fresh)
      emit(t, { type: 'steps', steps: t.steps.map(stepView) })
    },
  }

  let hardFail: string | null = null
  for (let i = 0; i < t.steps.length; i++) {
    if (t.cancelRequested) {
      for (let j = i; j < t.steps.length; j++) {
        t.steps[j].status = 'skipped'
        t.steps[j].detail = 'Cancelled before this step ran.'
        emit(t, { type: 'step', index: j, step: stepView(t.steps[j]) })
      }
      t.status = 'cancelled'
      break
    }
    const s = t.steps[i]
    s.status = 'running'
    s.log = null
    emit(t, { type: 'step', index: i, step: stepView(s) })
    try {
      const detail = await s.run(ctx)
      s.status = 'done'
      s.detail = detail ? detail.slice(0, 900) : null
      emit(t, { type: 'step', index: i, step: stepView(s) })
    } catch (e) {
      if (e instanceof StepSkip) {
        s.status = 'skipped'
        s.detail = e.message.slice(0, 900)
        emit(t, { type: 'step', index: i, step: stepView(s) })
        continue
      }
      const msg = e instanceof Error ? e.message : String(e)
      s.status = 'failed'
      s.detail = msg.slice(0, 900)
      emit(t, { type: 'step', index: i, step: stepView(s) })
      if (s.critical) {
        hardFail = msg
        for (let j = i + 1; j < t.steps.length; j++) {
          t.steps[j].status = 'skipped'
          t.steps[j].detail = 'Skipped: an earlier step failed.'
          emit(t, { type: 'step', index: j, step: stepView(t.steps[j]) })
        }
        t.status = 'failed'
        break
      }
    }
  }

  if (t.status === 'running') t.status = 'done'
  t.finishedAt = new Date()

  // The report is the student's takeaway; write it even after a failure or a
  // cancellation so the card always closes with something honest.
  const state: ReportState = {
    goal: t.goal,
    steps: t.steps.map((s) => ({ id: s.id, title: s.title, status: s.status, detail: s.detail })),
    artifacts: [...t.artifacts],
    data: t.data,
    cancelled: t.status === 'cancelled',
  }
  try {
    t.report = t.writeReport ? await t.writeReport(state) : defaultReport(state)
  } catch {
    t.report = defaultReport(state)
  }
  if (hardFail) t.report = `The mission stopped early: ${hardFail}\n\n${t.report ?? ''}`.trim()

  emit(t, { type: 'status', status: t.status })
  emit(t, { type: 'done', task: taskView(t) })
  t.subscribers.clear()
}

function defaultReport(state: ReportState): string {
  const lines: string[] = []
  if (state.cancelled) lines.push('Mission cancelled. Everything finished before the cancel is yours to keep.')
  const ok = state.steps.filter((s) => s.status === 'done')
  const bad = state.steps.filter((s) => s.status === 'failed')
  if (ok.length) {
    lines.push(`Completed ${ok.length} of ${state.steps.length} steps:`)
    for (const s of ok) lines.push(`- ${s.title}: ${s.detail ?? 'done'}`)
  }
  if (bad.length) {
    lines.push('')
    lines.push('Did not make it:')
    for (const s of bad) lines.push(`- ${s.title}: ${s.detail ?? 'failed'}`)
  }
  if (state.artifacts.length) {
    lines.push('')
    lines.push(`${state.artifacts.length} verified ${state.artifacts.length === 1 ? 'task' : 'tasks'} landed on your drills shelf.`)
  } else if (!state.cancelled) {
    lines.push('')
    lines.push('No new material came out of this one. Everything above is still true and yours.')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create and launch a mission. Returns the initial snapshot immediately. */
export function startAgentTask(input: AgentTaskInput): { ok: true; task: AgentTaskView } | { ok: false; error: string } {
  prune()
  const existing = runningTaskFor(input.profileId)
  if (existing) {
    return {
      ok: false,
      error: `One mission at a time: "${existing.title}" is still running. Watch it here, or cancel it first.`,
    }
  }
  const mine = [...tasks.values()].filter((t) => t.profileId === input.profileId)
  if (mine.length >= MAX_TASKS_PER_PROFILE) {
    const oldest = mine.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0]
    if (oldest && oldest.finishedAt) tasks.delete(oldest.id)
  }
  const t: Task = {
    id: newId(),
    profileId: input.profileId,
    skill: input.skill,
    title: input.title,
    goal: input.goal,
    status: 'running',
    steps: input.steps.map((s) => ({ ...s, status: 'queued' as AgentStepStatus, detail: null, log: null })),
    report: null,
    artifacts: [],
    actions: [],
    data: {},
    writeReport: input.writeReport,
    startedAt: new Date(),
    finishedAt: null,
    cancelRequested: false,
    subscribers: new Set(),
  }
  tasks.set(t.id, t)
  // Fire and forget: the mission streams its own progress.
  void runTask(t)
  return { ok: true, task: taskView(t) }
}

export function getTaskView(taskId: string, profileId: string): AgentTaskView | null {
  const t = tasks.get(taskId)
  if (!t || t.profileId !== profileId) return null
  return taskView(t)
}

/** Subscribe to a mission's events. Returns an unsubscribe function. */
export function subscribeTask(taskId: string, profileId: string, fn: (e: AgentEvent) => void): (() => void) | null {
  const t = tasks.get(taskId)
  if (!t || t.profileId !== profileId) return null
  t.subscribers.add(fn)
  return () => {
    t.subscribers.delete(fn)
  }
}

export function requestCancel(taskId: string, profileId: string): boolean {
  const t = tasks.get(taskId)
  if (!t || t.profileId !== profileId) return false
  if (t.status === 'running') {
    t.cancelRequested = true
    return true
  }
  return false
}
