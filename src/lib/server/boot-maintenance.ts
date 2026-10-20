// Boot-time maintenance: keep user data safe and self-healing.
//
// 1. ensureBootstrapAdmin — on a BRAND-NEW (empty) database, create the
//    deployment's admin account (username "admin"). If ANY user already
//    exists it is a strict no-op: running code updates must never touch
//    existing accounts, so the credentials of a populated deployment are
//    never rewritten by a restart.
// 2. dailyBackup — once a day, snapshot the application SQLite file with
//    `VACUUM INTO` (a consistent, online backup that does not block
//    writers) and keep the last 7. This is what makes "your data survives
//    forever" real rather than a promise: even a corrupt main file can be
//    restored from the previous day's snapshot.
//
// Everything here is fire-and-forget: failures are logged and never take
// the server down.
//
// WEBPACK CONSTRAINT (same as bank-bootstrap.ts — do not undo): this module
// is reached from instrumentation, and webpack compiles that graph for
// multiple targets. Any STATIC node builtin import (fs/promises, path) makes
// the other-target builds fail with Module not found and every page 500s.
// All node builtins are therefore required LAZILY inside the functions below
// through eval('require'), which webpack never tries to resolve at build
// time. Do NOT import @/lib/auth here — it pulls node:crypto. bcryptjs also
// statically imports node:crypto, so it is lazily required at call time too.
import { db } from '@/lib/db'

const KEEP = 7
const DAY_MS = 24 * 60 * 60 * 1000

let started = false

/** Opaque to webpack: resolved by the real Node CJS loader at call time.
 *  Same helper as bank-bootstrap.ts. */
function nodeRequire(mod: string): any {
  return (eval('require'))(mod)
}

function pathJoin(...parts: string[]): string {
  const path = nodeRequire('path') as typeof import('path')
  return path.join(...parts)
}

function pathIsAbsolute(p: string): boolean {
  const path = nodeRequire('path') as typeof import('path')
  return path.isAbsolute(p)
}

function pathBasename(p: string): string {
  const path = nodeRequire('path') as typeof import('path')
  return path.basename(p)
}

async function ensureBootstrapAdmin(): Promise<void> {
  const count = await db.user.count()
  if (count > 0) return // populated database: never touch accounts on boot

  // Empty database = first run of a fresh deployment. Recreate the known
  // admin so the deployment is never locked out of its own product.
  const bcrypt = nodeRequire('bcryptjs') as typeof import('bcryptjs')
  const passwordHash = await bcrypt.hash('admin1234', 12)
  await db.user.create({
    data: {
      email: 'admin@chessx.local',
      username: 'admin',
      usernameLower: 'admin',
      passwordHash,
      role: 'admin',
      profile: { create: { name: 'Admin', onboarded: true } },
      ratings: { create: { pool: 'overall', rating: 1200, rd: 350 } },
    },
  })
  console.log('[boot] empty database: created the first admin account (username "admin")')
}

function dbFilePath(): string | null {
  const url = process.env.DATABASE_URL ?? ''
  const m = /^file:(.+)$/.exec(url)
  if (!m) return null
  return pathIsAbsolute(m[1]) ? m[1] : pathJoin(process.cwd(), m[1])
}

function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

async function backupOnce(): Promise<void> {
  const fs = nodeRequire('fs/promises') as typeof import('fs/promises')
  const src = dbFilePath()
  if (!src) return
  const backupDir = pathJoin(process.cwd(), 'db', 'backups')
  await fs.mkdir(backupDir, { recursive: true })
  const dest = pathJoin(backupDir, `custom-${stamp(new Date())}.db`)
  // VACUUM INTO writes a compact, transactionally consistent copy without
  // blocking the live database (SQLite >= 3.27).
  await db.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  const names = await fs.readdir(backupDir)
  const files = names.filter((f) => f.startsWith('custom-') && f.endsWith('.db')).sort()
  while (files.length > KEEP) {
    const victim = files.shift()!
    await fs.unlink(pathJoin(backupDir, victim)).catch(() => {})
  }
  const size = await fs.stat(dest).then((s) => s.size).catch(() => 0)
  console.log(`[boot] database snapshot written: ${pathBasename(dest)} (${Math.round(size / 1024)} KB)`)
}

async function backupLoop(): Promise<void> {
  for (;;) {
    try {
      await backupOnce()
    } catch (e) {
      console.warn('[boot] database backup failed (will retry tomorrow):', e instanceof Error ? e.message : e)
    }
    await new Promise((r) => setTimeout(r, DAY_MS))
  }
}

/** Read the User count straight from the SQLite file with node:sqlite —
 *  deliberately NOT through Prisma: opening a Prisma connection caches a
 *  file handle that would keep pointing at the pre-restore (empty) inode
 *  after the snapshot swap. Read-only, closed immediately. */
async function readUserCountRaw(): Promise<number | null> {
  try {
    const dbPath = dbFilePath()
    if (!dbPath) return null
    const { existsSync } = nodeRequire('fs') as typeof import('fs')
    if (!existsSync(dbPath)) return 0
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (p: string, opts?: { readOnly?: boolean }) => {
        prepare: (s: string) => { get: () => Record<string, unknown> | undefined }
        close: () => void
      }
    }
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = raw.prepare('SELECT COUNT(*) AS n FROM "User"').get()
      return Number(row?.n ?? 0)
    } finally {
      raw.close()
    }
  } catch {
    return null // table missing / unreadable — treat as unknown
  }
}

/** Idempotent ship-notes seed: the What's-new feed survives a database
 *  restore from an older snapshot, because every boot re-inserts any
 *  missing entry (matched by title, never updated, never duplicated). */
