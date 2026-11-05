// scratch: verify FEN facts + draft book mainlines legality
import { Chess } from 'chess.js'

const opera = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16'
const forced = '5k2/8/8/8/8/7q/8/R6K w - - 0 1'
const mate = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'
const italian = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 4'

for (const [name, fen] of [['opera', opera], ['forced', forced], ['mate', mate], ['italian', italian]] as const) {
  const g = new Chess(fen)
  console.log(name, 'legalMoveCount =', g.moves().length)
}

// Opera: verify Qb8+ is legal, Nxb8 is the only capture of the queen, and mate follows
{
  const g = new Chess(opera)
  const mv = g.move('Qb8+')
  console.log('opera Qb8+ ok:', mv?.san, 'flags:', mv?.flags, 'in checkmate now:', g.isCheckmate(), 'black replies:', g.moves().length, JSON.stringify(g.moves()))
  const r = new Chess(opera)
  r.move('Qb8+')
  const replies = r.moves({ verbose: true })
  const take = replies.filter((m) => m.to === 'b8')
  console.log('replies capturing b8:', take.map((m) => m.san).join(','))
}

// mainline legality check
const LINES: [string, string][] = [
  ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O'],
  ['Italian', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Nbd2'],
  ['Scotch', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6'],
  ['Petrov', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6 c4'],
  ['Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be7 f3 O-O Qd2 Nbd7'],
  ['Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Be2 Nf6 O-O Bb4'],
  ['Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5'],
  ['French Winawer', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8'],
  ['French Classical', 'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3'],
  ['Caro-Kann', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7'],
  ['Scandinavian', 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6'],
  ['QGD', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4'],
  ['Slav', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7'],
  ['QGA', 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Qe2 b5 Bb3 Bb7'],
  ['KID', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7'],
  ['Nimzo', 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O dxc4 Bxc4'],
  ['London', 'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3'],
  ['English', 'c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6 O-O Be7'],
  ['Grünfeld', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Bc4 c5 Ne2 Nc6'],
  ['Vienna', 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3 f5'],
  ['Réti', 'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6'],
  ['Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6'],
  ['Pirc', 'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O Nc6'],
  ['QID', 'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O Nc3 Ne4'],
  ['Two Knights', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6'],
  ['Four Knights', 'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bxc6 bxc6'],
  ['Rossolimo', 'e4 c5 Nf3 Nc6 Bb5 g6 O-O Bg7 Re1 Nf6 c3 O-O d4'],
  ["King's Gambit", 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5'],
  ['Dutch', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6'],
  ['Alekhine', 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bf5 Be2 e6'],
]
let bad = 0
for (const [name, line] of LINES) {
  try {
    const g = new Chess()
    for (const san of line.split(/\s+/)) g.move(san)
  } catch (e) {
    bad++
    console.log('ILLEGAL in', name, '->', (e as Error).message)
  }
}
console.log(`mainlines: ${LINES.length} lines, ${bad} illegal`)

// book table probe: position after e4 e5 Nf3 Nc6 -> Bb5 in table?
{
  const g = new Chess()
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) g.move(san)
  console.log('fen after 4 plies:', g.fen())
  console.log('positionKey:', g.fen().split(' ').slice(0, 4).join(' '))
}
