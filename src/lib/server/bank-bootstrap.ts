// Self-healing installer for the Lichess puzzle bank.
//
// db/puzzles.db is a ~1.3GB serving database and is deliberately NOT in git
// (gitignore: *.db). Any fresh environment — a recycled sandbox, a brand new
// deployment — therefore starts without it, and the app would silently fall
// back to the 214-puzzle curated pool. This module closes that gap: on server
// start (instrumentation.ts) or on the first puzzle API hit it downloads a
// compressed snapshot of the bank from the project's own GitHub Releases
// asset, decompresses, validates and atomically installs it. No secret is
// needed: the repo is public, the release asset URL is public, and the URL
// comes from an env override (CHESSX_BANK_URL) or the constant below — never
// from user input, so there is no SSRF surface.
//
// Design constraints honored here:
// - Never blocks a request: kick() is fire-and-forget; status() is a cheap
//   snapshot for the status endpoint.
// - Never corrupts: download goes to .part, decompress to .tmp, the final
//   file appears via atomic rename only after the SQLite magic header and a
//   minimum size have been verified.
// - Never double-installs: an O_EXCL lock file with stale-lock reclaim keeps
//   multiple workers from racing on the same disk.
// - Never wedges: hard byte caps, hard timeouts, and a retry cooldown after
//   any failure so a broken network cannot loop forever.
import 'server-only'
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'

const DB_DIR = path.join(process.cwd(), 'db')
const DB_PATH = path.join(DB_DIR, 'puzzles.db')
const LOCK_PATH = path.join(DB_DIR, '.bank-bootstrap.lock')
const PART_PATH = path.join(DB_DIR, 'puzzles.db.part.gz')
const TMP_PATH = path.join(DB_DIR, 'puzzles.db.tmp')

const DEFAULT_URL = 'https://github.com/WasewaseX/chessx/releases/download/puzzle-bank-v1/puzzles.db.gz'
const BANK_URL = process.env.CHESSX_BANK_URL || DEFAULT_URL

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2GB: far above the real asset, still a hard stop
const MAX_DECOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024 // 3GB: same idea for the gunzip leg
const MIN_VALID_DB_BYTES = 50 * 1024 * 1024 // a real bank is ~1.3GB; anything smaller is a truncated lie
const LOCK_STALE_MS = 15 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const RETRY_COOLDOWN_MS = 5 * 60 * 1000
const SQLITE_MAGIC = 'SQLite format 3'

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

interface BankState {
  phase: BankPhase
  bytes: number
  totalBytes: number | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  lastAttemptAt: number
  run: Promise<void> | null
}

const g = globalThis as typeof globalThis & { __chessxBankState?: BankState }

function state(): BankState {
  if (!g.__chessxBankState) {
    g.__chessxBankState = {
      phase: 'idle',
      bytes: 0,
      totalBytes: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      lastAttemptAt: 0,
      run: null,
    }
  }
  return g.__chessxBankState
}

/** Cheap snapshot for the status endpoint and UI. No disk reads beyond existsSync. */
export function bankStatus(): BankStatus {
  const s = state()
  const available = existsSync(DB_PATH)
  return {
    phase: available ? (s.phase === 'failed' ? 'ready' : s.phase === 'idle' ? 'present' : s.phase) : s.phase,
    available,
    bytes: s.bytes,
    totalBytes: s.totalBytes,
    url: BANK_URL,
    error: s.error,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
  }
}

// ---------------------------------------------------------------------------
// Locking: one installer per disk at a time, with stale-lock reclaim.
// ---------------------------------------------------------------------------

function acquireLock(): boolean {
  mkdirSync(DB_DIR, { recursive: true })
  if (existsSync(LOCK_PATH)) {
    try {
      const age = Date.now() - statSync(LOCK_PATH).mtimeMs
      if (age < LOCK_STALE_MS) return false
      unlinkSync(LOCK_PATH) // stale: a previous process died mid-download
    } catch {
      return false
    }
  }
  try {
    writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_PATH)
  } catch {
    /* nothing to release */
  }
}

