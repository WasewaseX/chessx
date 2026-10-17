import type { Puzzle } from './schema'
import { PUZZLES_PACK } from './puzzles-pack'
import { MASTER_PUZZLES } from './master-puzzles'

// Base pack: hand-verified positions used across lessons and the daily pool.
// The extended pack lives in puzzles-pack.ts and is validated the same way.
const BASE: Puzzle[] = [
  {
    id: 'p-backrank-guard',
    fen: '6k1/5p1p/6p1/8/8/8/1B3PPP/R5K1 w - - 0 1',
    solution: 'Ra8#',
    rating: 450,
    themes: ['mate'],
    title: 'Heavy-piece ending',
  },
  {
    id: 'p-corner-knight',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    solution: 'Nf7#',
    rating: 500,
    themes: ['mate'],
    title: 'Close quarters',
  },
  {
    id: 'p-arabian',
    fen: '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1',
    solution: 'Rh7#',
    rating: 600,
    themes: ['mate'],
    title: 'Rook and knight ending',
  },
  {
    id: 'p-corridor',
    fen: '3k4/3p4/1P3P2/8/8/8/8/R5K1 w - - 0 1',
    solution: 'Ra8#',
    rating: 450,
    themes: ['mate'],
    title: 'King in the open',
  },
  {
    id: 'p-ladder-finish',
    fen: '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1',
    solution: 'Rb8#',
    rating: 550,
    themes: ['mate'],
    title: 'Two rooks, one plan',
  },
  {
    id: 'p-queen-mate-tech',
    fen: '5k2/8/5K2/8/8/8/8/Q7 w - - 0 1',
    solution: 'Qa8#',
    rating: 350,
    themes: ['mate', 'endgame'],
    title: 'The technique test',
  },
  {
    id: 'p-royal-fork',
    fen: '6k1/3q1p1p/8/3N4/8/8/5PPP/6K1 w - - 0 1',
    solution: 'Nf6+ Kf8 Nxd7+',
    rating: 750,
    themes: ['fork', 'winningMaterial'],
    title: 'The active knight',
  },
  {
    id: 'p-skewer-queen',
    // Rook skewer, engine-verified (scripts/verify-puzzles.ts): Rb1+ is best
    // by a wide margin and every legal reply loses the queen to Rxb8.
    fen: '1q6/8/8/1k6/8/2K5/8/R7 w - - 0 1',
    solution: 'Rb1+ Kc5 Rxb8',
    rating: 550,
    themes: ['skewer', 'winningMaterial'],
    // Title rule: the headline names the scene, never the tactic. "Skewer"
    // in the title would hand the student the answer before move one; the
    // theme tags say it after the solve.
    title: 'Back rank, one file apart',
  },
  {
    id: 'p-pawn-fork-rooks',
    fen: '6k1/8/8/r1r5/8/8/1P3PPP/5RK1 w - - 0 1',
    solution: 'b4 Rc6 bxa5',
    rating: 550,
    themes: ['fork', 'winningMaterial'],
    title: 'Rooks on the loose',
  },
  {
    id: 'p-discovered-double-check',
    fen: 'r3k3/1q3ppp/8/8/4N3/8/PPP2PPP/4R1K1 w - - 0 1',
    solution: 'Nd6+ Kd7 Nxb7',
    rating: 900,
    themes: ['discoveredAttack', 'winningMaterial'],
    title: 'Middlegame tension',
  },
  {
    id: 'p-philidor-smothered',
    fen: '3r3k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1',
    solution: 'Qg8+ Rxg8 Nf7#',
    rating: 1150,
    themes: ['mate', 'sacrifice'],
    title: 'An old classic',
  },
  {
    // The Opera finish, from the position after 15...Nxd7 (Morphy, Duke of
    // Brunswick and Count Isouard, Paris 1858). One ply earlier the defence
    // 15...Ke7! dodges the mate, so the puzzle starts where the queen sac is
    // genuinely forced: Qb8+ Nxb8 is the only legal reply, then Rd8# mates.
    id: 'p-opera-final',
    fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
    solution: 'Qb8+ Nxb8 Rd8#',
    rating: 1400,
    themes: ['mate', 'sacrifice', 'famousGame', 'deflection'],
    title: 'The Opera finish',
    source: 'Morphy, Duke of Brunswick and Count Isouard, Paris 1858',
  },
]

// The served pool: the curated base, the extended verified pack, and the
// real-game master bank mined from actual rated games. The master bank holds
// every puzzle's real-game attribution (source) and crowd-tested rating.
export const PUZZLES: Puzzle[] = [...BASE, ...PUZZLES_PACK, ...MASTER_PUZZLES]

// The label map is client-safe naming, so it lives in the schema module next
// to the public puzzle type; re-exported here for server-side importers.
export { PUZZLE_THEMES } from './schema'
