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
  /** Where the position came from: a real game's attribution line, when the
   * material was mined from actual play instead of crafted. */
  source: string | null
  /** Link to the original game record, when available. */
  gameUrl: string | null
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
    source: typeof payload.source === 'string' && payload.source ? payload.source : null,
    gameUrl: typeof payload.gameUrl === 'string' && payload.gameUrl ? payload.gameUrl : null,
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

/** Spoiler-safe display name for an artifact. A puzzle or drill headline can
 * give the whole game away ("Knight sacrifice forces mate" or the mechanical
 * "White mates with Rxd8" name the winning method before a single move is
 * played), and a quiz headline like "Spot the fork" names the answer, so
 * until the material is solved every listing shows a neutral name; the real
 * headline appears once the win is in. Walkthroughs carry no hidden line, so
 * they always show their title. The "solve to reveal" note itself lives in
 * the card's eyebrow chip, so this stays a plain kind + side + rating line. */
export function displayTitle(a: Pick<ArtifactView, 'kind' | 'title' | 'solved' | 'rating' | 'sideToMove'>): string {
  if (a.kind === 'line' || a.solved === true) return a.title
  const kind = a.kind === 'drill' ? 'Drill' : a.kind === 'quiz' ? 'Quiz' : 'Puzzle'
  const side = a.sideToMove === 'b' ? 'Black to play' : a.sideToMove === 'w' ? 'White to play' : null
  if (side) return a.rating != null ? `${kind} · ${side} ${a.rating}` : `${kind} · ${side}`
  return a.rating != null ? `${kind} · ${a.rating}` : kind
}

/** Client-boundary spoiler guard, the last line of defense for the rule the
 * students keep checking: an unsolved puzzle or drill headline (and its
 * stored hint) never leaves the server. Hiding the title in the card UI is
 * not enough; a title that rides along in the API payload leaks from the
 * network tab, from a future render site, from a dialog frame that forgot
 * the rule. So every endpoint that serves an ArtifactView to the browser
 * ships unsolved board material through this: the real headline is replaced
 * with the same neutral line the card shows, and the stored hint is dropped
 * (the card nudges with its own generic process line anyway). Solved cards
 * and walkthroughs pass through untouched, so the post-solve reveal still
 * works: the card re-fetches its own copy once it is solved and the real
 * headline arrives. */
export function stripUnsolved(a: ArtifactView): ArtifactView {
  if (a.kind === 'line' || a.solved === true) return a
  return { ...a, title: displayTitle(a), hint: null }
}
