// Stockfish-backed puzzle verifier. Every candidate puzzle must pass:
//   1. The SAN solution replays legally with chess.js.
//   2. Every solver move is the engine's best move or within CP_LOSS_SOLVER of it.
//   3. Every opponent reply is best defence or within CP_LOSS_OPP of it
//      (if the reply is the only legal move it is automatically the best).
//   4. The final position is winning for the solver (or held, for defense-theme
//      puzzles), or the line ends in checkmate.
// Usage: bun scripts/verify-puzzles.ts [candidate-file.ts]
//   Without an argument it verifies the shipped pool (src/content/puzzles.ts).
// The candidate file must export `CANDIDATES` (Puzzle[]) or a default Puzzle[].

import { Chess } from 'chess.js'
import type { Puzzle } from '../src/content/schema'

;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}

const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>

const DEPTH = Number(process.env.DEPTH ?? 14)
const CP_LOSS_SOLVER = 45
const CP_LOSS_RELAXED = 150
const CP_LOSS_OPP = 120
const FINAL_WIN = 250
const FINAL_WIN_RELAXED = 300
const FINAL_HOLD = -30

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const out = (...a: unknown[]) => console.log(...a)

interface Analysis {
  best: string
  bestScore: number
}

function parseScore(mate: number | null, cp: number | null): number {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100
  return cp ?? 0
}

async function main() {
  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const lines: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }

  const send = (cmd: string) =>
    (engine.ccall as (...args: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })

  async function waitBest(): Promise<void> {
    const t0 = Date.now()
    while (!lines.some((l) => l.startsWith('bestmove')) && Date.now() - t0 < 120000) await sleep(25)
  }

  function latestAnalysis(): Analysis {
    const infos = lines.filter((l) => l.startsWith('info') && l.includes(' pv '))
    // walk from the deepest search back to the deepest RANK 1 line (MultiPV safe)
    for (let i = infos.length - 1; i >= 0; i--) {
      const l = infos[i]
      const mp = /multipv (\d+)/.exec(l)
      if (mp && mp[1] !== '1') continue
      const sc = /score (cp|mate) (-?\d+)/.exec(l)
      const pv = / pv (.+)$/.exec(l)
      if (!sc || !pv) continue
      const mate = sc[1] === 'mate' ? Number(sc[2]) : null
      const cp = sc[1] === 'cp' ? Number(sc[2]) : null
      return { best: pv[1].split(' ')[0], bestScore: parseScore(mate, cp) }
    }
    throw new Error('no analysis output')
  }
  void latestAnalysis

  async function analyze(fen: string, multiPv: number): Promise<Analysis> {
    for (let attempt = 0; attempt < 2; attempt++) {
      // slice point: everything from here belongs to this search (each search
      // ends with exactly one bestmove, so leftovers cannot leak across)
      const start = lines.length
      send(`setoption name MultiPV value ${multiPv}`)
      send(`position fen ${fen}`)
      send(`go depth ${DEPTH}`)
      const t0 = Date.now()
      while (Date.now() - t0 < 60000) {
        const slice = lines.slice(start)
        if (slice.some((l) => l.startsWith('bestmove'))) break
        await sleep(25)
      }
      // parse only this search's output, deepest rank-1 info line before bestmove
      const slice = lines.slice(start)
      const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
      const scope = bestIdx >= 0 ? slice.slice(0, bestIdx) : slice
      for (let i = scope.length - 1; i >= 0; i--) {
        const l = scope[i]
        const mp = /multipv (\d+)/.exec(l)
        if (mp && mp[1] !== '1') continue
        const sc = /score (cp|mate) (-?\d+)/.exec(l)
        const pv = / pv (.+)$/.exec(l)
        if (!sc || !pv) continue
        const mate = sc[1] === 'mate' ? Number(sc[2]) : null
        const cp = sc[1] === 'cp' ? Number(sc[2]) : null
        return { best: pv[1].split(' ')[0], bestScore: parseScore(mate, cp) }
      }
      // search got stuck or silent: unstick, let leftovers flush, then retry
      send('stop')
      await sleep(600)
    }
    throw new Error('no analysis output')
  }

  // startup handshake
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
  console.log = origLog
  console.error = origErr

  // load puzzles
  const argFile = process.argv[2]
  let puzzles: Puzzle[]
  if (argFile) {
    const mod = await import(new URL(argFile, import.meta.url).href)
    puzzles = (mod.CANDIDATES ?? mod.default) as Puzzle[]
  } else {
    const mod = await import(new URL('../src/content/puzzles.ts', import.meta.url).href)
    puzzles = mod.PUZZLES as Puzzle[]
  }
  out(`Verifying ${puzzles.length} puzzles at depth ${DEPTH}`)
  // capture engine output again for the analysis loop
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }

  const failures: string[] = []
  let passed = 0

  for (const p of puzzles) {
    const problems: string[] = []
    try {
      const game = new Chess(p.fen)
      const solverWhite = game.turn() === 'w'
      if (game.isCheck()) {
        problems.push('position starts in check')
      }
      const moves = p.solution.trim().split(/\s+/)
      const relaxed = p.themes.includes('famousGame') || p.themes.includes('sacrifice')
      const solverBudget = relaxed ? CP_LOSS_RELAXED : CP_LOSS_SOLVER
      const finalFloor = relaxed ? FINAL_WIN_RELAXED : p.themes.includes('defense') ? FINAL_HOLD : FINAL_WIN

      // score of the position now, from the side to move's POV
      const scoreNow = async (g: Chess): Promise<number> => {
        if (g.isCheckmate()) return -100000
        if (g.isStalemate() || g.isDraw()) return 0
        const a = await analyze(g.fen(), 2)
        return a.bestScore
      }

      let pre = await analyze(p.fen, 3)
      for (let i = 0; i < moves.length; i++) {
        const moverIsSolver = i % 2 === 0
        const mv = game.move(moves[i])
        const uci = mv.from + mv.to + (mv.promotion ?? '')
        const moverScoreAfter = -await scoreNow(game)
        if (uci !== pre.best) {
          const loss = pre.bestScore - moverScoreAfter
          const budget = moverIsSolver ? solverBudget : CP_LOSS_OPP
          const tag = moverIsSolver ? 'solver' : 'opponent'
          if (loss > budget) {
            problems.push(`move ${i + 1} (${tag}) ${moves[i]} loses ${Math.round(loss)}cp vs best ${pre.best}`)
          }
        }
        if (i < moves.length - 1) pre = await analyze(game.fen(), 2)
      }

      if (!game.isCheckmate() && !game.isStalemate() && !game.isDraw()) {
        const fin = await analyze(game.fen(), 1)
        const solverAtEnd = (game.turn() === 'w') === solverWhite
        const solverFinal = solverAtEnd ? fin.bestScore : -fin.bestScore
        if (solverFinal < finalFloor) {
          problems.push(`final eval ${Math.round(solverFinal)}cp for solver, needs >= ${Math.round(finalFloor)}`)
        }
      }
    } catch (e) {
      problems.push(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (problems.length === 0) {
      passed++
      origLog(`PASS ${p.id} (${p.rating})`)
    } else {
      failures.push(`${p.id}: ${problems.join(' | ')}`)
      origLog(`FAIL ${p.id}: ${problems.join(' | ')}`)
    }
  }

  console.log = origLog
  console.error = origErr
  out(`\n${passed}/${puzzles.length} passed, ${failures.length} failed`)
  if (failures.length) {
    out('Failures:')
    for (const f of failures) out('  ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
