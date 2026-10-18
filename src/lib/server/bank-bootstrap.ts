// Self-healing installer for the Lichess puzzle bank — server-side shim.
//
// db/puzzles.db is a ~1.3GB serving database and is deliberately NOT in git
// (gitignore: *.db, data/). Any fresh environment — a recycled sandbox, a
// brand new deployment — starts without it, and the app would silently fall
// back to the 214-puzzle curated pool. This module closes that gap: it spawns
// scripts/bank-fetch.mjs as a DETACHED node child process that downloads the
// compressed snapshot from this project's public GitHub Release, verifies and
// atomically installs it. The heavy lifting (546MB download + 1.3GB gunzip)
// lives OUTSIDE the next-server process on purpose: inside the server it
// pushed RSS past 2.4GB and the kernel OOM-killed the whole app. A detached
// child streams at ~100MB, survives server restarts, and reports progress
// through db/.bank-status.json which status() reads cheaply.
//
// Safety properties: no SSRF surface (the URL is a constant or env override,
// never user input), single-installer lock with stale reclaim, hard byte caps
// and timeouts inside the fetcher, atomic rename only after the SQLite magic
// header and a minimum size are verified.
//
// WEBPACK CONSTRAINT (this cost a day once — do not undo): this module is
// imported from API routes AND from instrumentation, and webpack compiles
// every one of those graphs for multiple targets. Any STATIC `node:*` import
// here (child_process, fs, path) or anything that transitively imports one
// (lichess-bank pulls node:sqlite) makes the edge/client graphs fail with
// UnhandledSchemeError and every page 500s. All node builtins are therefore
// required LAZILY inside the functions below through eval('require'), which
// webpack never tries to resolve at build time. Keep it that way.
import 'server-only'

 
function nodeRequire(mod: string): any {
  // Opaque to webpack: resolved by the real Node CJS loader at call time.
   
  return (eval('require'))(mod)
}

const DB_DIR = `${process.cwd()}/db`
const DB_PATH = `${DB_DIR}/puzzles.db`
const STATUS_PATH = `${DB_DIR}/.bank-status.json`
const FETCHER = `${process.cwd()}/scripts/bank-fetch.mjs`

const DEFAULT_URL = 'https://github.com/WasewaseX/chessx/releases/download/puzzle-bank-v1/puzzles.db.gz'
const BANK_URL = process.env.CHESSX_BANK_URL || DEFAULT_URL

export type BankPhase = 'present' | 'idle' | 'waiting' | 'downloading' | 'decompressing' | 'verifying' | 'ready' | 'failed'

export interface BankStatus {
  phase: BankPhase
  available: boolean
  bytes: number
  totalBytes: number | null
  url: string
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

const g = globalThis as typeof globalThis & { __chessxBankKickedAt?: number }

/** Cheap snapshot: existsSync + one small JSON read. No COUNT, no I/O on the bank. */
export function bankStatus(): BankStatus {
  const fs = nodeRequire('node:fs')
  const available = fs.existsSync(DB_PATH)
  let file: { phase?: string; bytes?: number; totalBytes?: number | null; error?: string | null; startedAt?: number | null; finishedAt?: number | null } = {}
  try {
    if (fs.existsSync(STATUS_PATH)) file = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'))
  } catch {
    /* torn write: treat as no status */
  }
  let phase: BankPhase = 'idle'
  if (available) {
    phase = 'present'
  } else if (file.phase && file.phase !== 'ready') {
    phase = file.phase as BankPhase
  } else if (file.phase === 'ready') {
    // the fetcher finished but the server has not seen the file yet (or the
    // file was removed again): report ready only when actually there
    phase = 'ready'
  }
  return {
    phase,
    available,
    bytes: Number(file.bytes ?? 0) || 0,
    totalBytes: file.totalBytes ?? null,
    url: BANK_URL,
    error: file.error ?? null,
    startedAt: file.startedAt ?? null,
    finishedAt: file.finishedAt ?? null,
  }
}

/**
 * Fire-and-forget trigger. Safe from anywhere, any number of times: the work
 * is delegated to a lock-guarded detached process, and an at-most-once-per-
 * 10s spawn throttle stops request storms from forking a process zoo.
 */
export function kickBankBootstrap(): void {
  const now = Date.now()
  if (g.__chessxBankKickedAt && now - g.__chessxBankKickedAt < 10_000) return
  g.__chessxBankKickedAt = now
  try {
    const fs = nodeRequire('node:fs')
    if (fs.existsSync(DB_PATH)) {
      // Bank already here: nothing to install. The hot SQL paths warm
      // themselves on the first puzzle request (lazy open in lichess-bank).
      return
    }
    // Detached + unref'd: the fetcher outlives this server process. stdio is
    // ignored so the child never blocks on a full pipe.
    const { spawn } = nodeRequire('node:child_process')
    const child = spawn(process.execPath, [FETCHER, DB_DIR, BANK_URL], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
  } catch {
    // A failed spawn must never take the request down; the next kick retries.
  }
}
