// Server-side Stockfish analysis for coach-generated training material,
// bot opponents and the game review pipeline.
//
// Engine order:
//  1. Native Stockfish 19 binary (engine-native/, downloaded from the official
//     release). Strongest and fastest — this is the app's engine core.
//  2. The wasm engine as a UCI child process (scripts/engine-child.ts, driven
//     over stdio): the emscripten glue probes browser globals at load time and
//     breaks inside a bundled Next.js runtime, so a subprocess sidesteps all
//     of it and gives plain UCI, same as the native engine binaries.
//
// Searches are serialized through a promise chain, bounded by a time budget,
// and a dead child is respawned on the next call.
import 'server-only'
import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Writable, Readable } from 'stream'

export interface EngineAnalysis {
  best: string // UCI of the best move
  bestScore: number // centipawns from the side to move's POV; mate is huge
  secondScore: number | null // rank-2 move score when MultiPV >= 2, for uniqueness margins
  secondBest: string | null // UCI of the rank-2 move, so callers can dodge shuffles
  pv: string[] // UCI principal variation of the best line
  lines?: EngineLine[] // all parsed MultiPV lines (rank order), when requested
  /** The deepest `info depth` the search actually reported — honest depth, not the ask. */
  depthReached?: number
}

export interface EngineLine {
  rank: number
  best: string // UCI
  score: number // centipawns, side-to-move POV, mate mapped by parseScore
  pv: string[] // UCI
}

export const ENGINE_NAME_NATIVE = 'Stockfish 19 (native)'
export const ENGINE_NAME_WASM = 'Stockfish 19 (wasm)'

const ENGINE_DEPTH = 12
const HANDSHAKE_TIMEOUT_MS = 40_000
const SEARCH_TIMEOUT_MS = 20_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function parseScore(mate: number | null, cp: number | null): number {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100
  return cp ?? 0
}

interface EngineChild {
  proc: ChildProcessByStdio<Writable, Readable, null>
  lines: string[]
  dead: boolean
  send: (cmd: string) => void
  name: string // human-readable engine identity reported during handshake
}

let childPromise: Promise<EngineChild | null> | null = null
let queue: Promise<unknown> = Promise.resolve()

/** Absolute-ish candidates for the native engine, relative to the project root. */
function nativeCandidates(): string[] {
  const fromEnv = process.env.ENGINE_PATH
  const list = [
    ...(fromEnv ? [fromEnv] : []),
    'engine-native/stockfish/stockfish-linux-x86-64-universal',
    'engine-native/stockfish-linux-x86-64-universal',
  ]
  return list
}

async function bootProcess(cmd: string, args: string[], timeoutMs: number): Promise<EngineChild | null> {
  let proc: ChildProcessByStdio<Writable, Readable, null>
  try {
    proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd: process.cwd(),
    })
  } catch {
    return null
  }
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
    name: 'unknown',
  }
  proc.stdout.setEncoding('utf8')
  let buf = ''
  proc.stdout.on('data', (chunk: string) => {
    buf += chunk
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      child.lines.push(line)
      if (line.startsWith('id name') && child.name === 'unknown') {
        child.name = line.replace(/^id name\s+/, '').trim() || 'unknown'
      }
    }
  })
  let exited = false
  proc.on('exit', () => {
    exited = true
    child.dead = true
    childPromise = null
  })
  proc.on('error', () => {
    exited = true
    child.dead = true
    childPromise = null
  })

  child.send('uci')
  const t0 = Date.now()
  while (!child.lines.includes('uciok') && Date.now() - t0 < timeoutMs && !exited) await sleep(25)
  if (!child.lines.includes('uciok')) {
    proc.kill()
    return null
  }
  child.send('setoption name Threads value 1')
  child.send('setoption name Hash value 64')
  child.send('isready')
  while (!child.lines.includes('readyok') && Date.now() - t0 < timeoutMs && !exited) await sleep(25)
  if (!child.lines.includes('readyok')) {
    proc.kill()
    return null
  }
  return child
}