async function seedWhatsNew(): Promise<void> {
  const SEEDS: { title: string; body: string; tag: string; version?: string; pinned?: boolean }[] = [
    {
      title: 'Play with Coach',
      tag: 'feature',
      version: '0.3.0',
      pinned: true,
      body:
        'Your coach plays a full training game at the strength you pick (400–2400), and grades every move you make — book, best, excellent, good, inaccuracy, mistake, blunder — with the eval swing and the reason.\n\nBetter than a grade: the coach says why. Captures name the piece and square, good moves name the engine’s better idea, and every mistake opens a teaching chat you can question. Show line draws the engine’s preference on the board.',
    },
    {
      title: 'Chess.com-style two-level sidebar',
      tag: 'update',
      version: '0.3.0',
      body:
        'The rail now works like chess.com: Home, Play, Learn, Puzzles, Tools, More — each opens its own sub-tabs inside the rail, with an All tabs back row and deep links (#/puzzles/rush, #/play/online). On phones the bottom bar mirrors the same groups.',
    },
    {
      title: 'Your data survives rebuilds',
      tag: 'fix',
      version: '0.3.0',
      pinned: true,
      body:
        'The account loss is fixed at the root: the database snapshots itself to a private GitHub repo every 2 hours (plus daily copies, 30 kept), and boots restore from the newest snapshot automatically. Settings → Password lets you replace the temporary emergency password yourself.',
    },
    {
      title: 'Game review benchmark: the Opera Game',
      tag: 'benchmark',
      body:
        'We ran Morphy’s 1858 Opera Game through the reviewer. Verdict: 89.5% / 76.4% accuracy per side, best move Nxb5 (the famous queen sacrifice, “the runner-up loses about 12% of the winning chances”), turning point Nxd7 — every call historically correct. The same pipeline grades your games.',
    },
    {
      title: 'chess.com & Lichess imports, smarter re-imports',
      tag: 'feature',
      version: '0.3.0',
      body:
        'Username import now remembers each monthly archive’s ETag, so re-imports only download the months that actually changed. The signup card says it plainly: works with Chess.com · Lichess.',
    },
    {
      title: 'Security & fairness, published',
      tag: 'update',
      body:
        'Settings now states exactly how the platform behaves: rated games are human-only (the queue never inserts bots), the engine plays only where you asked for it, coach statements are verified against the real moves, credentials are hashed, rate limits protect the service.',
    },
    {
      title: 'Build gate: every push is proven buildable',
      tag: 'fix',
      body:
        'CI now installs, type-checks, lints and builds on every push to main. Two silent deployment killers were found and fixed in the process (a Turbopack/webpack conflict and a missing prisma generate on fresh builds). The hosted app can no longer fall behind by accident.',
    },
    {
      title: 'Daily plan with a DNA focus strip',
      tag: 'feature',
      body:
        'Today’s plan reads your Chess DNA and points at the weakest domain first, with one-click training. Chess DNA itself measures seven domains — including Clock (time trouble from real %clk data) and Conversion (winning positions actually won).',
    },
  ]
  for (const seed of SEEDS) {
    const exists = await db.changelogEntry.findFirst({ where: { title: seed.title }, select: { id: true } })
    if (exists) continue
    await db.changelogEntry.create({
      data: {
        title: seed.title,
        body: seed.body,
        tag: seed.tag,
        ...(seed.version ? { version: seed.version } : {}),
        ...(seed.pinned ? { pinned: true } : {}),
      },
    })
  }
}

/**
 * Full boot sequence, in strict order (the Oct 20 lesson: order is data):
 *   1. RESTORE — if the local database has zero users and the private
 *      GitHub snapshot repo has data, pull it BEFORE any account bootstrap
 *      can race in and make the database look populated.
 *   2. Admin bootstrap (local safety net for a genuinely fresh deployment).
 *   3. What's-new seed + daily snapshot loop.
 * Resolves once restore + admin bootstrap are done, so instrumentation can
 * chain dependent bootstraps (admin-bootstrap.ts) behind it.
 */
export function runBootMaintenance(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  return (async () => {
    // 1. Restore user data from GitHub when the local db is empty.
    try {
      const count = await readUserCountRaw()
      if (count === 0) {
        const { restoreFromGithub } = await import('./gh-snapshot')
        const ok = await restoreFromGithub()
        if (ok) {
          // Drop any connection Prisma may have opened against the old
          // (empty) file; the next query reopens the restored inode.
          await db.$disconnect().catch(() => {})
          console.log('[boot] user data restored from GitHub snapshot')
        }
      }
    } catch (e) {
      console.warn('[boot] restore check failed:', e instanceof Error ? e.message : e)
    }
    // 2. Admin bootstrap — no-op on a populated database.
    await ensureBootstrapAdmin().catch((e) => {
      console.warn('[boot] admin bootstrap check failed:', e instanceof Error ? e.message : e)
    })
    // 3. Fire-and-forget seeds and the daily local snapshot loop.
    seedWhatsNew().catch((e) => {
      console.warn('[boot] whats-new seed failed:', e instanceof Error ? e.message : e)
    })
    backupLoop().catch(() => {})
  })()
}

/** Back-compat wrapper: fire-and-forget entry used by instrumentation. */
export function kickBootMaintenance(): Promise<void> {
  // Give Prisma a beat to warm up, then run. Never block or crash the boot.
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      runBootMaintenance()
        .catch(() => {})
        .finally(() => resolve())
    }, 1_500)
    // Node-only API; optional chaining keeps the multi-target compile honest.
    ;(t as unknown as { unref?: () => void }).unref?.()
  })
}
