/**
 * Opening repertoire training data + the mastery engine.
 *
 * Data model mirrors chessreps.com's flat model (RE report, docs/chessreps-re-report.md):
 * a course owns lines; each line is a plain SAN sequence from the start
 * position; a shared trunk is auto-played before the student's first
 * decision; per-position idea notes replace their `descriptions` map.
 *
 * Mastery scheduling is the REAL ts-fsrs v6 (FSRS-6.0) — the exact open-source
 * scheduler chessreps.com inlines in their bundle (RE report: request_retention
 * 0.9, maximum_interval 36500, grades mapped from mistakes+hints). No more
 * fixed-interval approximation: per-line memory state (stability/difficulty)
 * drives the next due date, so a line you keep acing spaces out to weeks and
 * a line you keep lapsing comes back in minutes — like the real thing.
 *
 *  - grade from mistakes+hints: 0/0 -> good, 1 -> hard, >=2 -> again (their rule)
 *  - confidence 0..10 stays as the UX-facing number (default 5, +/-2 per grade)
 *  - due/fsrsCard come from the scheduler (short-term learning steps included,
 *    exactly like chessreps: a fresh line comes back within minutes, then days)
 *  - picker: started-but-not-perfected first, sort by overdue, random top-3
 *
 * Legacy records (pre-FSRS) migrate by letting the scheduler start fresh on
 * their next review; reps/lapses/confidence counters are preserved so records
 * and UI never lose history.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade as FsrsGrade } from 'ts-fsrs'

export type RepGrade = 'again' | 'hard' | 'good'

export interface RepertoireLine {
  id: string
  /** SAN sequence AFTER the trunk, alternating strictly (student first). */
  moves: string[]
  /** Short idea note revealed when the line is completed. */
  idea: string
}

export interface RepertoireCourse {
  id: string
  name: string
  /** The side the student trains. */
  side: 'w' | 'b'
  blurb: string
  /** Moves auto-played (both sides) before the student's first decision. */
  trunk: string[]
  lines: RepertoireLine[]
  /** Lichess opening tags used to pull this course's puzzle pool (Puzzles mode). */
  openings: string[]
}

/**
 * JSON-safe snapshot of a ts-fsrs Card (Date fields as epoch ms) — this exact
 * shape is what localStorage and the server mirror both persist.
 */
export interface FsrsCard {
  due: number // epoch ms
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  /** 0 New | 1 Learning | 2 Review | 3 Relearning (ts-fsrs State) */
  state: number
  last_review: number | null
}

/** Per-line mastery state persisted locally (chessreps is local-first too). */
export interface LineMastery {
  confidence: number // 0..10
  due: number // epoch ms
  reps: number
  lapses: number
  lastGrade: RepGrade | 'new'
  bestStreak: number
  updatedAt?: number // epoch ms — set on every result; drives sync LWW
  fsrsCard?: FsrsCard // scheduler memory state (absent on pre-FSRS records)
}

export type MasteryMap = Record<string, Record<string, LineMastery>>

const DAY = 86_400_000

/**
 * The scheduler, exactly as chessreps configures it (RE report evidence):
 * ts-fsrs defaults with request_retention 0.9 and maximum_interval 36500.
 * Short-term learning steps stay enabled (their fresh lines return in
 * minutes too — it is what makes a first session actually teach).
 */
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 36500 }))

const GRADE_TO_FSRS: Record<RepGrade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
}

/** Date-bearing Card -> JSON-safe snapshot. */
function serializeCard(c: Card): FsrsCard {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  }
}

/** JSON-safe snapshot -> Date-bearing Card for the scheduler. */
function reviveCard(s: FsrsCard): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as Card['state'],
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

/** Default mastery for a never-touched line. */
export function newMastery(): LineMastery {
  return { confidence: 5, due: 0, reps: 0, lapses: 0, lastGrade: 'new', bestStreak: 0 }
}

/** chessreps grade rule: 0/0 -> good, 1 -> hard, >=2 -> again. */
export function gradeFor(mistakes: number, hints: number): RepGrade {
  const total = mistakes + hints
  if (total === 0) return 'good'
  if (total === 1) return 'hard'
  return 'again'
}

