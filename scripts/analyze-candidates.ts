// Deep-dive: MultiPV analysis of problem positions.
;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}
const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const lines: string[] = []
  const origLog = console.log.bind(console)
  const origErr = console.error.bind(console)
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  const send = (cmd: string) =>
    (engine.ccall as (...args: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })

  send('uci')
  const t0 = Date.now()
  while (!lines.includes('uciok') && Date.now() - t0 < 60000) await sleep(25)
  send('isready')
  const t1 = Date.now()
  while (!lines.includes('readyok') && Date.now() - t1 < 60000) await sleep(25)

  const targets: Array<[string, string, number]> = [
    ['carlsbad-shipped', 'r1bq1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 8', 3],
    ['carlsbad-symmetric', 'r1bq1rk1/pppnbppp/2p1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 8', 3],
    ['smothered-fixed', '5r1k/5p1p/7N/8/1Q6/8/6PP/6K1 w - - 0 1', 2],
    ['fortress-a', '7k/8/5PP1/8/8/8/6K1/r7 w - - 0 1', 2],
    ['fortress-b', '7k/8/5PP1/7K/8/8/8/r7 w - - 0 1', 2],
    ['fortress-c', '7k/8/5PP1/8/8/8/8/r5K1 w - - 0 1', 2],
    ['gm04-break-fen', '3q1rk1/5p1p/6p1/8/8/8/5PPP/3QR1K1 w - - 0 1', 2],
    ['gm05-structure-fen', 'r2q1rk1/p1p2ppp/2p5/8/8/2P5/PPP2PPP/R1BQ1RK1 w - - 0 9', 2],
    ['fog-fixed', 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2NBPN2/PPP2PPP/R1BQK2R w KQ - 4 6', 2],
    ['majority-b-wincheck', '8/5p2/6k1/8/5P1K/6P1/7P/8 w - - 0 1', 2],
  ]

  for (const [name, fen, mpv] of targets) {
    const start = lines.length
    send(`setoption name MultiPV value ${mpv}`)
    send(`position fen ${fen}`)
    send('go depth 16')
    const t = Date.now()
    while (Date.now() - t < 45000) {
      if (lines.slice(start).some((l) => l.startsWith('bestmove'))) break
      await sleep(25)
    }
    const slice = lines.slice(start)
    const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
    const scope = bestIdx >= 0 ? slice.slice(0, bestIdx) : slice
    const infos = scope.filter((l) => l.startsWith('info') && l.includes(' pv '))
    origLog(`\n=== ${name} ===`)
    for (const l of infos.slice(-mpv)) origLog(l.slice(0, 190))
  }
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
