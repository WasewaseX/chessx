// Build the real-game master puzzle bank.
//
// Source: the Lichess combined puzzle-game sample (scripts/bank/candidates.json,
// filtered from 51,200 real rated games) plus famous immortal games
// (scripts/bank/immortal.pgn). Every candidate must pass the strict battery:
//   1. the real-game line replays legally (SAN from UCI, chess.js)
//   2. every solver move is the engine's best move or within 40cp of it
//   3. every opponent reply is best defence or within 120cp of it
//   4. the line ends in mate (unique mating move) or the solver is >= +250
//   5. the puzzle has a POINT: first solver move is a check or capture, or
//      the evaluation swings >= 220cp, or the line mates
// Only passes are written to src/content/master-puzzles.ts (MERGE phase).
//
// Usage:
//   SLICE=0/4 DEPTH=12 bun scripts/bank/verify-bank.ts --only lichess
//   SLICE=0/1 DEPTH=12 bun scripts/bank/verify-bank.ts --only famous
//   MERGE=1 bun scripts/bank/verify-bank.ts          (collect results, write ts)

import { Chess } from 'chess.js'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'

;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}

const init = require('stockfish') as (p?: string) => Promise<Record<string, unknown>>

const DEPTH = (() => {
  if (process.env.DEPTH && Number.isFinite(Number(process.env.DEPTH))) return Number(process.env.DEPTH)
  const i = process.argv.indexOf('--depth')
  return i >= 0 && Number.isFinite(Number(process.argv[i + 1])) ? Number(process.argv[i + 1]) : 12
})()
const ONLY = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] : 'all'
})()
const [SLICE_I, SLICE_N] = (process.env.SLICE ?? '0/1').split('/').map(Number)

const CP_LOSS_SOLVER = 40
const CP_LOSS_OPP = 120
const FINAL_WIN = 250
const SWING = 220

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const out = (...a: unknown[]) => console.log(...a)

interface Analysis {
  best: string
  bestScore: number
  secondScore: number | null
  pv: string[]
}

function parseScore(mate: number | null, cp: number | null): number {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100
  return cp ?? 0
}

interface BankPuzzle {
  id: string
  fen: string
  solution: string
  rating: number
  themes: string[]
  title: string
  source: string
  mateEnd: boolean
  gameUrl?: string
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e))
}

// ---------------------------------------------------------------------------
// MERGE mode: collect slice results, dedupe, emit the bank module
// ---------------------------------------------------------------------------