/** Apply one drill result to a line's mastery (pure; returns the next state). */
export function applyResult(prev: LineMastery | undefined, grade: RepGrade, streak: number): LineMastery {
  const base = prev ?? newMastery()
  const now = new Date()
  // Pre-FSRS records (reps>0, no card) start the scheduler fresh: the counters
  // keep their history, the memory model just needs a couple of reviews to
  // converge onto the student's real forgetting curve.
  const card = base.fsrsCard ? reviveCard(base.fsrsCard) : createEmptyCard(now)
  const nextCard = scheduler.repeat(card, now)[GRADE_TO_FSRS[grade]].card
  const confidence = Math.max(0, Math.min(10, base.confidence + (grade === 'good' ? 2 : grade === 'hard' ? 0 : -2)))
  return {
    confidence,
    due: nextCard.due.getTime(),
    reps: base.reps + 1,
    lapses: base.lapses + (grade === 'again' ? 1 : 0),
    lastGrade: grade,
    bestStreak: Math.max(base.bestStreak, streak),
    updatedAt: now.getTime(),
    fsrsCard: serializeCard(nextCard),
  }
}

/** Days until due (fractional, >=0) — used by the line list. */
export function daysUntilDue(m: LineMastery | undefined): number | null {
  if (!m || m.reps === 0) return null
  return Math.max(0, (m.due - Date.now()) / DAY)
}

/** Confidence 0..10 -> dot color class (chessreps line-list dots). */
export function confidenceDot(m: LineMastery | undefined): string {
  if (!m || m.reps === 0) return 'bg-muted-foreground/30'
  if (m.confidence >= 9) return 'bg-emerald-500'
  if (m.confidence >= 6) return 'bg-lime-500'
  if (m.confidence >= 4) return 'bg-amber-500'
  return 'bg-red-500'
}

export function masteryPercent(lines: RepertoireLine[], map: Record<string, LineMastery> | undefined): number {
  if (lines.length === 0) return 0
  let sum = 0
  for (const l of lines) {
    const m = map?.[l.id]
    sum += m && m.reps > 0 ? Math.round((m.confidence / 10) * 100) : 0
  }
  return Math.round(sum / lines.length)
}

/**
 * The chessreps line picker: prefer started-but-not-perfected lines, sort by
 * overdue (now - due; never-trained = infinitely overdue = front), then pick
 * a random line among the top 3 so sessions never feel scripted.
 */
export function pickNextLine(course: RepertoireCourse, map: Record<string, LineMastery> | undefined, excludeId?: string): RepertoireLine {
  const now = Date.now()
  const scored = course.lines
    .filter((l) => l.id !== excludeId)
    .map((l) => {
      const m = map?.[l.id]
      const started = !!m && m.reps > 0
      const overdue = started ? now - m.due : Number.MAX_SAFE_INTEGER
      return { line: l, started, overdue, confidence: m?.confidence ?? 5 }
    })
  const started = scored.filter((s) => s.started && s.confidence < 10)
  const pool = started.length >= 3 ? started : started.length > 0 ? started : scored
  pool.sort((a, b) => b.overdue - a.overdue)
  const top3 = pool.slice(0, Math.min(3, pool.length))
  return top3[Math.floor(Math.random() * top3.length)].line
}

/** Mastery label for the course card. */
export function masteryLabel(pct: number): string {
  if (pct >= 90) return 'Perfected'
  if (pct >= 65) return 'Strong'
  if (pct >= 35) return 'In progress'
  if (pct > 0) return 'Just started'
  return 'Not started'
}

/**
 * Built-in starter repertoires. Every sequence is verified playable by
 * scripts/verify-reps.ts (bun scripts/verify-reps.ts) - the trainer refuses
 * to ship an illegal line.
 */
