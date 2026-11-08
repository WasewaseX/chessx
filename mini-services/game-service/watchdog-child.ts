// Standalone dev-server watchdog — spawned by the game-service (a
// platform-owned process) so it outlives bun --hot module disposal.
//
// The Oct 24 lesson: a watchdog built on module-scope timers inside the
// game-service died the moment its file was hot-reloaded (bun --hot disposes
// the old module's timers), leaving the app server unwatched mid-session. A
// separate process owns its own timers and survives every reload.
//
// Loop: probe 127.0.0.1:3000 every 15s; after two consecutive misses and no
// live Next.js process (never double-spawn during a long compile), respawn
// `bun run dev` detached. Single-instance via a pid lockfile.
//
// The Nov 5 lesson (the "app is short-lived" incident): a cold compile of `/`
// on this box now takes 3-10 MINUTES (17 lazy views + engines in the client
// graph), and during that window the port accepts nothing. The old flat
// 10-minute HANG_KILL_MS murdered healthy servers that were still compiling —
// under memory contention (two overlapping servers) a compile blew past 10 min,
// got killed at 615s, and the respawn re-entered the same loop: the app died
// every ~11 minutes, forever. Fix: the grace period is tied to the YOUNGEST
// Next.js process's actual age, read from /proc — a young process gets a full
// COMPILE_GRACE_MS to finish compiling no matter what; only a MATURE process
// (one that was already serving and then stopped) is treated as hung.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'

const PID_FILE = '/home/z/my-project/.zscripts/watchdog-child.pid'
const LOG_FILE = '/home/z/my-project/.zscripts/watchdog.log'
const DEV_PORT = 3000
const INTERVAL_MS = 15_000
const SPAWN_COOLDOWN_MS = 90_000

function log(msg: string): void {
  try {
    writeFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' })
  } catch {
    // best-effort file log; the console.log below is the channel that always works
  }
  console.log(`[watchdog-child] ${msg}`)
}

// --- single instance via pid lockfile -------------------------------------
try {
  if (existsSync(PID_FILE)) {
    const old = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (Number.isFinite(old) && old > 0) {
      try {
        const cmd = readFileSync(`/proc/${old}/cmdline`, 'utf8')
        if (cmd.length > 0) {
          console.log(`[watchdog-child] instance ${old} already running; exiting`)
          process.exit(0)
        }
      } catch {
        // pid gone — stale lock, take over
      }
    }
  }
  mkdirSync('/home/z/my-project/.zscripts', { recursive: true })
  writeFileSync(PID_FILE, String(process.pid))
  process.on('exit', () => {
    try {
      if (Number(readFileSync(PID_FILE, 'utf8').trim()) === process.pid) unlinkSync(PID_FILE)
    } catch {
      // pid file already gone or unreadable at exit; nothing to clean up
    }
  })
} catch {
  // a duplicate watchdog that cannot take the lock exits via the instance
  // check above; failing the mkdir/write here must not kill the supervisor
}

// --- helpers ----------------------------------------------------------------
function devProcessExists(): boolean {
  try {
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        if (cmd.includes('next-server')) return true
        if (cmd.includes('next') && cmd.split(' ').includes('dev')) return true
      } catch {
        // the process vanished between readdir and read; just skip it
      }
    }
  } catch {
    // /proc unreadable (exotic sandbox): report no dev process and let the
    // port probe decide
  }
  return false
}

async function portAlive(): Promise<boolean> {
  // Liveness = the dev port answers an HTTP round-trip. The previous probe,
  // Bun.connect({ hostname, port }), is NOT a valid call signature in this
  // Bun runtime — it threw ERR_INVALID_ARG_TYPE ("SocketOptions.socket is
  // required") on EVERY call, so portAlive() was hardwired to false and the
  // watchdog was blind since creation. Consequence, caught live Oct 24
  // 19:49: it "HUNG-killed" a fully healthy server that was serving GET /
  // 200s in 16ms the same second — an infinite ~10-minute murder loop, the
  // chronic "render failed" flapping. fetch() is the well-trodden path: a
  // dead port rejects immediately, a live one answers (ANY status counts,
  // including 404/500 — only socket liveness matters here). Both loopbacks
  // are probed so a server bound to either stack is seen.
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${DEV_PORT}/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
        headers: { 'user-agent': 'chessx-watchdog-liveness-probe' },
      })
      // Drain/cancel so the probe never pins a response stream.
      await res.body?.cancel().catch(() => {})
      return true
    } catch {
      // refused / timeout — try the other loopback
    }
  }
  return false
}

