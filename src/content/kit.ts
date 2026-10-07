// Step builders: tiny helpers that keep the tier files compact and the
// pedagogy consistent. All FENs and move lines still go through validate.ts.
import type {
  DemoStep,
  ExerciseStep,
  GtmMove,
  GtmStep,
  LessonStep,
  PlayoutStep,
  QuizOption,
  QuizStep,
  TextStep,
} from './schema'

/** Deterministic shuffle seeded by the quiz title. Spreads the correct
    option across slots so the answer position never becomes a tell the
    learner can exploit without reading. Same order on server and client. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // mulberry32: tiny, fast, good enough spread for option ordering
  let a = h >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function text(title: string, body: string[], keyIdea?: string): TextStep {
  return keyIdea ? { type: 'text', title, body, keyIdea } : { type: 'text', title, body }
}

export function demo(
  title: string,
  body: string[],
  fen: string,
  opts: { moves?: string[]; arrows?: DemoStep['arrows']; marks?: DemoStep['marks']; caption?: string } = {},
): DemoStep {
  return { type: 'demo', title, body, fen, ...opts }
}

export const right = (text: string, why: string): QuizOption => ({ text, correct: true, why })
export const wrong = (text: string, why: string): QuizOption => ({ text, why })

export function quiz(
  title: string,
  question: string,
  options: QuizOption[],
  body?: string,
  fen?: string,
): QuizStep {
  return {
    type: 'quiz',
    title,
    question,
    options: seededShuffle(options, `${title}::${question}`),
    ...(body ? { body } : {}),
    ...(fen ? { fen } : {}),
  }
}

export function drill(
  title: string,
  fen: string,
  solution: string[],
  goal: string,
  hint: string,
  success: string,
  opts: { body?: string; explanation?: string } = {},
): ExerciseStep {
  return {
    type: 'exercise',
    title,
    fen,
    solution,
    goal,
    hint,
    success,
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.explanation ? { explanation: opts.explanation } : {}),
  }
}

export function exercise(
  title: string,
  body: string[],
  fen: string,
  solution: string[],
  goal: string,
  hint: string,
  success: string,
): ExerciseStep {
  return {
    type: 'exercise',
    title,
    fen,
    solution,
    goal,
    hint,
    success,
    ...(body.length ? { body: body.join(' ') } : {}),
  }
}

export function playout(
  title: string,
  body: string,
  fen: string,
  side: 'w' | 'b',
  goal: string,
  engineLevel: number,
  success: PlayoutStep['success'],
  maxMoves: number,
  successText: string,
  failText?: string,
  hint?: string,
): PlayoutStep {
  return {
    type: 'playout',
    title,
    body: [body],
    fen,
    side,
    goal,
    engineLevel,
    success,
    maxMoves,
    successText,
    ...(failText ? { failText } : {}),
    ...(hint ? { hint } : {}),
  }
}

export function gtmStep(
  title: string,
  body: string[],
  source: string,
  fen: string,
  prelude: string[],
  moves: GtmMove[],
): GtmStep {
  return { type: 'gtm', title, body, source, fen, ...(prelude.length ? { prelude } : {}), moves }
}

export const guess = (san: string, why: string, opts: { reply?: string; alsoGood?: string[]; okay?: string[] } = {}): GtmMove => ({
  san,
  why,
  ...(opts.reply ? { reply: opts.reply } : {}),
  ...(opts.alsoGood ? { alsoGood: opts.alsoGood } : {}),
  ...(opts.okay ? { okay: opts.okay } : {}),
})

export function steps(...list: LessonStep[]): LessonStep[] {
  return list
}
