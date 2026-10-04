// Query the engine for its best lines in a position.
// Usage: bun scripts/best-line.ts "<fen>" [depth] [multiPv]
;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}

const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>
const { Chess } = await import('chess.js')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const fen = process.argv[2]
  const depth = Number(process.argv[3] ?? 16)
  const multiPv = Number(process.argv[4] ?? 3)
  if (!fen) { console.error('usage: bun scripts/best-line.ts "<fen>" [depth] [multiPv]'); process.exit(1) }
  new Chess(fen) // throws if illegal

  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const lines: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  const send = (cmd: string) =>
    (engine.ccall as (...a: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })

  send('uci')
  const t0 = Date.now()
  while (!lines.includes('uciok') && Date.now() - t0 < 60000) await sleep(25)
  send('isready')
  const t1 = Date.now()
  while (!lines.includes('readyok') && Date.now() - t1 < 60000) await sleep(25)

  lines.length = 0
  send(`setoption name MultiPV value ${multiPv}`)
  send(`position fen ${fen}`)
  send(`go depth ${depth}`)
  const t2 = Date.now()
  while (!lines.some((l) => l.startsWith('bestmove')) && Date.now() - t2 < 180000) await sleep(25)
  console.log = origLog
  console.error = origErr

  const game = new Chess(fen)
  const finals = lines.filter((l) => l.startsWith('info') && l.includes(' pv '))
  for (const l of finals) {
    const mp = /multipv (\d+)/.exec(l)
    if (!mp || mp[1] !== '1') continue
  }
  // print the LAST full-depth info per multipv rank
  const lastByRank = new Map<string, string>()
  for (const l of finals) {
    const mp = /multipv (\d+)/.exec(l)
    if (mp) lastByRank.set(mp[1], l)
  }
  for (const [, l] of [...lastByRank.entries()].sort()) {
    const sc = /score (cp|mate) (-?\d+)/.exec(l)
    const pv = / pv (.+)$/.exec(l)
    if (!sc || !pv) continue
    const uciMoves = pv[1].trim().split(' ').slice(0, 8)
    const sans: string[] = []
    const g = new Chess(fen)
    for (const u of uciMoves) {
      try {
        const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined })
        sans.push(m.san)
      } catch { break }
    }
    console.log(`rank ${mp2rank(l)} score ${sc[1]} ${sc[2]} : ${sans.join(' ')}`)
  }
  console.log('raw bestmove:', lines.filter((l) => l.startsWith('bestmove')).pop())
}
function mp2rank(l: string): string {
  const mp = /multipv (\d+)/.exec(l)
  return mp ? mp[1] : '?'
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