/**
 * Age (ms) of the YOUNGEST live Next.js server/compile process, derived from
 * the /proc/<pid> directory mtime (kernel sets it at process birth). This is
 * what makes the watchdog compile-aware: a freshly born next-server that
 * cannot serve yet is COMPILED, not HUNG.
 * Returns Infinity when no process is found (caller respawns immediately).
 */
function youngestNextProcessAgeMs(): number {
  let youngestStart = -Infinity
  try {
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        const isNext = cmd.includes('next-server') || (cmd.includes('next') && cmd.split(' ').includes('dev'))
        if (!isNext) continue
        const startedAt = statSync(`/proc/${pid}`).mtimeMs
        if (Number.isFinite(startedAt) && startedAt > youngestStart) youngestStart = startedAt
      } catch {
        // the process vanished mid-scan, or its stat raced; skip it
      }
    }
  } catch {
    // /proc unreadable: fall back to Infinity (no grace info) and let the
    // caller use the conservative default
  }
  if (youngestStart === -Infinity) return Infinity
  return Date.now() - youngestStart
}

// --- main loop ---------------------------------------------------------------
let misses = 0
let lastSpawnAt = 0
let lastCompileWaitLogAt = 0
let hangSince = 0

// A MATURE Next.js process that stops serving (GC thrash, wedged worker, a
// compile that somehow never ends) must never pin the dead port forever.
// But the bar is age-relative now: any process younger than this grace is
// presumed to be compiling (worst observed cold start 10 min under memory
// contention; 20 min leaves generous headroom) and is NEVER killed.
const COMPILE_GRACE_MS = 20 * 60_000
// For mature processes the old rule still applies, measured from the first
// observed miss: 10 minutes of "was serving, now dead" = hung.
const HANG_KILL_MS = 10 * 60_000

log(`watchdog child started (pid ${process.pid})`)

async function tick(): Promise<void> {
  if (await portAlive()) {
    misses = 0
    hangSince = 0
    return
  }
  misses++
  if (misses < 2) return // one miss may be a long compile — wait for two
  if (devProcessExists()) {
    const ageMs = youngestNextProcessAgeMs()
    if (ageMs < COMPILE_GRACE_MS) {
      // Young process + dead port = almost certainly mid-compile. Never touch
      // it — killing here is what made the app die every ~11 minutes.
      const now = Date.now()
      if (now - lastCompileWaitLogAt > 60_000) {
        lastCompileWaitLogAt = now
        log(`port 3000 down, Next.js process is ${Math.round(ageMs / 1000)}s old — inside compile grace, waiting`)
      }
      hangSince = 0
      misses = 1
      return
    }
    if (!hangSince) hangSince = Date.now()
    if (Date.now() - hangSince > HANG_KILL_MS) {
      log(`port 3000 down with a MATURE Next.js process for ${Math.round((Date.now() - hangSince) / 1000)}s — treating as HUNG, killing stale processes`)
      try {
        Bun.spawn(['pkill', '-f', 'next-server'])
        Bun.spawn(['pkill', '-f', 'next dev'])
      } catch {
        // spawn failure is retried by the next hang detection cycle
      }
      hangSince = 0
      misses = 0
      return
    }
    log(`port 3000 down, mature Next.js process (${Math.round(ageMs / 1000)}s old) — hang watch ${Math.round((Date.now() - hangSince) / 1000)}s`)
    misses = 1
    return
  }
  hangSince = 0
  const now = Date.now()
  if (now - lastSpawnAt < SPAWN_COOLDOWN_MS) return
  lastSpawnAt = now
  misses = 0
  try {
    const proc = Bun.spawn(['bun', 'run', 'dev'], {
      cwd: '/home/z/my-project',
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      env: { ...process.env, BUN_BE_BUN: '1' },
    })
    proc.unref?.()
    log(`respawned dev server (pid ${proc.pid})`)
  } catch (err) {
    log(`respawn failed: ${err}`)
  }
}

setInterval(() => void tick(), INTERVAL_MS)
void tick()
