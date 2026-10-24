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

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'

const PID_FILE = '/home/z/my-project/.zscripts/watchdog-child.pid'
const LOG_FILE = '/home/z/my-project/.zscripts/watchdog.log'
const DEV_PORT = 3000
const INTERVAL_MS = 15_000
const SPAWN_COOLDOWN_MS = 90_000

function log(msg: string): void {
  try {
    writeFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' })
  } catch {}
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
    } catch {}
  })
} catch {}

// --- helpers ----------------------------------------------------------------
function devProcessExists(): boolean {
  try {
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        if (cmd.includes('next-server')) return true
        if (cmd.includes('next') && cmd.split(' ').includes('dev')) return true
      } catch {}
    }
  } catch {}
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

// --- main loop ---------------------------------------------------------------
let misses = 0
let lastSpawnAt = 0
let hangSince = 0

// A Next.js process that exists but cannot serve (GC thrash, wedged worker,
// deadlocked compile) must never pin the dead port forever. Ten minutes of
// "process alive + port dead" is far beyond any compile on this box (worst
// observed full cold start ~2min), so past that the stale processes are
// killed and the normal respawn path takes over on the next tick.
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
    if (!hangSince) hangSince = Date.now()
    if (Date.now() - hangSince > HANG_KILL_MS) {
      log(`port 3000 down with a live Next.js process for ${Math.round((Date.now() - hangSince) / 1000)}s — treating as HUNG, killing stale processes`)
      try {
        Bun.spawn(['pkill', '-f', 'next-server'])
        Bun.spawn(['pkill', '-f', 'next dev'])
      } catch {}
      hangSince = 0
      misses = 0
      return
    }
    log('port 3000 down but a Next.js process exists — waiting (compile?)')
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
