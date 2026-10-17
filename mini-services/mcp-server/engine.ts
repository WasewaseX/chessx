// Native Stockfish 19 singleton for the MCP server. One UCI process, spawned
// lazily on the first analysis, kept alive across requests, restarted if it
// dies. All searches are serialized through a mutex so `go`/`stop` can never
// interleave. Read-only: this module never mutates any game state.
import path from 'node:path'
import { existsSync } from 'node:fs'
import { Chess } from 'chess.js'

const ENGINE_CANDIDATES = [
  path.resolve(import.meta.dir, '..', '..', 'engine-native', 'stockfish', 'stockfish-linux-x86-64-universal'),
  path.resolve(process.cwd(), 'engine-native', 'stockfish', 'stockfish-linux-x86-64-universal'),
]

export function findBinary(): string {
  for (const p of ENGINE_CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `Stockfish binary not found (tried: ${ENGINE_CANDIDATES.join(', ')}) — the engine is unavailable on this host`,
  )
}

export interface EngineEval {
  /** Achieved search depth (may be lower than requested if stopped early). */
  depth: number
  bestMoveUci: string
  bestMoveSan: string
  /** Centipawn score from the SIDE TO MOVE's point of view (null on mate scores). */
  scoreCp: number | null
  /** Mate distance in moves from the side to move (positive: it mates; negative: it gets mated). */
  mate: number | null
  /** Principal variation in SAN, up to 8 plies. */
  pvSan: string[]
  elapsedMs: number
  /** True when the search was stopped by the soft timeout before reaching the requested depth. */
  stoppedEarly: boolean
}

/** UCI "mate n" -> a monotone centipawn-like number (crude but order-preserving). */
export function mateScoreToCp(n: number): number {
  return n > 0 ? 100_000 - n : -(100_000 - Math.abs(n))
}

/** Serialize async engine work. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => fn())
    this.tail = run.catch(() => {})
    return run
  }
}

// Parse one info line:  info depth N ... score cp|mate V ... pv a1b2 ...
interface InfoLine {
  depth: number
  score: { type: 'cp' | 'mate'; value: number } | null
  pv: string[]
}

function parseInfo(line: string): InfoLine | null {
  const dm = line.match(/\bdepth (\d+)/)
  if (!dm) return null
  const depth = Number(dm[1])
  let score: InfoLine['score'] = null
  const sm = line.match(/\bscore (cp|mate) (-?\d+)/)
  if (sm) score = { type: sm[1] as 'cp' | 'mate', value: Number(sm[2]) }
  const pm = line.match(/\bpv (.+)$/)
  const pv = pm ? pm[1].trim().split(/\s+/) : []
  return { depth, score, pv }
}

/** UCI move -> SAN in the given position (null if not replayable). */
function uciToSan(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) })
    return mv?.san ?? null
  } catch {
    return null
  }
}

/** PV (UCI tokens) -> SAN sequence, capped at `max` plies. */
function pvToSan(fen: string, pv: string[], max = 8): string[] {
  const out: string[] = []
  try {
    const g = new Chess(fen)
    for (const uci of pv.slice(0, max)) {
      try {
        const mv = g.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          ...(uci.length === 5 ? { promotion: uci[4] } : {}),
        })
        if (!mv) break
        out.push(mv.san)
      } catch {
        break
      }
    }
  } catch {
    /* bad fen — empty pv */
  }
  return out
}

class StockfishEngine {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private alive = false
  private handler: ((line: string) => void) | null = null
  private mutex = new Mutex()
  private spawnLock = new Mutex()

