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
  /**
   * SAN moves the reader plays by tapping "Watch the line": they predict
   * first, the board then reveals the line one paced move at a time.
   */
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

export interface GtmMove {
  /** The master's actual move, SAN. The lesson line continues from it. */
  san: string
  /** The opponent's scripted reply in the real game, SAN. Omit after the final move. */
  reply?: string
  /** Other moves that solve the point equally well; full credit. */
  alsoGood?: string[]
  /** Playable but weaker; half credit, then the master's move is shown. */
  okay?: string[]
  /** One or two lines: the idea behind the master's move. */
  why: string
}

export interface GtmStep {
  type: 'gtm'
  title: string
  body: string[]
  /** Real game it came from, or an honest label like "Composed study for ChessX". */
  source: string
  fen: string
  /** Moves already played and shown on the board before guessing starts. */
  prelude?: string[]
  /** One entry per guessing-side move, in order. */
  moves: GtmMove[]
}

export type LessonStep = TextStep | DemoStep | QuizStep | ExerciseStep | PlayoutStep | GtmStep

/** One level inside a tier: a single interactive lesson with several steps. */
export interface Level {
  id: string
  /** 1..20 within the tier */
  n: number
  title: string
  subtitle: string
  minutes: number
  steps: LessonStep[]
  /** 2..4 concept ids from CONCEPTS that this level actually teaches. */
  concepts?: string[]
}

/** Shared concept taxonomy used by the skill model, puzzle themes and review. */
export const CONCEPTS = [
  'mate', 'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleAttack', 'removingDefender',
  'promotion', 'endgame', 'winningMaterial', 'sacrifice', 'defense', 'famousGame',
  'development', 'center', 'castlingSafety', 'kingSafety', 'pawnStructure', 'openFiles',
  'pieceActivity', 'kingActivity', 'opposition', 'outposts', 'zugzwang', 'calculation',
  'prophylaxis', 'coordination', 'pawnBreaks', 'bishopPair', 'initiative', 'technique',
  'tempo', 'tradeDecisions',
] as const

/** Full credit for the master move or an alsoGood alternative. */
export type GtmCredit = 'full' | 'half' | 'none'

/** A full tier of the curriculum: 20 levels, newbie to grandmaster. */
export interface Tier {
  id: string
  /** 1..6 */
  n: number
  title: string
  tagline: string
  color: string
  levels: Level[]
}

export interface Puzzle {
  id: string
  fen: string
  /** Space-separated SAN line including forced replies, e.g. "Nf6+ Kf8 Nxd7". */
  solution: string
  rating: number
  themes: string[]
  title: string
  /** Real game it came from, if any, e.g. "Morphy, Duke of Brunswick, Paris 1858". */
  source?: string
}
