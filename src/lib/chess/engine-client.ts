// Unified engine client.
//
// Primary: Stockfish 19 (lite, single-threaded) served from /engine via a
// classic worker. Fallback: our own minimax worker if Stockfish cannot be
// instantiated. The rest of the app only ever talks to this module.

export interface EngineInfo {
  depth: number
  scoreCp: number | null // centipawns, side-to-move POV
  mate: number | null // plies to mate, positive = side to move mates
  pv: string[] // UCI moves
}

export interface EngineRequest {
  fen: string
  skill?: number // 0-20
  depth?: number
  minTime?: number // ms to pace the answer
  blunder?: number // chance of returning a random legal move instead
}

class EngineClient {
  private sf: Worker | null = null
  private fb: Worker | null = null
  private useFallback = false
  private readyPromise: Promise<void> | null = null
  private seq = 0
  private waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private sfLines: string[] = []
  private busy = false
  private queue: (() => void)[] = []
  private sfPending: ((v: string) => void) | null = null
  private sfEvalPending: ((v: EngineInfo) => void) | null = null

  private newWaiter<T>(): { promise: Promise<T>; id: number; resolve: (v: T) => void } {
    const id = ++this.seq
    let resolveFn!: (v: T) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve
      this.waiters.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
    return { promise, id, resolve: resolveFn }
  }

  private settle(id: number, value: unknown) {
    const w = this.waiters.get(id)
    if (w) {
      this.waiters.delete(id)
      w.resolve(value)
    }
  }