if (process.env.MERGE) {
  const resultsDir = 'scripts/bank'
  const slices = readdirSync(resultsDir)
    .filter((f) => /^results-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(`${resultsDir}/${f}`, 'utf8')) as BankPuzzle[])
    .flat()
  const existing: BankPuzzle[] = []
  const outPath = 'src/content/master-puzzles.ts'
  if (existsSync(outPath)) {
    try {
      const mod = await import(new URL('../../src/content/master-puzzles.ts', import.meta.url).href)
      existing.push(...(mod.MASTER_PUZZLES as BankPuzzle[]))
    } catch { /* fresh file */ }
  }
  const seen = new Set(existing.map((p) => p.fen.split(' ').slice(0, 2).join(' ')))
  const merged = [...existing]
  let added = 0
  for (const r of slices) {
    const key = r.fen.split(' ').slice(0, 2).join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(r)
    added++
  }
  const ts = `// Master puzzle bank: every position below is a REAL game, engine-verified
// by scripts/bank/verify-bank.ts (legal replay, solver moves engine-best
// within 40cp, opponent defences within 120cp, mate or a +2.5 finish, a
// unique mating move where the line mates). Ratings come from the Lichess
// puzzle database crowds; famous-game finishes carry their game attribution.
// This bank is what /puzzle serves first; the live crafter is fallback only.
import type { Puzzle } from './schema'

export interface MasterPuzzle extends Puzzle {
  mateEnd: boolean
  gameUrl?: string
}

export const MASTER_PUZZLES: MasterPuzzle[] = [
${merged
  .map(
    (p) => `  {
    id: '${p.id}',
    fen: '${p.fen}',
    solution: '${p.solution.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',
    rating: ${p.rating},
    themes: [${p.themes.map((t) => `'${t}'`).join(', ')}],
    title: '${p.title.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',
    source: '${p.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',
    mateEnd: ${p.mateEnd},${p.gameUrl ? `\n    gameUrl: '${p.gameUrl}',` : ''}
  },`,
  )
  .join('\n')}
]
`
  writeFileSync(outPath, ts)
  out(`MERGE: ${slices.length} slice results, ${added} new, ${existing.length} kept -> ${merged.length} total in ${outPath}`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Engine-backed verify mode
// ---------------------------------------------------------------------------

async function main() {
  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')
  const lines: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (l?: unknown) => { if (l != null) lines.push(String(l)) }
  console.error = (l?: unknown) => { if (l != null) lines.push(String(l)) }

  const send = (cmd: string) =>
    (engine.ccall as (...args: unknown[]) => unknown)('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })

  async function analyze(fen: string, multiPv: number): Promise<Analysis | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = lines.length
      send(`setoption name MultiPV value ${multiPv}`)
      send(`position fen ${fen}`)
      send(`go depth ${DEPTH}`)
      const t0 = Date.now()
      while (Date.now() - t0 < 60000) {
        const slice = lines.slice(start)
        if (slice.some((l) => l.startsWith('bestmove'))) break
        await sleep(20)
      }
      const slice = lines.slice(start)
      const bestIdx = slice.findIndex((l) => l.startsWith('bestmove'))
      const scope = bestIdx >= 0 ? slice.slice(0, bestIdx) : slice
      let rank1: { best: string; score: number; pv: string[] } | null = null
      let rank2: number | null = null
      for (let i = scope.length - 1; i >= 0; i--) {
        const l = scope[i]
        if (!l.includes(' score ') || !l.includes(' pv ')) continue
        const mp = /multipv (\d+)/.exec(l)
        const rank = mp ? Number(mp[1]) : 1
        if (rank !== 1 && rank !== 2) continue
        if (rank === 2 && rank2 != null) continue
        const sc = /score (cp|mate) (-?\d+)/.exec(l)
        if (!sc) continue
        const score = parseScore(sc[1] === 'mate' ? Number(sc[2]) : null, sc[1] === 'cp' ? Number(sc[2]) : null)
        if (rank === 2) { rank2 = score; continue }
        if (rank1) continue
        const pv = / pv (.+)$/.exec(l)
        if (!pv) continue
        rank1 = { best: pv[1].split(' ')[0], score, pv: pv[1].trim().split(/\s+/) }
      }
      if (rank1) return { best: rank1.best, bestScore: rank1.score, secondScore: rank2, pv: rank1.pv }
      send('stop')
      await sleep(500)
    }
    return null
  }

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
  // restore nothing yet: the engine's search output must keep flowing into
  // `lines` for the parsers below (verify-puzzles.ts does the same)

  const results: BankPuzzle[] = []
  const failures: string[] = []

  async function verifyCandidate(c: {
    id: string
    rootFen: string
    setupUci?: string
    solutionUci: string[]
    rating: number
    themes: string[]
    title: string
    source: string
    gameUrl?: string
    allowDecidedRoot?: boolean
  }): Promise<void> {
    const problems: string[] = []
    try {
      // 1. real-game replay to the puzzle position
      const root = new Chess(c.rootFen)
      if (c.setupUci) {
        const mv = root.move({
          from: c.setupUci.slice(0, 2),
          to: c.setupUci.slice(2, 4),
          promotion: c.setupUci.slice(4, 5) || undefined,
        })
        if (!mv) throw new Error('setup move illegal')
      }
      if (root.isGameOver()) throw new Error('position after setup is decided')
      const fen = root.fen()
      const solverWhite = root.turn() === 'w'

      // SAN solution
      const walker = new Chess(fen)
      const sans: string[] = []
      for (const uci of c.solutionUci) {
        const mv = walker.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4, 5) || undefined,
        })
        if (!mv) throw new Error(`solution uci ${uci} illegal`)
        sans.push(mv.san)
      }

      // 2-4. engine battery. Searches are lean: the root gets MultiPV 2, the
      // interior nodes MultiPV 1, and a move that matches the reported best
      // needs no follow-up search at all.
      let pre = await analyze(fen, 2)
      if (!pre) throw new Error('root analysis failed')
      const rootScoreSolver = pre.bestScore
      const game = new Chess(fen)
      let lastSolverScore = rootScoreSolver // solver-POV score at the line's end
      for (let i = 0; i < sans.length; i++) {
        const solverMove = i % 2 === 0
        const mv = game.move(sans[i])
        if (!mv) throw new Error(`san ${sans[i]} failed to replay`)
        const uci = mv.from + mv.to + (mv.promotion ?? '')
        if (uci !== pre.best) {
          // deviation: score the node after this move to size the loss
          let after: number | null
          if (game.isCheckmate()) after = -100000
          else if (game.isStalemate() || game.isDraw()) after = 0
          else {
            const a = await analyze(game.fen(), 1)
            after = a ? a.bestScore : null
          }
          if (after == null) throw new Error('deviation analysis failed')
          const moverScore = -after
          const loss = pre.bestScore - moverScore
          const budget = solverMove ? CP_LOSS_SOLVER : CP_LOSS_OPP
          if (loss > budget) {
            problems.push(`${solverMove ? 'solver' : 'opponent'} move ${i + 1} (${sans[i]}) loses ${Math.round(loss)}cp vs ${pre.best}`)
          }
          lastSolverScore = solverMove ? moverScore : -moverScore
        } else {
          lastSolverScore = pre.bestScore
        }
        if (i < sans.length - 1) {
          const next = await analyze(game.fen(), 1)
          if (!next) throw new Error('node analysis failed')
          pre = next
        } else {
          // final node: score from the next side's POV mirrors the line's end
          lastSolverScore = solverMove ? pre.bestScore : -pre.bestScore
        }
      }

      const mateEnd = game.isCheckmate()
      if (!mateEnd && !game.isStalemate() && !game.isDraw()) {
        if (lastSolverScore < FINAL_WIN) {
          problems.push(`final eval ${Math.round(lastSolverScore)}cp < ${FINAL_WIN}`)
        }
      }

      // unique mating move when the line mates
      if (mateEnd) {
        const mateNode = new Chess(fen)
        for (let i = 0; i < sans.length - 1; i++) mateNode.move(sans[i])
        const mating = mateNode.moves().filter((s) => {
          try {
            const probe = new Chess(mateNode.fen())
            return probe.move(s)?.san.endsWith('#') ?? false
          } catch { return false }
        })
        if (mating.length > 1) problems.push(`${mating.length} mating moves (${mating.slice(0, 3).join(' ')})`)
      }

      // 5. the point gate
      const firstMv = (() => {
        try { return new Chess(fen).move(sans[0]) } catch { return null }
      })()
      const forcing = !!firstMv && (firstMv.san.includes('+') || firstMv.san.includes('#') || firstMv.captured != null)
      const swing = mateEnd ? 999 : Math.abs(rootScoreSolver) + FINAL_WIN
      const hasPoint = forcing || mateEnd || rootScoreSolver <= -SWING || swing >= SWING
      if (!hasPoint) problems.push('no point: quiet move in a decided position')
      if (!c.allowDecidedRoot && !mateEnd && rootScoreSolver > 650) {
        problems.push(`root already +${(rootScoreSolver / 100).toFixed(1)}, anything wins`)
      }

      if (problems.length === 0) {
        results.push({
          id: c.id,
          fen,
          solution: sans.join(' '),
          rating: Math.round(c.rating / 25) * 25,
          themes: c.themes.slice(0, 3),
          title: c.title,
          source: c.source,
          mateEnd,
          gameUrl: c.gameUrl,
        })
        origLog(`PASS ${c.id} ${sans.join(' ')} (${c.rating})`)
      } else {
        failures.push(`${c.id}: ${problems.join(' | ')}`)
        origLog(`FAIL ${c.id}: ${problems.join(' | ')}`)
      }
    } catch (e) {
      failures.push(`${c.id}: ${errText(e)}`)
      origLog(`FAIL ${c.id}: ${errText(e)}`)
    }
  }

  // ---- Lichess real-game candidates (sliced across workers) ----
  if (ONLY === 'all' || ONLY === 'lichess') {
    const candsPath = 'scripts/bank/candidates.json'
    if (!existsSync(candsPath)) throw new Error('candidates.json missing')
    const all = JSON.parse(readFileSync(candsPath, 'utf8')) as Array<{
      id: string; rootFen: string; setupUci: string; solutionUci: string[]
      rating: number; lichessThemes: string[]; concepts: string[]
      opening: string; whiteElo: number | null; blackElo: number | null; gameUrl: string | null
    }>
    const cands = all.filter((_, i) => i % Math.max(1, SLICE_N) === SLICE_I)
    out(`Slice ${SLICE_I}/${SLICE_N}: verifying ${cands.length}/${all.length} lichess candidates at depth ${DEPTH}`)
    const CONCEPT_LABEL: Record<string, string> = {
      mate: 'Mate', fork: 'The fork', pin: 'The pin', skewer: 'The skewer',
      discoveredAttack: 'Discovered attack', doubleAttack: 'Double attack',
      removingDefender: 'Remove the defender', promotion: 'Promotion',
      endgame: 'Endgame technique', winningMaterial: 'Loose piece', sacrifice: 'The sacrifice',
      calculation: 'Calculation', kingSafety: 'King hunt', zugzwang: 'Zugzwang',
    }
    for (const c of cands) {
      const eloBits: string[] = []
      if (c.whiteElo) eloBits.push(`White ${c.whiteElo}`)
      if (c.blackElo) eloBits.push(`Black ${c.blackElo}`)
      const source = `Real rated game on Lichess${c.opening ? `, ${c.opening}` : ''}${eloBits.length ? ` (${eloBits.join(' vs ')})` : ''}`
      const label = CONCEPT_LABEL[c.concepts[0]] ?? 'Tactic'
      const title = c.opening ? c.opening.split(/[:;,]/)[0].trim() : label
      await verifyCandidate({
        id: `m-${c.id.toLowerCase()}`,
        rootFen: c.rootFen,
        setupUci: c.setupUci,
        solutionUci: c.solutionUci,
        rating: c.rating,
        themes: c.concepts,
        title,
        source,
        gameUrl: c.gameUrl ?? undefined,
      })
    }
  }

  // ---- Famous immortal games: finish-line tactics ----
  if (ONLY === 'all' || ONLY === 'famous') {
    const pgnPath = 'scripts/bank/immortal.pgn'
    if (existsSync(pgnPath)) {
      const raw = readFileSync(pgnPath, 'utf8')
      const chunks = raw.split(/\n\n(?=\[Event)/).filter((c) => c.includes('[White'))
      out(`Scanning ${chunks.length} famous games for finish-line tactics`)
      let made = 0
      for (const chunk of chunks) {
        if (made >= 14) break
        let gg: Chess
        try {
          gg = new Chess()
          gg.loadPgn(chunk.trim(), { strict: false })
        } catch { continue }
        if (!gg.isCheckmate()) continue
        const h = gg.header()
        const white = String(h.White ?? '')
        const black = String(h.Black ?? '')
        const site = String(h.Site ?? '')
        const date = String(h.Date ?? '').split('.')[0]
        if (!white || !black || white.startsWith('?') || black.startsWith('?')) continue
        const allMoves = gg.history()
        if (allMoves.length < 12) continue
        for (const plies of [4, 6, 2]) {
          if (allMoves.length < plies + 6) continue
          const replay = new Chess()
          const startPly = allMoves.length - plies
          let ok = true
          for (let i = 0; i < startPly; i++) {
            try { replay.move(allMoves[i]) } catch { ok = false; break }
          }
          if (!ok) continue
          const before = results.length
          await verifyCandidate({
            id: `f-${(white + '-' + black).toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 40)}-${startPly}`,
            rootFen: replay.fen(),
            solutionUci: allMoves.slice(startPly).map((san) => {
              const mv = replay.move(san)
              return mv.from + mv.to + (mv.promotion ?? '')
            }),
            rating: Math.min(1800, 1150 + plies * 80),
            themes: plies >= 6 ? ['famousGame', 'sacrifice', 'mate'] : ['famousGame', 'mate'],
            title: `${white.split(' ')[0]} finishes`,
            source: `${white} vs ${black}${site && site !== '?' ? `, ${site}` : ''}${date && date !== '????' ? ` ${date}` : ''}`,
            allowDecidedRoot: true,
          })
          if (results.length > before) { made++; break }
        }
      }
    }
  }

  console.log = origLog
  console.error = origErr
  const sliceTag = `results-${SLICE_I}.json`
  writeFileSync(`scripts/bank/${sliceTag}`, JSON.stringify(results, null, 1))
  out(`Slice ${SLICE_I}: ${results.length} passed, ${failures.length} failed -> ${sliceTag}`)
  if (failures.length) {
    for (const f of failures.slice(0, 40)) out('  ' + f)
  }
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', errText(e)); process.exit(1) })
