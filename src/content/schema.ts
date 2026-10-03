// Lesson content model. Every FEN and move line in the curriculum goes
// through validate.ts, which replays it with chess.js and enforces the
// SAN suffixes (#, +, x). Content that fails validation cannot ship.

export interface Arrow {
  from: string
  to: string
  color?: 'green' | 'red' | 'orange' | 'gray'
}

export interface SquareMark {
  square: string // e.g. "e4"
  color?: 'green' | 'red' | 'yellow' | 'gray'
}

export interface TextStep {
  type: 'text'
  title: string
  body: string[]
  /** Short takeaway shown in a callout box. */
  keyIdea?: string
}

export interface DemoStep {
  type: 'demo'
  title: string
  body: string[]
  fen: string
  /** SAN moves played automatically on the board, one per tap of "Next". */
  moves?: string[]
  arrows?: Arrow[]
  marks?: SquareMark[]
  /** Caption under the board, e.g. "White to move". */
  caption?: string
}

export interface QuizOption {
  text: string
  correct?: boolean
  /** Shown after the choice is made. */
  why: string
}

export interface QuizStep {
  type: 'quiz'
  title: string
  body?: string
  fen?: string
  question: string
  options: QuizOption[]
}

export interface ExerciseStep {
  type: 'exercise'
  title: string
  body?: string
  fen: string
  /**
   * Alternating line: user moves at even indexes, forced opponent replies
   * at odd indexes. SAN. e.g. ["Qh5", "g6", "Qxf7#"].
   */
  solution: string[]
  goal: string
  hint: string
  success: string
  explanation?: string
}

export interface PlayoutStep {
  type: 'playout'
  title: string
  body?: string
  fen: string
  side: 'w' | 'b'
  goal: string
  engineLevel: number
  /**
   * checkmate = deliver mate; material = end up +3 or better; draw = hold
   * the draw; castle = get castled (and stay even) within maxMoves
   */
  success: 'checkmate' | 'material' | 'draw' | 'castle'
  maxMoves?: number
  successText: string
  failText?: string
}

export type LessonStep = TextStep | DemoStep | QuizStep | ExerciseStep | PlayoutStep

export interface Lesson {
  id: string
  title: string
  subtitle: string
  minutes: number
  steps: LessonStep[]
}

export interface Level {
  id: string
  n: number
  title: string
  tagline: string
  color: string
  lessons: Lesson[]
}

export interface Puzzle {
  id: string
  fen: string
  /** Space-separated SAN line including forced replies, e.g. "Nf6+ Kf8 Nxd7". */
  solution: string
  rating: number
  themes: string[]
  title: string
  /** Real game it came from, if any, e.g. "Morphy – Duke of Brunswick, Paris 1858". */
  source?: string
}