  // ---- serialization -------------------------------------------------
  private async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.busy) {
      await new Promise<void>((r) => this.queue.push(r))
    }
    this.busy = true
    try {
      return await job()
    } finally {
      this.busy = false
      const next = this.queue.shift()
      if (next) next()
    }
  }

  // ---- lifecycle ------------------------------------------------------
  init(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.doInit()
    }
    return this.readyPromise
  }

  private async doInit(): Promise<void> {
    const ok = await this.tryStockfish()
    if (!ok) {
      this.useFallback = true
      this.fb = new Worker(new URL('./engine-worker.ts', import.meta.url))
      this.fb.onmessage = (e: MessageEvent) => {
        if (e.data?.id != null) this.settle(e.data.id, e.data)
      }
      // warm it up
      const { promise, id } = this.newWaiter<unknown>()
      this.fb.postMessage({ cmd: 'ping', id })
      await promise
    }
  }

  private tryStockfish(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (v: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      }
      const timer = setTimeout(() => finish(false), 12000)
      try {
        const w = new Worker('/engine/stockfish.js')
        w.onerror = () => finish(false)
        w.onmessage = (e: MessageEvent) => {
          const line = typeof e.data === 'string' ? e.data : (e.data?.line ?? e.data?.data ?? '')
          if (typeof line !== 'string') return
          if (line.includes('uciok')) {
            w.postMessage('setoption name Threads value 1')
            w.postMessage('setoption name Hash value 64')
            w.postMessage('isready')
          }
          if (line.includes('readyok')) {
            w.onmessage = this.onStockfishMessage.bind(this)
            this.sf = w
            finish(true)
          }
        }
        w.postMessage('uci')
      } catch {
        finish(false)
      }
    })
  }

  private onStockfishMessage(e: MessageEvent) {
    const line = typeof e.data === 'string' ? e.data : (e.data?.line ?? e.data?.data ?? '')
    if (typeof line !== 'string') return
    if (line.startsWith('bestmove')) {
      const best = line.split(/\s+/)[1] ?? null
      if (this.sfEvalPending) {
        const info = this.parseLastInfo(this.sfLines)
        const p = this.sfEvalPending
        this.sfEvalPending = null
        p({ ...info, pv: info.pv.length ? info.pv : best && best !== '(none)' ? [best] : [] })
      } else if (this.sfPending) {
        const p = this.sfPending
        this.sfPending = null
        p(best && best !== '(none)' ? best : '')
      }
      this.sfLines = []
      return
    }
    if (line.startsWith('info')) this.sfLines.push(line)
  }

  private parseLastInfo(lines: string[]): Omit<EngineInfo, 'pv'> {
    let depth = 0
    let scoreCp: number | null = null
    let mate: number | null = null
    let pv: string[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      const dMatch = l.match(/depth (\d+)/)
      if (dMatch && depth === 0) depth = parseInt(dMatch[1], 10)
      if (l.includes(' score ') && scoreCp === null && mate === null) {
        const m = l.match(/score (cp|mate) (-?\d+)/)
        if (m) {
          if (m[1] === 'cp') scoreCp = parseInt(m[2], 10)
          else mate = parseInt(m[2], 10)
          pv = this.parsePv(l)
          break
        }
      }
    }
    return { depth, scoreCp, mate, pv }
  }

  private parsePv(line: string): string[] {
    const i = line.indexOf(' pv ')
    if (i === -1) return []
    return line.slice(i + 4).trim().split(/\s+/)
  }

  private fallbackLevel(skill: number): number {
    return Math.max(1, Math.min(4, Math.round((skill / 20) * 4)))
  }

  // ---- public API ------------------------------------------------------
  async bestMove(req: EngineRequest): Promise<{ uci: string }> {
    await this.init()
    return this.run(() => this._bestMove(req))
  }

  private async _bestMove(req: EngineRequest): Promise<{ uci: string }> {
    if (this.useFallback && this.fb) {
      const { promise, id } = this.newWaiter<{ best: string | null; san: string | null }>()
      this.fb.postMessage({ cmd: 'search', fen: req.fen, level: this.fallbackLevel(req.skill ?? 20), id })
      const r = await promise
      if (req.minTime) await new Promise((res) => setTimeout(res, req.minTime))
      return { uci: r.best ?? '0000' }
    }
    const w = this.sf!
    const { promise, resolve } = this.newWaiter<string>()
    this.sfPending = resolve
    const started = Date.now()
    w.postMessage(`position fen ${req.fen}`)
    w.postMessage(`go depth ${req.depth ?? 12}`)
    let uci = await promise
    const elapsed = Date.now() - started
    if (req.minTime && elapsed < req.minTime) {
      await new Promise((r) => setTimeout(r, req.minTime - elapsed))
    }
    if (req.blunder && Math.random() < req.blunder) {
      const rnd = await this.randomLegalMove(req.fen)
      if (rnd) uci = rnd
    }
    return { uci }
  }

  async eval(req: EngineRequest): Promise<EngineInfo> {
    await this.init()
    return this.run(() => this._eval(req))
  }

  private async _eval(req: EngineRequest): Promise<EngineInfo> {
    if (this.useFallback && this.fb) {
      const { promise, id } = this.newWaiter<{ scoreCp: number; mate: number | null; pv: string[]; type: string }>()
      this.fb.postMessage({ cmd: 'eval', fen: req.fen, depth: Math.min(req.depth ?? 12, 3), id })
      const r = await promise
      return { depth: req.depth ?? 3, scoreCp: r.scoreCp, mate: r.mate, pv: r.pv }
    }
    const w = this.sf!
    const { promise, resolve } = this.newWaiter<EngineInfo>()
    this.sfEvalPending = resolve
    w.postMessage(`position fen ${req.fen}`)
    w.postMessage(`go depth ${req.depth ?? 12}`)
    return promise
  }

  private async randomLegalMove(fen: string): Promise<string | null> {
    const { Chess } = await import('chess.js')
    try {
      const g = new Chess(fen)
      const moves = g.moves()
      if (!moves.length) return null
      const m = moves[Math.floor(Math.random() * moves.length)]
      const mv = g.move(m)
      return mv.from + mv.to + (mv.promotion ?? '')
    } catch {
      return null
    }
  }

  isFallback(): boolean {
    return this.useFallback
  }
}

export const engine = new EngineClient()