async function bootChild(): Promise<EngineChild | null> {
  // 1) the native binary: strongest and fastest when present
  for (const candidate of nativeCandidates()) {
    const child = await bootProcess(candidate, [], 12_000)
    if (child) {
      console.log(`[engine] native engine online: ${child.name} (${candidate})`)
      return child
    }
  }
  // 2) the wasm engine under bun, same UCI protocol over stdio
  const child = await bootProcess('bun', ['scripts/engine-child.ts'], HANDSHAKE_TIMEOUT_MS)
  if (child) {
    console.log(`[engine] wasm engine online: ${child.name}`)
    return child
  }
  console.error('[engine] no engine could be started (native + wasm both failed)')
  return null
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

// Deterministic analysis: same FEN, same MultiPV, same depth must always
// answer with the same best move and the same score. Two things break that
// in a naive UCI loop, so both are handled here:
//  1. The transposition table carries over between searches, so the same
//     position probed twice can return different move choices depending on
//     what was searched before it (the "same +0.31, different line" bug).
//     Every search therefore starts with the hash cleared.
//  2. Repeat requests would still pay the search cost again, so results are
//     memoized in a bounded LRU keyed by position and search parameters.
const RESULT_CACHE_MAX = 2048
const resultCache = new Map<string, EngineAnalysis>()

function cacheKey(fen: string, multiPv: number, depth: number): string {
  return `${fen}|${multiPv}|${depth}`
}

function cacheGet(key: string): EngineAnalysis | undefined {
  const hit = resultCache.get(key)
  if (hit != null) {
    // LRU refresh: delete + set moves the entry to the back.
    resultCache.delete(key)
    resultCache.set(key, hit)
  }
  return hit
}

function cachePut(key: string, value: EngineAnalysis): void {
  resultCache.set(key, value)
  if (resultCache.size > RESULT_CACHE_MAX) {
    resultCache.delete(resultCache.keys().next().value as string)
  }
}

export interface SearchOptions {
  /** UCI Skill Level 0-20. Undefined or 20 means full strength (cacheable). */
  skill?: number
  /** Cap the search in milliseconds in addition to depth. */
  movetimeMs?: number
  /** Hard wall-clock budget for the whole search, default SEARCH_TIMEOUT_MS. */
  timeoutMs?: number
}

async function runSearch(child: EngineChild, fen: string, multiPv: number, depth: number, opts?: SearchOptions): Promise<EngineAnalysis | null> {
  if (child.dead) return null
  const start = child.lines.length
  const skill = opts?.skill
  const useSkill = typeof skill === 'number' && skill >= 0 && skill <= 20 && skill < 20
  child.send('setoption name Clear Hash')
  child.send(`setoption name MultiPV value ${Math.max(1, multiPv)}`)
  child.send(`setoption name Skill Level value ${useSkill ? Math.round(skill!) : 20}`)
  child.send(`position fen ${fen}`)
  if (opts?.movetimeMs && opts.movetimeMs > 0) {
    child.send(`go depth ${depth} movetime ${Math.round(opts.movetimeMs)}`)
  } else {
    child.send(`go depth ${depth}`)
  }
  const t0 = Date.now()
  const budget = Math.max(2_000, opts?.timeoutMs ?? SEARCH_TIMEOUT_MS)
  let scope: string[] = []
  let bestIdx = -1
  while (Date.now() - t0 < budget) {
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

  // Deepest info line per MultiPV rank, plus the deepest depth the engine
  // actually reported (a movetime/timeout cap can stop the search short of
  // the requested depth — the UI must show what really happened).
  let depthReached: number | undefined
  const ranks = new Map<number, { best: string; score: number; pv: string[] }>()
  for (let i = info.length - 1; i >= 0; i--) {
    const l = info[i]
    if (depthReached === undefined) {
      const dm = /\bdepth (\d+)/.exec(l)
      if (dm) depthReached = Number(dm[1])
    }
    if (!l.includes(' score ') || !l.includes(' pv ')) continue
    const mp = /multipv (\d+)/.exec(l)
    const rank = mp ? Number(mp[1]) : 1
    if (rank < 1 || rank > multiPv) continue
    if (ranks.has(rank)) continue
    const sc = /score (cp|mate) (-?\d+)/.exec(l)
    if (!sc) continue
    const score = parseScore(sc[1] === 'mate' ? Number(sc[2]) : null, sc[1] === 'cp' ? Number(sc[2]) : null)
    const pv = / pv (.+)$/.exec(l)
    if (!pv) continue
    ranks.set(rank, { best: pv[1].split(' ')[0], score, pv: pv[1].trim().split(/\s+/) })
  }
  const rank1 = ranks.get(1)
  if (!rank1) return null
  const rank2 = ranks.get(2)
  const lines: EngineLine[] = [...ranks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, r]) => ({ rank, best: r.best, score: r.score, pv: r.pv }))
  return {
    best: rank1.best,
    bestScore: rank1.score,
    secondScore: rank2?.score ?? null,
    secondBest: rank2?.best || null,
    pv: rank1.pv,
    lines,
    depthReached,
  }
}

/**
 * Analyze a position at fixed depth with MultiPV. Returns null when the
 * engine is unavailable or the search never finished inside the budget;
 * callers are expected to degrade to chess.js-only checks and mark the
 * artifact honestly.
 *
 * opts.skill makes the search stochastic (UCI Skill Level) and skips the
 * result cache; deterministic searches (default, full strength) are cached.
 */
export async function analyze(fen: string, multiPv = 1, depth = ENGINE_DEPTH, opts?: SearchOptions): Promise<EngineAnalysis | null> {
  const skill = opts?.skill
  const stochastic = typeof skill === 'number' && skill < 20
  const key = cacheKey(fen, multiPv, depth)
  if (!stochastic) {
    const cached = cacheGet(key)
    if (cached) return cached
  }
  let child = await getChild()
  if (child && child.dead) {
    // A crashed child must not poison the cached promise forever: drop it and
    // respawn once, then decide with the fresh child.
    childPromise = null
    child = await getChild()
  }
  if (!child || child.dead) return null
  const run = queue.then(() => runSearch(child, fen, multiPv, depth, opts))
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  const analysis = await run
  if (analysis && !stochastic) cachePut(key, analysis)
  return analysis
}

/** All MultiPV lines for a position, strongest first (used by styled bots and top-move panels). */
export async function analyzeTop(fen: string, count: number, depth = ENGINE_DEPTH, opts?: SearchOptions): Promise<EngineLine[] | null> {
  const a = await analyze(fen, Math.max(1, count), depth, opts)
  return a?.lines ?? null
}

/** One combined probe so cold-start cost is paid at most once per route call. */
export async function engineAvailable(): Promise<boolean> {
  let child = await getChild()
  if (child && child.dead) {
    childPromise = null
    child = await getChild()
  }
  return child != null && !child.dead
}

/** Identity of the running engine, e.g. "Stockfish 19 (native)". Null when it is down. */
export async function engineIdentity(): Promise<string | null> {
  let child = await getChild()
  if (child && child.dead) {
    childPromise = null
    child = await getChild()
  }
  if (!child || child.dead) return null
  return child.name.includes('Stockfish') ? `${child.name}` : child.name
}
