// Candidate batch B: harder puzzles (rating 750-1400) for the Rush pool.
// Every line here is forced and goes through scripts/verify-puzzles.ts.
import type { Puzzle } from '../src/content/schema'

export const CANDIDATES: Puzzle[] = [
  {
    id: 'p-smothered-full',
    fen: '5r1k/6pp/8/6N1/2Q5/8/5PPP/6K1 w - - 0 1',
    solution: 'Nf7+ Kg8 Nh6+ Kh8 Qg8+ Rxg8 Nf7#',
    rating: 1400,
    themes: ['mate', 'sacrifice'],
    title: 'The full smothered mate',
  },
  {
    id: 'p-backrank-loose-rook',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1',
    solution: 'Qxd8#',
    rating: 800,
    themes: ['mate'],
    title: 'The back rank guard was loose',
  },
  {
    id: 'p-black-queen-backrank',
    fen: '3qr1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1',
    solution: 'Qd1#',
    rating: 900,
    themes: ['mate'],
    title: 'Black mates on the first rank',
  },
  {
    id: 'p-queen-loose-take',
    fen: '8/3q4/8/4k3/8/8/8/3R2K1 w - - 0 1',
    solution: 'Rxd7',
    rating: 1000,
    themes: ['winningMaterial'],
    title: 'The queen stepped out alone',
  },
  {
    id: 'p-black-loose-queen',
    fen: '3r2k1/8/8/8/8/8/3Q4/6K1 b - - 0 1',
    solution: 'Rxd2',
    rating: 1000,
    themes: ['winningMaterial'],
    title: 'Black grabs the loose queen',
  },
  {
    id: 'p-remove-guard-mate',
    fen: '5r1k/7p/8/8/8/8/8/5R1K w - - 0 1',
    solution: 'Rxf8#',
    rating: 900,
    themes: ['mate', 'removingDefender'],
    title: 'Remove the guard, mate follows',
  },
  {
    id: 'p-anastasia-real',
    fen: '8/4N1pk/8/8/8/8/6K1/R7 w - - 0 1',
    solution: 'Rh1#',
    rating: 750,
    themes: ['mate'],
    title: 'Anastasia closes the door',
  },
  {
    id: 'p-queen-skewer-a8',
    fen: 'r5k1/8/8/8/8/8/8/3Q2K1 w - - 0 1',
    solution: 'Qd5+ Kg7 Qxa8',
    rating: 950,
    themes: ['skewer', 'winningMaterial'],
    title: 'Check first, loot second',
  },
]
