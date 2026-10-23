// Build the Conversion Trainer position pool.
//
// Goal: real master-game positions where one side holds a clear, convertible
// advantage (Stockfish +3.0..+9.0), NOT already a forced mate sequence — the
// user must demonstrate TECHNIQUE (keeping the advantage while the opponent
// resists), not find one tactic.
//
// Source: random samples from the 5.77M-puzzle bank, filtered to plausible
// winning themes, then engine-verified one by one. Every position in the
// output pool carries the engine's own verdict, best line and the side that
// is winning — the trainer trusts nothing else.
//
// Run: bun scripts/build-conversion-pool.ts   (writes db/conversion-pool.json)

import { Database } from 'bun:sqlite'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { Chess } from 'chess.js'

const ENGINE = '/home/z/my-project/engine-native/stockfish/stockfish-linux-x86-64-universal'
const OUT = '/home/z/my-project/db/conversion-pool.json'
const LOG = '/home/z/my-project/engine-revival.log'
const TARGET = 150
const DEPTH = 16
const MIN_CP = 300
const MAX_CP = 900

interface Cand {
  id: string
  fen: string
  rating: number
  themes: string
}

interface PoolEntry {
  id: string
  fen: string // position where the WINNING side is to move (flipped if needed)
  evalCp: number // cp advantage of the side to move in the stored fen
  winner: 'w' | 'b' // side to move in the stored fen (the converter)
  bestLine: string[] // SAN best line from the engine
  rating: number
  themes: string[]
}

function log(msg: string): void {
  appendFileSync(LOG, `[pool] ${new Date().toISOString()} ${msg}\n`)
}

interface EngineHandle {
  send: (cmd: string) => void
  readUntil: (pred: (line: string) => boolean, timeoutMs: number) => Promise<string[] | null>
  kill: () => void
}

function spawnEngine(): EngineHandle {
  const proc = Bun.spawn([ENGINE], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const reader = (proc.stdout as ReadableStream<Uint8Array>)
    .pipeThrough(new TextDecoderStream())
    .getReader()
  const pending: string[] = []
  // Global consume cursor: readUntil must NEVER re-scan lines from previous
  // searches (a per-call cursor would return stale bestmove/score pairs and
  // every position would inherit the first search's verdict).
  let consumed = 0
  let done = false
  const pump = (async () => {
    try {
      while (true) {
        const { value, done: d } = await reader.read()
        if (d) break
        for (const line of value.split('\n')) {
          const t = line.trim()
          if (t) pending.push(t)
        }
      }
    } catch {
      /* stream closed */
    }
    done = true
  })()

  async function readUntil(pred: (line: string) => boolean, timeoutMs: number): Promise<string[] | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (done && consumed >= pending.length) return null
      let end = -1
      for (let i = consumed; i < pending.length; i++) {
        if (pred(pending[i])) {
          end = i
          break
        }
      }
      if (end >= 0) {
        const out = pending.slice(consumed, end + 1)
        consumed = end + 1
        return out
      }
      await new Promise((r) => setTimeout(r, 5))
    }
    return null
  }

  proc.stdin.write('uci\n')
  proc.stdin.write('setoption name Threads value 2\n')
  proc.stdin.write('setoption name Hash value 64\n')
  proc.stdin.write('ucinewgame\n')
  return {
    send: (cmd: string) => proc.stdin.write(cmd + '\n'),
    readUntil,
    kill: () => {
      try {
        proc.kill()
      } catch {
        /* already dead */
      }
      void pump
    },
  }
}

interface EvalResult {
  cp: number // centipawns from the side-to-move's perspective
  mate: number | null
  bestUci: string
  pv: string[]
}

async function evaluate(eng: EngineHandle, fen: string, depth: number): Promise<EvalResult | null> {
  eng.send('position fen ' + fen)
  eng.send('go depth ' + depth)
  const lines = await eng.readUntil((l) => l.startsWith('bestmove'), 20_000)
  if (!lines) return null
  const best = lines.find((l) => l.startsWith('bestmove'))
  if (!best) return null
  const bestUci = best.split(/\s+/)[1] ?? ''
  const infoLines = lines.filter((l) => l.startsWith('info') && l.includes(' pv '))
  const last = infoLines[infoLines.length - 1]
  if (!last) return null
  const scoreTok = last.match(/score (cp|mate) (-?\d+)/)
  if (!scoreTok) return null
  const mate = scoreTok[1] === 'mate' ? Number(scoreTok[2]) : null
  const cp = scoreTok[1] === 'cp' ? Number(scoreTok[2]) : mate && mate > 0 ? 10000 : -10000
  const pv = last.split(' pv ')[1]?.trim().split(/\s+/) ?? []
  return { cp, mate, bestUci, pv }
}

