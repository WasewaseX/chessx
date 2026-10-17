// Bank line repair: for every master-bank puzzle whose stored solution drifts
// from engine best play (a soft opponent defence the verifier flags), re-cut
// the line: keep the stored solver moves while they stay engine-best, then
// continue from the first divergence with BOTH sides playing engine-best until
// mate or a decisive win. The repaired solution is written back into
// src/content/master-puzzles.ts (id-keyed block replacement).
// Usage: bun scripts/repair-bank-lines.ts <id1> <id2> ...
//   With no ids it reads "id: ..." failure lines from stdin.

import { Chess } from 'chess.js'
import type { Puzzle } from '../src/content/schema'
import { MASTER_PUZZLES } from '../src/content/master-puzzles'

;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}

const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>

const DEPTH = Number(process.env.DEPTH ?? 12)
const MAX_TAIL_PLIES = 16
const FINAL_WIN = 250

interface Analysis {
  best: string
  bestScore: number // side-to-move POV, centipawns (mate = huge)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const origLog = console.log.bind(console)

function parseScore(mate: number | null, cp: number | null): number {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100
  return cp ?? 0
}

async function main() {
  const args = process.argv.slice(2)
  let ids: string[]
  if (args.length) {
    ids = args
  } else {
    const text = await new Promise<string>((res) => {
      let buf = ''
      process.stdin.on('data', (d) => (buf += String(d)))
      process.stdin.on('end', () => res(buf))
    })
    ids = [...text.matchAll(/^(m-[0-9a-z]+):/gm)].map((m) => m[1])
  }
  const origLog = console.log.bind(console)
  if (!ids.length) {
    origLog('no ids to repair')
    return
  }
  origLog(`repairing ${ids.length} bank lines at depth ${DEPTH}`)

  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const lines: string[] = []
  const origErr = console.error
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  const send = (cmd: string) =>
    (engine.ccall as (...args: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })

  send('uci')
  {
    const t0 = Date.now()
    while (!lines.includes('uciok') && Date.now() - t0 < 60000) await sleep(25)
  }
  send('isready')
  {
    const t0 = Date.now()
    while (!lines.includes('readyok') && Date.now() - t0 < 60000) await sleep(25)
  }
  // console.log stays captured for the whole engine phase: the single-file
  // WASM build reports UCI lines through console.log, so restoring it early
  // would send every search's output to stdout instead of the parser.

  async function analyze(fen: string): Promise<Analysis> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = lines.length
      send(`position fen ${fen}`)
      send(`go depth ${DEPTH}`)
      const t0 = Date.now()
      while (Date.now() - t0 < 60000) {
        const slice = lines.slice(start)
        if (slice.some((l) => l.startsWith('bestmove'))) break
        await sleep(25)
      }
      const slice = lines.slice(start)
      const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
      const scope = bestIdx >= 0 ? slice.slice(0, bestIdx) : slice
      for (let i = scope.length - 1; i >= 0; i--) {
        const l = scope[i]
        const sc = /score (cp|mate) (-?\d+)/.exec(l)
        const pv = / pv (.+)$/.exec(l)
        if (!sc || !pv || l.includes('multipv 2')) continue
        const mate = sc[1] === 'mate' ? Number(sc[2]) : null
        const cp = sc[1] === 'cp' ? Number(sc[2]) : null
        return { best: pv[1].split(' ')[0], bestScore: parseScore(mate, cp) }
      }
      send('stop')
      await sleep(600)
    }
    throw new Error('no analysis output')
  }

  const uciToSan = (g: Chess, uci: string) => {
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
    if (!mv) throw new Error(`engine move ${uci} illegal in replay`)
    return mv.san
  }

  const bank = new Map<string, (typeof MASTER_PUZZLES)[number]>(MASTER_PUZZLES.map((p) => [p.id, p]))
  const repairs: { id: string; solution: string; mateEnd: boolean }[] = []
  const skipped: string[] = []

  for (const id of ids) {
    const p = bank.get(id)
    if (!p) {
      skipped.push(id)
      continue
    }
    try {
      const g = new Chess(p.fen)
      const sans: string[] = []
      let tailStartIdx = p.solution.trim().split(/\s+/).length // default: keep whole stored line
      let broke = false
      // Walk the stored line; the moment a move is not engine-best (either
      // side), stop keeping the stored moves and continue with best play.
      for (const san of p.solution.trim().split(/\s+/)) {
        const a = await analyze(g.fen())
        const probe = new Chess(g.fen())
        const mv = probe.move(san)
        if (!mv) throw new Error(`stored move ${san} illegal`)
        const uci = mv.from + mv.to + (mv.promotion ?? '')
        if (uci !== a.best) {
          broke = true
          break
        }
        g.move(san)
        sans.push(mv.san)
        if (g.isGameOver()) break
      }
      if (!broke) {
        origLog(`${id}: stored line already best play — no repair needed`)
        continue
      }
      // Continue from here with both sides playing the engine's best move.
      let plies = 0
      while (!g.isGameOver() && plies < MAX_TAIL_PLIES) {
        const a = await analyze(g.fen())
        sans.push(uciToSan(g, a.best))
        plies++
        if (Math.abs(a.bestScore) >= 100000) break // mate found
      }
      if (g.isCheckmate()) {
        // trim any trailing non-mate slack is impossible: mate is the end
      }
      // sanity: the solver (original side to move) must not end up worse
      const solverWhite = new Chess(p.fen).turn() === 'w'
      const finalFen = g.fen()
      const endG = new Chess(finalFen)
      const solverIsMated =
        endG.isCheckmate() && (endG.turn() === 'w') === solverWhite
      if (endG.isCheckmate() && solverIsMated) {
        skipped.push(`${id}: repair reached the wrong mate`)
        continue
      }
      if (!endG.isCheckmate()) {
        const fin = await analyze(endG.fen())
        const solverToMove = (endG.turn() === 'w') === solverWhite
        const solverFinal = solverToMove ? fin.bestScore : -fin.bestScore
        if (solverFinal < FINAL_WIN) {
          skipped.push(`${id}: repaired tail only ${Math.round(solverFinal)}cp — needs a human look`)
          continue
        }
      }
      repairs.push({ id, solution: sans.join(' '), mateEnd: endG.isCheckmate() })
      origLog(`${id}: repaired -> ${sans.join(' ')}`)
    } catch (e) {
      skipped.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log = origLog
  if (repairs.length) {
    const path = 'src/content/master-puzzles.ts'
    let text = await Bun.file(path).text()
    for (const r of repairs) {
      // replace the solution and mateEnd lines inside this id's block
      const blockRe = new RegExp(
        `(id: '${r.id}',[\\s\\S]*?solution: ')([^']*)('\\s*,[\\s\\S]*?mateEnd: )(true|false)`,
      )
      if (!blockRe.test(text)) {
        origLog(`${r.id}: block not found in master-puzzles.ts, skipped`)
        continue
      }
      text = text.replace(blockRe, (_m, a, _oldSol, b, _oldMate) => `${a}${r.solution}'${b}${r.mateEnd}`)
      origLog(`${r.id}: written into bank`)
    }
    await Bun.write(path, text)
    origLog(`bank updated: ${repairs.length} line(s)`)
  }
  if (skipped.length) origLog(`skipped: ${skipped.join(' | ')}`)
  origLog('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
