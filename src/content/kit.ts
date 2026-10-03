// Step builders: tiny helpers that keep the tier files compact and the
// pedagogy consistent. All FENs and move lines still go through validate.ts.
import type {
  DemoStep,
  ExerciseStep,
  LessonStep,
  PlayoutStep,
  QuizOption,
  QuizStep,
  TextStep,
} from './schema'

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
): QuizStep {
  return { type: 'quiz', title, question, options, body }
}

export function drill(
  title: string,
  fen: string,
  solution: string[],
  goal: string,
  hint: string,
  success: string,
  opts: { body?: string[]; explanation?: string } = {},
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
): PlayoutStep {
  return { type: 'playout', title, body: [body], fen, side, goal, engineLevel, success, maxMoves, successText, ...(failText ? { failText } : {}) }
}

export function steps(...list: LessonStep[]): LessonStep[] {
  return list
}
