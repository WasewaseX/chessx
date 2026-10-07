// Bare FEN evaluations at fixed depth. One question per line, no MultiPV.
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
  send('setoption name MultiPV value 1')

  async function evalFen(label: string, fen: string, depth: number): Promise<void> {
    const start = lines.length
    send('ucinewgame')
    send(`position fen ${fen}`)
    send(`go depth ${depth}`)
    const t = Date.now()
    while (Date.now() - t < 60000) {
      if (lines.slice(start).some((l) => l.startsWith('bestmove'))) break
      await sleep(25)
    }
    const slice = lines.slice(start)
    const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
    const scope = bestIdx >= 0 ? slice.slice(0, bestIdx) : slice
    let found = 'NO INFO'
    for (let i = scope.length - 1; i >= 0; i--) {
      const l = scope[i]
      if (!l.startsWith('info') || !l.includes(' pv ') || l.includes('multipv 2')) continue
      found = l.slice(0, 170)
      break
    }
    origLog(`[${label}] ${found}`)
  }

  const targets: Array<[string, string, number]> = [
    ['gm09-after-Kb1-v2', '8/8/8/8/8/4k3/2P5/1KR5 b - - 0 1', 18],
  ]

  for (const [label, fen, depth] of targets) {
    await evalFen(label, fen, depth)
  }
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