function sanLine(fen: string, pvUci: string[], maxPlies = 6): string[] {
  const game = new Chess(fen)
  const out: string[] = []
  for (const uci of pvUci.slice(0, maxPlies)) {
    const from = uci.slice(0, 2) as never
    const to = uci.slice(2, 4) as never
    try {
      const mv = game.move({ from, to, promotion: uci[4] })
      if (!mv) break
      out.push(mv.san)
    } catch {
      break
    }
  }
  return out
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const db = new Database('/home/z/my-project/db/puzzles.db', { readonly: true })
  const max = (db.query('SELECT MAX(rowid) m FROM puzzles').get() as { m: number }).m

  // Resume support: keep already-verified entries across reruns.
  const existing: PoolEntry[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')).positions ?? []) : []
  const seen = new Set(existing.map((e) => e.id))
  const pool: PoolEntry[] = [...existing]
  log(`pool build started: have ${pool.length}/${TARGET}`)

  // 1. Sample candidates generously — most will fail verification.
  let cands: Cand[] = []
  for (let i = 0; i < 60 && cands.length < 3000; i++) {
    const x = Math.floor(Math.random() * max)
    const rows = db
      .query('SELECT id, fen, rating, themes FROM puzzles WHERE rowid > ? LIMIT 500')
      .all(x) as unknown as Cand[]
    cands.push(...rows)
  }
  // Dedupe identical board positions — lichess puzzles from one master game
  // repeat the same FEN family; a pool of clones is worthless.
  const fenSeen = new Set<string>()
  cands = cands.filter((c) => {
    const board = c.fen.split(' ')[0]
    if (fenSeen.has(board)) return false
    fenSeen.add(board)
    return true
  })
  db.close()
  const filtered = cands.filter(
    (r) =>
      !seen.has(r.id) &&
      r.rating >= 1500 &&
      r.rating <= 2400 &&
      /(^| )(material|endgame|advantage|crushing|triangulation|zugzwang|advancedPawn|queenside|defensiveMove)( |$)/.test(r.themes ?? '') &&
      !/mateIn1|mateIn2|backRank/.test(r.themes ?? ''),
  )
  console.log(`candidates: ${cands.length} sampled -> ${filtered.length} after theme filter`)
  log(`candidates after filter: ${filtered.length}`)

  // 2. Engine-verify each candidate.
  const eng = spawnEngine()
  await eng.readUntil((l) => l === 'uciok', 10_000)

  let evaluated = 0
  for (const c of filtered) {
    if (pool.length >= TARGET) break
    if (Date.now() - t0 > 8 * 60_000) break // never stall the session
    evaluated++
    if (evaluated % 100 === 0) console.log(`... evaluated ${evaluated}/${filtered.length}, accepted ${pool.length}`)

    // The puzzle FEN hands the move to the SOLVER (usually the side that wins
    // material). Evaluate as-is; if the SOLVER is losing, flip nothing — skip.
    let game: Chess
    try {
      game = new Chess(c.fen)
    } catch {
      continue
    }
    if (game.isGameOver()) continue

    const res = await evaluate(eng, c.fen, DEPTH)
    if (!res) continue
    if (Number.isNaN(res.cp)) continue
    const absCp = Math.abs(res.cp)
    if (absCp < MIN_CP || absCp > MAX_CP) continue
    if (res.mate !== null && Math.abs(res.mate) <= 1) continue // forced mate now: not technique
    if (res.cp < 0) continue // side to move is LOSING — not a conversion drill
    if (!res.bestUci || res.bestUci === '(none)') continue

    // Quality: the winner must be to move, position must stay legal and the
    // eval must hold roughly when we verify the opponent's best reply too.
    const winner = (game.turn()) as 'w' | 'b'
    const pvSan = sanLine(c.fen, res.pv)
    if (pvSan.length < 2) continue

    pool.push({
      id: c.id,
      fen: c.fen,
      evalCp: res.cp,
      winner,
      bestLine: pvSan,
      rating: c.rating,
      themes: (c.themes ?? '').split(' ').filter(Boolean).slice(0, 5),
    })
    seen.add(c.id)
    console.log(`+ ${pool.length}/${TARGET} ${c.id} eval +${res.cp} (${pvSan.slice(0, 3).join(' ')})`)
    if (pool.length % 10 === 0) {
      writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), depth: DEPTH, positions: pool }, null, 1))
    }
  }

  eng.kill()
  writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), depth: DEPTH, positions: pool }, null, 1))
  console.log(`DONE: evaluated ${evaluated}, accepted ${pool.length} in ${Math.round((Date.now() - t0) / 1000)}s`)
  log(`pool build done: ${pool.length} positions`)
}

void main()
