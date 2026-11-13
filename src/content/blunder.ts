// Blunder Training drill pools. Every position here is checked by the
// content validator (validate.ts) against the shared scan engine
// (lib/chess/blunder-scan.ts): the graded facts — which move is the one
// threat, whether a candidate is safe, which moves survive — are computed,
// never asserted. Only the teaching notes are curated.
//
// Three drills, one habit: run the scan on BOTH sides of every move.
//   threat     — play the opponent's best shot: their check, capture or mate.
//   blunderCheck — judge a tempting candidate before playing it: safe or blunder.
//   safemove   — you are in danger: find the move that survives.

export interface ThreatDrill {
  id: string
  /** Side to move is the attacker: the student plays their shot. */
  fen: string
  /** The one shot (mate or free piece), guaranteed unique by the validator. */
  threat: string
  /** One line of doctrine shown after the round. */
  note: string
}

export interface BlunderCheckDrill {
  id: string
  fen: string
  /** The tempting candidate move, shown with an arrow. */
  candidate: string
  verdict: 'safe' | 'blunder'
  /** Shown after the verdict; for blunders the punish move executes first. */
  why: string
}

export interface SafeMoveDrill {
  id: string
  /** The student is to move and in danger. */
  fen: string
  scene: string
  /** Tempting moves that fail the scan — surfaced by name when played. */
  traps: string[]
  trapNote: string
  /** One honest survivor, shown as the example escape. */
  escape: string
  escapeNote: string
}

export const THREAT_DRILLS: ThreatDrill[] = [
  {
    id: 'th-backrank-rook',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    threat: 'Ra8#',
    note: 'The back rank: three pawns wall their own king in. One rook to the eighth ends it.',
  },
  {
    id: 'th-hanging-queen',
    fen: '7k/8/8/3q4/8/8/3R4/4K3 w - - 0 1',
    threat: 'Rxd5',
    note: 'The queen landed on a square nothing defends. Run the scan from their side and the capture is staring back at you.',
  },
  {
    id: 'th-backrank-queen-rook',
    fen: '3r2k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1',
    threat: 'Qxd8#',
    note: 'The rook on d8 guards nothing: the queen takes it with mate. Checks come first — always.',
  },
  {
    id: 'th-knight-eats-queen',
    fen: '4k3/8/8/2q5/8/1N6/8/4K3 w - - 0 1',
    threat: 'Nxc5',
    note: 'Even a small piece eats a queen when the queen is loose. Count defenders, not size.',
  },
  {
    id: 'th-queen-takes-rook',
    fen: '4k3/8/8/3r4/8/5Q2/8/4K3 w - - 0 1',
    threat: 'Qxd5',
    note: 'The rook stepped onto the queen\'s diagonal and nothing defends it. Diagonals are firing lines.',
  },
  {
    id: 'th-two-rook-ladder',
    fen: '7k/R7/8/8/8/8/8/1R4K1 w - - 0 1',
    threat: 'Rb8#',
    note: 'The two-rook ladder: one rook cuts the escape rank, the other mates. Finish the ladder.',
  },
  {
    id: 'th-rook-takes-bishop',
    fen: '7k/8/8/3b4/8/8/3R4/4K3 w - - 0 1',
    threat: 'Rxd5',
    note: 'The bishop is on the rook\'s file with no defender. The scan asks one thing: what is loose?',
  },
  {
    id: 'th-backrank-queen',
    fen: '6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1',
    threat: 'Qd8#',
    note: 'Same back rank, now by queen: the pawns that never moved are the only defenders their king has.',
  },
]

