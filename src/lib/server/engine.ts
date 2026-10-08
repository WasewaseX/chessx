// Server-side Stockfish analysis for coach-generated training material.
//
// The wasm engine runs as a UCI child process (scripts/engine-child.ts,
// driven over stdio) instead of being required into the server: the
// emscripten glue probes browser globals and worker state at load time and
// breaks inside a bundled Next.js runtime. A subprocess sidesteps all of it
// and gives plain UCI, same as the native engine binaries.
//
// Searches are serialized through a promise chain, bounded by a time budget,
// and a dead child is respawned on the next call.
import 'server-only'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

export interface EngineAnalysis {
  best: string // UCI of the best move
  bestScore: number // centipawns from the side to move's POV; mate is huge
  secondScore: number | null // rank-2 move score when MultiPV >= 2, for uniqueness margins
  pv: string[] // UCI principal variation of the best line
}

const ENGINE_DEPTH = 12
const HANDSHAKE_TIMEOUT_MS = 40_000
const SEARCH_TIMEOUT_MS = 20_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function parseScore(mate: number | null, cp: number | null): number {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100
  return cp ?? 0
}

interface EngineChild {
  proc: ChildProcessWithoutNullStreams
  lines: string[]
  dead: boolean
  send: (cmd: string) => void
}

let childPromise: Promise<EngineChild | null> | null = null
let queue: Promise<unknown> = Promise.resolve()

async function bootChild(): Promise<EngineChild | null> {
  try {
    const proc = spawn('bun', ['scripts/engine-child.ts'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd: process.cwd(),
    })
    const child: EngineChild = {
      proc,
      lines: [],
      dead: false,
      send: (cmd: string) => {
        try {
          proc.stdin.write(`${cmd}\n`)
        } catch {
          /* a dead child is detected by the exit handler and respawned */
        }
      },
    }
    proc.stdout.setEncoding('utf8')
    let buf = ''
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        child.lines.push(buf.slice(0, idx))
        buf = buf.slice(idx + 1)
      }
    })
    proc.on('exit', () => {
      child.dead = true
      childPromise = null
    })
    proc.on('error', () => {
      child.dead = true
      childPromise = null
    })

    child.send('uci')
    const t0 = Date.now()
    while (!child.lines.includes('uciok') && Date.now() - t0 < HANDSHAKE_TIMEOUT_MS) await sleep(25)
    if (!child.lines.includes('uciok')) {
      proc.kill()
      return null
    }
    child.send('isready')
    while (!child.lines.includes('readyok') && Date.now() - t0 < HANDSHAKE_TIMEOUT_MS) await sleep(25)
    if (!child.lines.includes('readyok')) {
      proc.kill()
      return null
    }
    return child
  } catch (e) {
    console.error('[coach-engine] spawn failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function getChild(): Promise<EngineChild | null> {
  if (!childPromise) {
    childPromise = bootChild().then((child) => {
      if (!child) childPromise = null
      return child
    })
  }
  return childPromise
}

async function runSearch(child: EngineChild, fen: string, multiPv: number, depth: number): Promise<EngineAnalysis | null> {
  if (child.dead) return null
  const start = child.lines.length
  child.send(`setoption name MultiPV value ${multiPv}`)
  child.send(`position fen ${fen}`)
  child.send(`go depth ${depth}`)
  const t0 = Date.now()
  let scope: string[] = []
  let bestIdx = -1
  while (Date.now() - t0 < SEARCH_TIMEOUT_MS) {
    await sleep(25)
    scope = child.lines.slice(start)
    bestIdx = scope.findIndex((l) => l.startsWith('bestmove'))
    if (bestIdx !== -1) break
  }
  if (bestIdx === -1) {
    // Stuck search: stop it and keep the protocol in sync for the next call.
    child.send('stop')
    await sleep(300)
    child.lines.splice(0, child.lines.length)
    return null
  }
  // Consume everything up to and including this bestmove so leftovers never
  // leak into the next search.
  child.lines.splice(0, start + bestIdx + 1)
  const info = scope.slice(0, bestIdx)

  // Deepest info line per MultiPV rank; ranks above 2 are ignored.
  let rank1: { best: string; score: number; pv: string[] } | null = null
  let rank2: number | null = null
  for (let i = info.length - 1; i >= 0; i--) {
    const l = info[i]
    if (!l.includes(' score ') || !l.includes(' pv ')) continue
    const mp = /multipv (\d+)/.exec(l)
    const rank = mp ? Number(mp[1]) : 1
    if (rank !== 1 && rank !== 2) continue
    if (rank === 2 && rank2 != null) continue
    const sc = /score (cp|mate) (-?\d+)/.exec(l)
    if (!sc) continue
    const score = parseScore(sc[1] === 'mate' ? Number(sc[2]) : null, sc[1] === 'cp' ? Number(sc[2]) : null)
    if (rank === 2) {
      rank2 = score
      continue
    }
    if (rank1) continue
    const pv = / pv (.+)$/.exec(l)
    if (!pv) continue
    rank1 = { best: pv[1].split(' ')[0], score, pv: pv[1].trim().split(/\s+/) }
  }
  if (!rank1) return null
  return { best: rank1.best, bestScore: rank1.score, secondScore: rank2, pv: rank1.pv }
}

/**
 * Analyze a position at fixed depth with MultiPV. Returns null when the
 * engine is unavailable or the search never finished inside the budget;
 * callers are expected to degrade to chess.js-only checks and mark the
 * artifact honestly.
 */
export async function analyze(fen: string, multiPv = 1, depth = ENGINE_DEPTH): Promise<EngineAnalysis | null> {
  const child = await getChild()
  if (!child || child.dead) return null
  const result = queue.then(() => runSearch(child, fen, multiPv, depth))
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** One combined probe so cold-start cost is paid at most once per route call. */
export async function engineAvailable(): Promise<boolean> {
  const child = await getChild()
  return child != null && !child.dead
}
