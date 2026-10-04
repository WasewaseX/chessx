import type { Puzzle } from './schema'
import { PUZZLES_PACK } from './puzzles-pack'

// Base pack: hand-verified positions used across lessons and the daily pool.
// The extended pack lives in puzzles-pack.ts and is validated the same way.
const BASE: Puzzle[] = [
  {
    id: 'p-backrank-guard',
    fen: '6k1/5p1p/6p1/8/8/8/1B3PPP/R5K1 w - - 0 1',
    solution: 'Ra8#',
    rating: 450,
    themes: ['mate'],
    title: 'Last rank',
  },
  {
    id: 'p-corner-knight',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    solution: 'Nf7#',
    rating: 500,
    themes: ['mate'],
    title: 'Cornered',
  },
  {
    id: 'p-arabian',
    fen: '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1',
    solution: 'Rh7#',
    rating: 600,
    themes: ['mate'],
    title: 'The Arabian mate',
  },
  {
    id: 'p-corridor',
    fen: '3k4/3p4/1P3P2/8/8/8/8/R5K1 w - - 0 1',
    solution: 'Ra8#',
    rating: 450,
    themes: ['mate'],
    title: 'The corridor',
  },
  {
    id: 'p-ladder-finish',
    fen: '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1',
    solution: 'Rb8#',
    rating: 550,
    themes: ['mate'],
    title: 'The ladder finishes',
  },
  {
    id: 'p-queen-mate-tech',
    fen: '5k2/8/5K2/8/8/8/8/Q7 w - - 0 1',
    solution: 'Qa8#',
    rating: 350,
    themes: ['mate', 'endgame'],
    title: 'Queen mate technique',
  },
  {
    id: 'p-royal-fork',
    fen: '6k1/3q1p1p/8/3N4/8/8/5PPP/6K1 w - - 0 1',
    solution: 'Nf6+ Kf8 Nxd7+',
    rating: 750,
    themes: ['fork', 'winningMaterial'],
    title: 'Royal fork',
  },
  {
    id: 'p-skewer-queen',
    fen: '1q6/p1k5/8/8/8/4B3/5PPP/6K1 w - - 0 1',
    solution: 'Bf4+ Kd7 Bxb8',
    rating: 700,
    themes: ['skewer', 'winningMaterial'],
    title: 'Through the king',
  },
  {
    id: 'p-pawn-fork-rooks',
    fen: '6k1/8/8/r1r5/8/8/1P3PPP/5RK1 w - - 0 1',
    solution: 'b4 Rc6 bxa5',
    rating: 550,
    themes: ['fork', 'winningMaterial'],
    title: 'Forked by a pawn',
  },
  {
    id: 'p-discovered-double-check',
    fen: 'r3k3/1q3ppp/8/8/4N3/8/PPP2PPP/4R1K1 w - - 0 1',
    solution: 'Nd6+ Kd7 Nxb7',
    rating: 900,
    themes: ['discoveredAttack', 'winningMaterial'],
    title: 'The moving screen',
  },
  {
    id: 'p-philidor-smothered',
    fen: '3r3k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1',
    solution: 'Qg8+ Rxg8 Nf7#',
    rating: 1150,
    themes: ['mate', 'sacrifice'],
    title: 'The smothered finish',
  },
  {
    id: 'p-opera-final',
    fen: '4kb1r/p2r1ppp/4qn2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 w - - 1 15',
    solution: 'Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#',
    rating: 1400,
    themes: ['mate', 'sacrifice', 'famousGame', 'deflection'],
    title: 'The Opera finish',
    source: 'Morphy – Duke of Brunswick & Count Isouard, Paris 1858',
  },
]

export const PUZZLES: Puzzle[] = [...BASE, ...PUZZLES_PACK]

export const PUZZLE_THEMES: Record<string, string> = {
  mate: 'Mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  doubleAttack: 'Double attack',
  removingDefender: 'Removing the defender',
  promotion: 'Promotion',
  endgame: 'Endgame',
  winningMaterial: 'Winning material',
  sacrifice: 'Sacrifice',
  defense: 'Defense',
  famousGame: 'Famous game',
}