export const REPERTOIRE_COURSES: RepertoireCourse[] = [
  {
    id: 'london',
    name: 'London System',
    side: 'w',
    blurb: 'Solid d4+d5+Bf4 setup. One system, lifelong friend: almost no theory, clear plans every game.',
    trunk: ['d4', 'd5', 'Bf4'],
    openings: ['London_System', 'Queens_Pawn_Game_Accelerated_London_System'],
    lines: [
      { id: 'london-nf6-e6', moves: ['Nf6', 'Nf3', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'b6', 'Nbd2', 'Bb7', 'Ne5'], idea: 'Classical London: trade the dark bishops with Bg3, build with e3+Bd3, and the f3-knight hops to e5, the dream square.' },
      { id: 'london-kid', moves: ['Nf6', 'e3', 'g6', 'Nf3', 'Bg7', 'Nbd2', 'O-O', 'Be2', 'c5', 'c3'], idea: 'Against King\u2019s Indian setups: hold the center with e3+c3, keep Bf4 eyeing g7, and play for e4 at the right moment.' },
      { id: 'london-c5-attack', moves: ['c5', 'e3', 'Nf6', 'c3', 'e6', 'Nd2', 'Bd6', 'Bg3', 'O-O', 'Ngf3', 'b6', 'Bd3', 'Bb7'], idea: 'The Jobava-free main setup vs early c5: solid c3-e3 wedge, develop behind it, then expand with e4.' },
      { id: 'london-bf5-trade', moves: ['Bf5', 'Nf3', 'e6', 'e3', 'Nf6', 'Bd3', 'Bxd3', 'cxd3', 'c5', 'Nc3'], idea: 'Offer the light-bishop trade on d3: doubled pawns are more than paid back by the open c-file and free hands.' },
      { id: 'london-slav-setup', moves: ['c6', 'Nf3', 'Bf5', 'e3', 'e6', 'Bd3', 'Bxd3', 'cxd3', 'Nf6', 'Nbd2', 'Nbd7', 'O-O', 'Be7', 'Qc2'], idea: 'Vs the Slav setup: take the bishop pair, then finish development with Qc2 and prepare e4.' },
    ],
  },
  {
    id: 'italian',
    name: 'Italian Game',
    side: 'w',
    blurb: '1.e4 e5 with the Italian bishop. The classical way to fight for the center since the 1500s.',
    trunk: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    openings: ['Italian_Game'],
    lines: [
      { id: 'italian-pianissimo', moves: ['Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Re1', 'a6', 'Nbd2', 'Ba7'], idea: 'Giuoco Pianissimo: slow build, c3+d3 wedge, Re1 then d4 later. Patience first, storms later.' },
      { id: 'italian-two-knights', moves: ['Nf6', 'd3', 'Bc5', 'c3', 'd6', 'O-O', 'O-O', 'Re1'], idea: 'Two Knights with d3: refuse the Ng5 gamble, outdevelop, and meet ...Ng4 with d4 when ready.' },
      { id: 'italian-evans', moves: ['Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O'], idea: 'The Evans Gambit: a pawn for a giant center and open lines. Castle into the attack; the pin on c3 is the trap.' },
      { id: 'italian-hungarian', moves: ['Be7', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'O-O', 'O-O'], idea: 'Vs the passive Hungarian: take the center with d4, and Nxd4 keeps every piece active.' },
    ],
  },
  {
    id: 'open-sicilian',
    name: 'Open Sicilian',
    side: 'w',
    blurb: 'The main battlefield of 1.e4: c5 met head-on with Nf3, d4 and big theory. Choose your weapon.',
    trunk: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'],
    openings: ['Sicilian_Defense', 'Sicilian_Defense_Najdorf_Variation'],
    lines: [
      { id: 'najdorf-be2', moves: ['a6', 'Be2', 'e5', 'Nb3', 'Be7', 'O-O', 'O-O', 'Be3', 'Be6'], idea: 'Classical Najdorf: quiet Be2, meet ...e5 with Nb3 and re-route via c2-e3. Long-term kingside space.' },
      { id: 'najdorf-english', moves: ['a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7', 'Qd2', 'O-O', 'O-O-O', 'Nbd7'], idea: 'English Attack: f3+Qd2+O-O-O. The pawn race is on: who mates first, wins.' },
      { id: 'dragon-classical', moves: ['Nc6', 'Be3', 'g6', 'f3', 'Bg7', 'Qd2', 'O-O', 'O-O-O', 'd5'], idea: 'Vs the Dragon: Yugoslav attack. Castle long, hurl h4-h5, the g7 bishop watches the wrong side.' },
      { id: 'scheveningen-be2', moves: ['e6', 'Be2', 'a6', 'O-O', 'Be7', 'f4', 'O-O', 'Kh1', 'Qc7'], idea: 'Vs the Scheveningen: f4 space gain, Kh1 safe from ...Bg4 pins, then e4-e5 breaks.' },
    ],
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    side: 'b',
    blurb: 'Black\u2019s rock: challenge e4 with ...c6 and keep a healthy structure no matter what White tries.',
    trunk: ['e4', 'c6', 'd4', 'd5'],
    openings: ['Caro-Kann_Defense'],
    lines: [
      { id: 'caro-advance-bf5', moves: ['e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'Be3', 'Qb6', 'Nc3'], idea: 'Vs the Advance: Bf5 BEFORE ...e6 (the whole point of ...c6), then hit d4 with ...c5 and ...Qb6.' },
      { id: 'caro-classical', moves: ['Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3'], idea: 'Classical: ...Bf5 challenges the knight, ...Bg6+h6 dodges h4-h5 tricks, trade on d3, free easy game.' },
      { id: 'caro-exchange', moves: ['exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'e6'], idea: 'Vs the Exchange: no free equalizer for White. Fast development, ...Nf6+...e6, the bishop pair flex.' },
      { id: 'caro-fantasy', moves: ['f3', 'e6', 'Be3', 'c5', 'c3', 'Nc6', 'Ne2'], idea: 'Vs the Fantasy: ...e6 keeps the Bf5 option, then ...c5 punishes the f3 tempo loss immediately.' },
    ],
  },
  {
    id: 'qgd',
    name: 'Queen\u2019s Gambit Declined',
    side: 'b',
    blurb: 'The classical answer to 1.d4: rock-solid ...e6, free development, and a structure that endgames love.',
    trunk: ['d4', 'd5', 'c4'],
    openings: ['Queens_Gambit_Declined', 'Semi-Slav_Defense'],
    lines: [
      { id: 'qgd-orthodox', moves: ['e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'], idea: 'Orthodox: h6 kicks the g5 bishop before ...b6 unpins. Slow, solid, unbreakable.' },
      { id: 'qgd-tarrasch', moves: ['e6', 'Nc3', 'c5', 'cxd5', 'exd5', 'Nf3', 'Nc6', 'g3', 'Nf6', 'Bg2', 'Be7', 'O-O', 'O-O'], idea: 'Tarrasch: grab the center with ...c5, accept the isolated pawn, and outplay them with piece activity.' },
      { id: 'semi-slav-meran', moves: ['c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'e3', 'Nbd7', 'Bd3', 'dxc4', 'Bxc4', 'b5', 'Bd3', 'a6', 'e4', 'c5'], idea: 'Meran: win the bishop pair with ...dxc4+...b5, then smash the center with ...c5 counterplay.' },
    ],
  },
  {
    id: 'qga',
    name: 'Queen\u2019s Gambit Accepted',
    side: 'b',
    blurb: 'Take the pawn, hit back with ...c5 and ...e6: the most direct route to free queenside play.',
    trunk: ['d4', 'd5', 'c4'],
    openings: ['Queens_Gambit_Accepted'],
    lines: [
      { id: 'qga-main', moves: ['dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5', 'O-O', 'a6', 'Qe2', 'b5', 'Bb3', 'Bb7'], idea: 'Main line: ...c5 hits d4 at once, ...b5+...Bb7 finishes development, and the c-file belongs to Black.' },
    ],
  },
  {
    id: 'kid',
    name: 'King\u2019s Indian Defense',
    side: 'b',
    blurb: 'Let White take the center, then blow it up. ...g6, ...Bg7 and the e5/f5 storms.',
    trunk: ['d4', 'Nf6', 'c4'],
    openings: ['Kings_Indian_Defense'],
    lines: [
      { id: 'kid-classical', moves: ['g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7'], idea: 'Classical main line: ...e5 then ...Ne7 reroutes the knight to the kingside. The g7 bishop is the soul: storm with ...f5 later.' },
    ],
  },
]