// ---------------------------------------------------------------------------
// The installer itself.
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const s = state()
  if (existsSync(DB_PATH)) {
    s.phase = 'ready'
    s.finishedAt = Date.now()
    return
  }
  mkdirSync(DB_DIR, { recursive: true })

  if (!acquireLock()) {
    // Another worker owns the install: watch for the file to appear.
    s.phase = 'waiting'
    const deadline = Date.now() + 12 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000))
      if (existsSync(DB_PATH)) {
        s.phase = 'ready'
        s.finishedAt = Date.now()
        return
      }
    }
    s.error = 'another installer held the lock; gave up waiting'
    s.phase = 'failed'
    s.finishedAt = Date.now()
    return
  }

  try {
    // ---- download ----
    s.phase = 'downloading'
    s.bytes = 0
    s.totalBytes = null
    s.startedAt = Date.now()
    s.error = null

    const resp = await fetch(BANK_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'user-agent': 'chessx-bank-bootstrap/1.0' },
    })
    if (!resp.ok || !resp.body) throw new Error(`download failed: HTTP ${resp.status}`)
    const lenHeader = resp.headers.get('content-length')
    const declared = lenHeader ? Number(lenHeader) : null
    if (declared && declared > MAX_DOWNLOAD_BYTES) throw new Error(`asset too large: ${declared} bytes`)
    s.totalBytes = declared

    let written = 0
    const source = Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      written += chunk.length
      s.bytes = written
      if (written > MAX_DOWNLOAD_BYTES) source.destroy(new Error('download exceeded the size cap'))
    })
    await pipeline(source, createWriteStream(PART_PATH))
    if (statSync(PART_PATH).size < 1024 * 1024) throw new Error('downloaded asset is implausibly small')

    // ---- decompress ----
    s.phase = 'decompressing'
    let decompressed = 0
    const gz = createReadStream(PART_PATH)
    gz.on('data', (chunk: Buffer) => {
      decompressed += chunk.length
      s.bytes = decompressed
      if (decompressed > MAX_DECOMPRESSED_BYTES) gz.destroy(new Error('decompressed stream exceeded the size cap'))
    })
    await pipeline(gz, createGunzip(), createWriteStream(TMP_PATH))

    // ---- verify ----
    s.phase = 'verifying'
    const size = statSync(TMP_PATH).size
    if (size < MIN_VALID_DB_BYTES) throw new Error(`installed database is too small (${size} bytes) — likely truncated`)
    const fd = openSync(TMP_PATH, 'r')
    const head = Buffer.alloc(SQLITE_MAGIC.length)
    readSync(fd, head, 0, head.length, 0)
    closeSync(fd)
    if (head.toString('utf8') !== SQLITE_MAGIC) throw new Error('decompressed file is not a SQLite database')

    // ---- install atomically ----
    const final = DB_PATH
    try {
      unlinkSync(final)
    } catch {
      /* not there — expected on a fresh environment */
    }
    // rename within the same directory is atomic on POSIX
    const { renameSync } = await import('node:fs')
    renameSync(TMP_PATH, final)
    try {
      unlinkSync(PART_PATH)
    } catch {
      /* already gone */
    }
    s.phase = 'ready'
    s.finishedAt = Date.now()
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e)
    s.phase = 'failed'
    s.finishedAt = Date.now()
    for (const p of [PART_PATH, TMP_PATH]) {
      try {
        unlinkSync(p)
      } catch {
        /* already gone */
      }
    }
  } finally {
    releaseLock()
  }
}

/**
 * Fire-and-forget trigger. Safe to call from anywhere, any number of times:
 * the work runs at most once per process, and a cooldown after a failure
 * keeps a broken network from being hammered in a loop.
 */
export function kickBankBootstrap(): void {
  const s = state()
  if (existsSync(DB_PATH)) {
    if (s.phase === 'idle' || s.phase === 'failed') s.phase = 'ready'
    return
  }
  if (s.run) return
  if (s.phase === 'failed' && Date.now() - (s.finishedAt ?? 0) < RETRY_COOLDOWN_MS) return
  s.run = run()
    .catch(() => {
      /* run() already recorded the failure */
    })
    .finally(() => {
      s.run = null
    })
}