export const BLUNDER_CHECK_DRILLS: BlunderCheckDrill[] = [
  {
    id: 'bc-queen-for-pawn',
    fen: '4k3/3p4/8/8/8/8/3Q4/4K3 w - - 0 1',
    candidate: 'Qxd7+',
    verdict: 'blunder',
    why: 'A check that gives away the queen: the pawn was guarded by its own king. Nine points for one.',
  },
  {
    id: 'bc-free-pawn',
    fen: '4k3/8/8/3p4/8/8/3Q4/4K3 w - - 0 1',
    candidate: 'Qxd5',
    verdict: 'safe',
    why: 'Nothing recaptures: the pawn is genuinely free. This is the same square as the last drill — the scan decides, not the square.',
  },
  {
    id: 'bc-defended-knight',
    fen: '4k3/8/4p3/3n4/8/3Q4/8/4K3 w - - 0 1',
    candidate: 'Qxd5',
    verdict: 'blunder',
    why: 'The knight looked loose but the e6 pawn guards it. Queen for knight-and-nothing: the trap of not counting defenders.',
  },
  {
    id: 'bc-even-trade',
    fen: '8/4k3/3Rr3/8/8/8/8/4K3 w - - 0 1',
    candidate: 'Rxe6+',
    verdict: 'safe',
    why: 'Rook takes rook, king takes back: an even trade is not a blunder. Give five, take five, go on.',
  },
  {
    id: 'bc-guarded-pawn',
    fen: '4k3/8/1p6/2p5/4N3/8/8/4K3 w - - 0 1',
    candidate: 'Nxc5',
    verdict: 'blunder',
    why: 'The pawn was guarded by its neighbor on b6. A knight for a pawn is a slow way to lose.',
  },
  {
    id: 'bc-step-off-file',
    fen: '4k3/8/8/3r4/8/8/3N4/4K3 w - - 0 1',
    candidate: 'Nb3',
    verdict: 'safe',
    why: 'The knight steps off the file the rook owns. When something attacks you, leaving the line is the simplest answer.',
  },
  {
    id: 'bc-eighth-rank-greed',
    fen: '5rk1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    candidate: 'Re8',
    verdict: 'blunder',
    why: 'Pushing to the eighth looks active, but the black rook owns that rank first. Rxe8 and the rook is gone.',
  },
  {
    id: 'bc-early-queen',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    candidate: 'Qh5',
    verdict: 'safe',
    why: 'Safe but weak: nothing is lost, yet g6 or Nf6 stops the threat and develops a piece for free. Blunder-safe is not the same as good.',
  },
]

export const SAFE_MOVE_DRILLS: SafeMoveDrill[] = [
  {
    id: 'sm-rook-file',
    fen: '4k3/8/8/3r4/3Q4/8/8/4K3 w - - 0 1',
    scene: 'Your queen walked onto the file the black rook owns. It is attacked and nothing defends it.',
    traps: ['Qd1', 'Qc5'],
    trapNote: 'Qd1 and Qc5 stay on the rook\'s lines — same file, same rank, still dead.',
    escape: 'Qxd5',
    escapeNote: 'The attacker is undefended: eat it first. The best defense is often a counter-capture.',
  },
  {
    id: 'sm-bishop-diagonal',
    fen: '4k3/8/1b6/8/3Q4/8/8/4K3 w - - 0 1',
    scene: 'Your queen sits on the bishop\'s long diagonal. The whole diagonal is a firing line.',
    traps: ['Qe3', 'Qc5', 'Qf2', 'Qg1'],
    trapNote: 'Every trap stays on the same diagonal: b6-c5-d4-e3-f2-g1. Leaving one square sideways is not leaving.',
    escape: 'Qxb6',
    escapeNote: 'Take the bishop itself — it is undefended. The threat and the attacker vanish together.',
  },
  {
    id: 'sm-bishop-rook',
    fen: '4k3/8/8/8/8/4b3/3R4/4K3 w - - 0 1',
    scene: 'The bishop on e3 has your rook in its sights. Nothing defends the rook.',
    traps: ['Rd4', 'Rf2'],
    trapNote: 'Rd4 and Rf2 land back on the bishop\'s diagonals. Check the landing square, not just the leaving square.',
    escape: 'Rd1',
    escapeNote: 'Off the file and off every diagonal. One square of thought saves five points.',
  },
  {
    id: 'sm-pawn-rook',
    fen: '4k3/8/8/8/8/4p3/3R4/4K3 w - - 0 1',
    scene: 'A pawn is attacking your rook. One-point pieces take five-point pieces when nobody looks.',
    traps: ['Rf2', 'Kd1', 'Kf1'],
    trapNote: 'Rf2 walks into the pawn; king moves ignore it and the pawn takes the rook anyway.',
    escape: 'Rd1',
    escapeNote: 'Step off the attacked square. A pawn only guards what it can reach.',
  },
  {
    id: 'sm-pawn-queen',
    fen: '4k3/8/8/8/8/4p3/3Q4/4K3 w - - 0 1',
    scene: 'A pawn attacks the queen. The most expensive blunders start with the smallest attackers.',
    traps: ['Qf2', 'Kd1'],
    trapNote: 'Qf2 is still on the pawn\'s reach; king moves leave the queen to be taken.',
    escape: 'Qd4',
    escapeNote: 'Far enough that the pawn cannot follow. Qxe3 even wins the pawn with check.',
  },
]

export const BLUNDER_DRILL_MODES = ['threat', 'blunderCheck', 'safemove'] as const
export type BlunderDrillMode = (typeof BLUNDER_DRILL_MODES)[number]