  // ------------------------------------------------------------------
  // Line pump: one persistent reader dispatches trimmed lines to the
  // single active handler (handshake or search).
  // ------------------------------------------------------------------
  private startPump(stdout: ReadableStream<Uint8Array>) {
    const reader = stdout.getReader()
    const dec = new TextDecoder()
    let buf = ''
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line && this.handler) this.handler(line)
          }
        }
      } catch {
        // stream errored — handled by the death path below
      }
      this.alive = false
      const h = this.handler
      this.handler = null
      h?.('__engine_died__')
    })()
  }

  private send(cmd: string) {
    try {
      this.proc?.stdin.write(cmd + '\n')
      this.proc?.stdin.flush()
    } catch {
      this.alive = false
    }
  }

  private waitFor(pred: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handler = null
        reject(new Error(`engine timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      this.handler = (line) => {
        if (!pred(line) && line !== '__engine_died__') return
        clearTimeout(timer)
        this.handler = null
        if (line === '__engine_died__') reject(new Error('the Stockfish process died'))
        else resolve(line)
      }
    })
  }

  /** Spawn + UCI handshake + options + ready check. Never concurrent (spawnLock). */
  private async ensureAlive(): Promise<void> {
    return this.spawnLock.lock(async () => {
      if (this.proc && this.alive) return
      await this.killCurrent()
      const bin = findBinary()
      const proc = Bun.spawn([bin], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
      this.proc = proc
      this.startPump(proc.stdout as ReadableStream<Uint8Array>)
      this.send('uci')
      await this.waitFor((l) => l === 'uciok', 15_000)
      this.send('setoption name Threads value 2')
      this.send('setoption name Hash value 128')
      this.send('ucinewgame')
      this.send('isready')
      await this.waitFor((l) => l === 'readyok', 10_000)
      this.alive = true
    })
  }

  private async killCurrent(): Promise<void> {
    if (!this.proc) return
    this.alive = false
    try {
      this.send('quit')
      this.proc.kill()
    } catch {
      /* already dead */
    }
    this.proc = null
  }

  /** Run one bounded search; resolves on bestmove with the deepest info line captured. */
  private runSearch(
    timeoutMs: number,
  ): Promise<{ best: InfoLine | null; bestUci: string; softFired: boolean }> {
    return new Promise((resolve, reject) => {
      let best: InfoLine | null = null
      let lastScore: InfoLine['score'] = null // score-only info lines (e.g. mate 0 on a dead position)
      let softFired = false
      const cleanup = () => {
        clearTimeout(soft)
        clearTimeout(hard)
        this.handler = null
      }
      const soft = setTimeout(() => {
        softFired = true
        this.send('stop')
      }, timeoutMs)
      const hard = setTimeout(() => {
        this.alive = false
        cleanup()
        void this.killCurrent()
        reject(new Error(`engine hard timeout (${timeoutMs + 15_000}ms) — process killed`))
      }, timeoutMs + 15_000)
      this.handler = (line) => {
        if (line === '__engine_died__') {
          cleanup()
          reject(new Error('the Stockfish process died mid-search'))
          return
        }
        if (line.startsWith('info') && !line.includes(' lowerbound') && !line.includes(' upperbound')) {
          const sm = line.match(/\bscore (cp|mate) (-?\d+)/)
          if (sm) lastScore = { type: sm[1] as 'cp' | 'mate', value: Number(sm[2]) }
          if (line.includes(' pv ')) {
            const info = parseInfo(line)
            if (info && info.pv.length && (!best || info.depth >= best.depth)) best = info
          }
        } else if (line.startsWith('bestmove')) {
          cleanup()
          // "bestmove (none)" = the position is already decided (mate/stalemate).
          const token = line.split(/\s+/)[1] ?? ''
          const bestUci = token === '(none)' ? '' : token
          if (!best && lastScore) best = { depth: 0, score: lastScore, pv: [] }
          resolve({ best, bestUci, softFired })
        }
      }
    })
  }

  /**
   * One bounded search on a FEN. Soft timeout sends `stop` and uses the
   * deepest completed info line; a hard timeout (+15s grace) kills the
   * process so the next call gets a fresh one.
   */
  async analyze(fen: string, depth: number, timeoutMs = 60_000): Promise<EngineEval> {
    return this.mutex.lock(async () => {
      await this.ensureAlive()
      const t0 = Date.now()
      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
      const { best, bestUci, softFired } = await this.runSearch(timeoutMs)

      const out: EngineEval = {
        depth: best?.depth ?? 0,
        bestMoveUci: bestUci || best?.pv[0] || '',
        bestMoveSan: bestUci || best?.pv[0] || '',
        scoreCp: null,
        mate: null,
        pvSan: [],
        elapsedMs: Date.now() - t0,
        stoppedEarly: softFired,
      }
      if (best?.score) {
        if (best.score.type === 'cp') out.scoreCp = best.score.value
        else out.mate = best.score.value
      }
      if (best) out.pvSan = pvToSan(fen, best.pv)
      if (out.bestMoveUci) {
        const san = uciToSan(fen, out.bestMoveUci)
        if (san) out.bestMoveSan = san
      }
      return out
    })
  }
}

export const engine = new StockfishEngine()
export { uciToSan, pvToSan, parseInfo }
