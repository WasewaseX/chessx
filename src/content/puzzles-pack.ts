// Extended puzzle pack: every position below passed the Stockfish verifier
// (scripts/verify-puzzles.ts): legal replay, engine-best moves, winning finish.
import type { Puzzle } from './schema'

export const PUZZLES_PACK: Puzzle[] = [
  {
    id: 'p-rank-squeeze',
    fen: '6k1/5ppp/6R1/8/8/8/8/1R4K1 w - - 0 1',
    solution: 'Rb8#',
    rating: 450,
    themes: [
      'mate'
    ],
    title: 'Doubled rooks'
  },
  {
    id: 'p-anastasia-pattern',
    fen: '7k/4N1p1/8/8/8/8/8/5KR1 w - - 0 1',
    solution: 'Rh1#',
    rating: 700,
    themes: [
      'mate'
    ],
    title: 'Knight on the seventh'
  },
  {
    id: 'p-queen-box-center',
    fen: '3k4/8/3K4/8/8/8/8/1Q6 w - - 0 1',
    solution: 'Qb8#',
    rating: 400,
    themes: [
      'mate',
      'endgame'
    ],
    title: 'Queen against the king'
  },
  {
    id: 'p-two-rooks-7th',
    fen: '7k/R7/8/8/8/8/8/1R5K w - - 0 1',
    solution: 'Rb8#',
    rating: 500,
    themes: [
      'mate'
    ],
    title: 'Rooks on the seventh'
  },
  {
    id: 'p-damiano-pattern',
    fen: '7k/7p/6P1/8/8/8/7Q/6K1 w - - 0 1',
    solution: 'Qxh7#',
    rating: 550,
    themes: [
      'mate'
    ],
    title: 'Pawn on the sixth'
  },
  {
    id: 'p-black-backrank',
    fen: 'r7/4k3/8/8/8/8/5PPP/6K1 b - - 0 1',
    solution: 'Ra1#',
    rating: 500,
    themes: [
      'mate'
    ],
    title: 'Black acts first'
  },
  {
    id: 'p-single-rook-backrank',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    solution: 'Ra8#',
    rating: 450,
    themes: [
      'mate'
    ],
    title: 'One rook, one task'
  },
  {
    id: 'p-queen-box-corner',
    fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
    solution: 'Qg7#',
    rating: 400,
    themes: [
      'mate',
      'endgame'
    ],
    title: 'Queen and king only'
  },
  {
    id: 'p-family-fork',
    fen: 'r3k3/3p4/8/1N6/8/8/6PP/6K1 w - - 0 1',
    solution: 'Nc7+ Kd8 Nxa8',
    rating: 750,
    themes: [
      'fork',
      'winningMaterial'
    ],
    title: 'The central invader'
  },
  {
    id: 'p-royal-fork-queen',
    fen: '3q1k2/8/8/8/3N4/8/5PPP/6K1 w - - 0 1',
    solution: 'Ne6+ Ke8 Nxd8',
    rating: 800,
    themes: [
      'fork',
      'winningMaterial'
    ],
    title: 'The bold knight'
  },
  {
    id: 'p-black-family-fork',
    fen: '5k2/8/8/8/8/4n3/8/R3K3 b - - 0 1',
    solution: 'Nc2+ Kd2 Nxa1',
    rating: 750,
    themes: [
      'fork',
      'winningMaterial'
    ],
    title: "Black's counterpunch"
  },
  {
    id: 'p-fork-king-knight',
    fen: '3r3k/8/8/6N1/8/8/5PPP/6K1 w - - 0 1',
    solution: 'Nf7+ Kg8 Nxd8',
    rating: 800,
    themes: [
      'fork',
      'winningMaterial'
    ],
    title: 'The high ground'
  },
  {
    id: 'p-black-queen-skewer',
    fen: 'q7/7k/8/8/3K4/8/8/6R1 b - - 0 1',
    solution: 'Qa7+ Kc4 Qxg1',
    rating: 750,
    themes: [
      'skewer',
      'winningMaterial'
    ],
    title: 'Open lines'
  },
  {
    id: 'p-queen-skewer-diagonal',
    fen: '7q/8/8/4k3/8/2P5/5B2/6K1 w - - 0 1',
    solution: 'Bd4+ Kd6 Bxh8',
    rating: 750,
    themes: [
      'skewer',
      'winningMaterial'
    ],
    title: 'The quiet bishop'
  },
  {
    id: 'p-rank-skewer',
    fen: '8/8/8/4k2r/8/8/8/R5K1 w - - 0 1',
    solution: 'Ra5+ Kd6 Rxh5',
    rating: 600,
    themes: [
      'skewer',
      'winningMaterial'
    ],
    title: 'Kings in the open'
  },
  {
    id: 'p-long-diagonal-skewer',
    fen: '8/6r1/8/4k3/8/2P1B3/5PPP/6K1 w - - 0 1',
    solution: 'Bd4+ Ke6 Bxg7',
    rating: 650,
    themes: [
      'skewer',
      'winningMaterial'
    ],
    title: 'The patient bishop'
  },
  {
    id: 'p-bishop-double-strike',
    fen: '7k/8/8/8/8/7P/5PPK/r1B5 w - - 0 1',
    // Kg8 is the engine's best defence; any king move still loses the rook.
    solution: 'Bb2+ Kg8 Bxa1',
    rating: 750,
    themes: [
      'doubleAttack',
      'winningMaterial'
    ],
    title: 'The waiting bishop'
  },
  {
    id: 'p-double-check-queen',
    fen: '3k4/4q3/8/8/3N4/8/8/3R2K1 w - - 0 1',
    solution: 'Nc6+ Ke8 Nxe7',
    rating: 900,
    themes: [
      'discoveredAttack',
      'winningMaterial'
    ],
    title: 'The loose queen'
  },
  {
    id: 'p-promo-mate',
    fen: '7k/5P2/6K1/8/8/8/8/8 w - - 0 1',
    solution: 'f8=Q#',
    rating: 500,
    themes: [
      'promotion',
      'mate',
      'endgame'
    ],
    title: 'One square from glory'
  },
  {
    id: 'p-smothered-full',
    fen: '5r1k/6pp/8/6N1/2Q5/8/5PPP/6K1 w - - 0 1',
    solution: 'Nf7+ Kg8 Nh6+ Kh8 Qg8+ Rxg8 Nf7#',
    rating: 1400,
    themes: [
      'mate',
      'sacrifice'
    ],
    title: 'The classic finish'
  },
  {
    id: 'p-backrank-loose-rook',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1',
    solution: 'Qxd8#',
    rating: 800,
    themes: [
      'mate'
    ],
    title: 'One loose piece'
  },
  {
    id: 'p-black-queen-backrank',
    fen: '3qr1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1',
    solution: 'Qd1#',
    rating: 900,
    themes: [
      'mate'
    ],
    title: 'Heavy artillery'
  },
  {
    id: 'p-queen-loose-take',
    fen: '8/3q4/8/4k3/8/8/8/3R2K1 w - - 0 1',
    solution: 'Rxd7',
    rating: 1000,
    themes: [
      'winningMaterial'
    ],
    title: 'Alone in the open'
  },
  {
    id: 'p-black-loose-queen',
    fen: '3r2k1/8/8/8/8/8/3Q4/6K1 b - - 0 1',
    solution: 'Rxd2',
    rating: 1000,
    themes: [
      'winningMaterial'
    ],
    title: 'Even queens fall'
  },
  {
    id: 'p-remove-guard-mate',
    fen: '5r1k/7p/8/8/8/8/8/5R1K w - - 0 1',
    solution: 'Rxf8+ Kg7',
    rating: 900,
    themes: [
      'removingDefender',
      'winningMaterial'
    ],
    title: 'Two rooks clash'
  },
  {
    id: 'p-anastasia-real',
    fen: '8/4N1pk/8/8/8/8/6K1/R7 w - - 0 1',
    solution: 'Rh1#',
    rating: 750,
    themes: [
      'mate'
    ],
    title: 'Coordinated pieces'
  },
  {
    id: 'p-queen-skewer-a8',
    fen: 'r5k1/8/8/8/8/8/8/3Q2K1 w - - 0 1',
    // Kh7 is the engine's best defence (Kg7 walks into a forced mate).
    solution: 'Qd5+ Kh7 Qxa8',
    rating: 950,
    themes: [
      'skewer',
      'winningMaterial'
    ],
    title: 'The far corner'
  }
]
