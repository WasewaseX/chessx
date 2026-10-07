// Candidate drills, round 4.
import type { Puzzle } from '../src/content/schema'

export const CANDIDATES: Puzzle[] = [
  { id: 'gm-19-upgrade', fen: '2r3k1/5ppp/8/8/8/8/1q1R4/3R2K1 w - - 0 1', solution: 'Rd8+ Rxd8 Rxd8#', rating: 1800, themes: ['mate'], title: 'gm-19 deflection finish' },
  { id: 'gm-05-demo-fen', fen: '2r1k3/8/8/8/2P5/2P5/1P6/2KR4 w - - 0 1', solution: 'c4', rating: 1400, themes: ['defense'], title: 'gm-05 demo doubles' },
  { id: 'gm16-fog-fixed', fen: 'r1bqkb1r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQKB1R w KQkq - 4 6', solution: 'Nf3', rating: 1800, themes: ['defense'], title: 'gm-16 fog fixed (playout fen)' },
]
