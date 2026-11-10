// Verify every planned book-level FEN/line with chess.js before shipping.
const { Chess } = require('chess.js')
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
let fails = 0
function t(name, fen, moves, expectMate = false) {
  try {
    const g = new Chess(fen)
    for (const m of moves) {
      const mv = g.move(m)
      if (!mv) throw new Error(`illegal: ${m}`)
    }
    const mate = g.isCheckmate()
    const ok = mate === expectMate
    if (!ok) fails++
    console.log(ok ? 'OK  ' : 'FAIL', name, mate ? '(mate)' : '', moves.join(' '))
  } catch (e) {
    fails++
    console.log('FAIL', name, '::', e.message)
  }
}
function f(name, fen) {
  try { new Chess(fen); console.log('OK  ', name, '(fen)') } catch (e) { fails++; console.log('FAIL', name, '::', e.message) }
}

// nb-hw1: ladder-ish mate in 1 drill
t('nb1-demo-hanging', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'e5', 'Nf3', 'f6', 'Nxe5'])
t('nb1-drill-mate1', '7k/R7/8/8/8/8/8/1R5K w - - 0 1', ['Rb8#'], true)
// nb-hw2: rules demo line
t('nb2-demo-rules', START, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
f('nb2-playout-castle', START)
// nb-hw3: scholar bait + refute
t('nb3-demo-g6', START, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6'])
t('nb3-trap-exists', START, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'], true)
t('nb3-drill-kick', 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1KBNR b KQkq - 3 3', ['g6', 'Qf3', 'Nf6'])
// bg-hw1 royal fork
t('bg1-drill-fork', 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['Nc7+', 'Kd8', 'Nxa8'])
// bg-hw2 pin + skewer
t('bg2-demo-pin', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'])
t('bg2-drill-skewer', '3q4/3k4/8/8/8/8/8/R3K3 w - - 0 1', ['Rd1+', 'Kc7', 'Rxd8'])
// bg-hw3 back rank
t('bg3-demo-backrank', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['Rd8#'], true)
t('bg3-drill-backrank', '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', ['Re8#'], true)
// int-hw1 discovered
t('int1-drill-disc', '2q1k3/8/8/8/4N3/8/8/4RK2 w - - 0 1', ['Nd6+', 'Kd7', 'Nxc8'])
// int-hw2 pin kick
t('int2-drill-kick', 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', ['a6', 'Bxc6', 'bxc6'])
// int-hw3 opposition + K+P playout
f('int3-demo-opp', '8/8/8/4k3/8/8/4K3/8 b - - 0 1')
f('int3-playout-kp', '4k3/8/5K2/4P3/8/8/8/8 w - - 0 1')
// int-hw4 structure marks demo
f('int4-demo-iso', 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3')
// adv-hw1 outpost
t('adv1-drill-outpost', '2r2rk1/pp3ppp/8/8/3P4/5N2/PP3PPP/3R2KR w - - 0 1', ['Ne5'])
// adv-hw3 checks first
t('adv3-drill-mate1', '6k1/5ppp/8/3Q4/8/8/5PPP/4R1K1 w - - 0 1', ['Re8#'], true)
// adv-hw4 legal's mate gtm
t('adv4-gtm-legal', START, ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'], true)
// ms-hw2 initiative: forced mini-line
t('ms2-initiative-line', 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', ['Nc3', 'Bb4', 'O-O'])
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
