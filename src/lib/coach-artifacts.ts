// Shared shape of a coach-generated artifact as it travels between the API
// and the UI. Server and client both import this; it must stay free of
// server-only imports.

export interface QuizOptionView {
  text: string
  correct: boolean
  why: string
}

export type ArtifactKind = 'puzzle' | 'drill' | 'quiz' | 'line'

/** One commented move of a walkthrough line (opening traps, famous games). */
export interface LineStep {
  san: string
  note?: string
}

export interface ArtifactView {
  id: string
  kind: ArtifactKind
  title: string
  fen: string | null
  /** Solver move first, then forced replies, alternating. SAN. For kind
   * 'line': the full walkthrough move sequence. */
  solution: string[]
  sideToMove: 'w' | 'b' | null
  question: string | null
  hint: string | null
  goal: string | null
  explanation: string | null
  options: QuizOptionView[] | null
  /** Kind 'line' only: per-move commentary straight from the payload. */
  steps: LineStep[] | null
  themes: string[]
  rating: number | null
  /** Curriculum anchor like "beginner:5", when the artifact was made for a level. */
  levelRef: string | null
  engineVerified: boolean
  attempts: number
  solved: boolean | null
  createdAt: string
}

/** Parse a stored/serialized artifact row into the client view. Tolerant: a
 * malformed row degrades to an empty-but-valid view instead of crashing. */
export function artifactFromRow(row: Record<string, unknown>): ArtifactView {
  const payload = safeParse(row.payloadJson)
  const themes = safeArray(row.themes)
  const solutionRaw = typeof row.solution === 'string' && row.solution.trim() ? row.solution.trim().split(/\s+/) : []
  const kind = row.kind === 'drill' || row.kind === 'quiz' || row.kind === 'line' ? (row.kind as ArtifactKind) : 'puzzle'
  const stepsRaw = Array.isArray(payload.steps) ? payload.steps : null
  const steps: LineStep[] | null = stepsRaw
    ? stepsRaw
        .slice(0, 80)
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>
          return { san: String(o.san ?? ''), note: typeof o.note === 'string' && o.note ? o.note : undefined }
        })
        .filter((s) => s.san)
    : null
  return {
    id: String(row.id ?? ''),
    kind,
    title: String(row.title ?? 'Coach drill'),
    fen: typeof row.fen === 'string' && row.fen ? row.fen : null,
    solution: solutionRaw,
    sideToMove: row.sideToMove === 'w' || row.sideToMove === 'b' ? row.sideToMove : null,
    question: typeof row.question === 'string' && row.question ? row.question : null,
    hint: typeof payload.hint === 'string' && payload.hint ? payload.hint : null,
    goal: typeof payload.goal === 'string' && payload.goal ? payload.goal : null,
    explanation: typeof payload.explanation === 'string' && payload.explanation ? payload.explanation : null,
    options: Array.isArray(payload.options) && payload.options.length ? payload.options : null,
    steps: steps && steps.length ? steps : null,
    themes,
    rating: typeof row.rating === 'number' ? row.rating : null,
    levelRef: typeof row.levelRef === 'string' && row.levelRef ? row.levelRef : null,
    engineVerified: Boolean(row.engineVerified),
    attempts: typeof row.attempts === 'number' ? row.attempts : 0,
    solved: typeof row.solved === 'boolean' ? row.solved : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
  }
}

function safeParse(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function safeArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 6) : []
  } catch {
    return []
  }
}

const TIER_TITLES: Record<string, string> = {
  newbie: 'Newbie',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  master: 'Master',
  grandmaster: 'Grandmaster',
}

/** "beginner:5" to "Beginner · Level 5". Null-safe for loose rows. */
export function levelRefLabel(ref: string | null | undefined): string | null {
  if (!ref) return null
  const [tierId, nRaw] = ref.split(':')
  const tier = TIER_TITLES[tierId]
  if (!tier) return null
  const n = Number(nRaw)
  return Number.isFinite(n) && n > 0 ? `${tier} · Level ${n}` : tier
}

/** Rating band the coach aims at for a tier/level pair. Tier 1..6, level 1..20. */
export function levelRating(tierN: number, levelN: number): number {
  const base = [550, 800, 1100, 1450, 1800, 2100][Math.min(6, Math.max(1, tierN)) - 1]
  const progress = (Math.min(20, Math.max(1, levelN)) - 1) / 19
  return Math.round(base + progress * 350)
}
