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
 *  Same helper as bank-bootstrap.ts / gh-snapshot.ts, with the plain-bun
 *  ESM fallback (eval('require') throws there): build a real require() from
 *  the 'module' builtin via getBuiltinModule — no static import, so webpack
 *  never tries to resolve node builtins at build time. */
function nodeRequire(mod: string): any {
  try {
    return (eval('require'))(mod) // works under webpack + node CJS
  } catch {
    const proc = globalThis.process as unknown as {
      cwd?: () => string
      getBuiltinModule?: (m: string) => unknown
    }
    const moduleBuiltin = proc?.getBuiltinModule?.('module') as
      | { createRequire?: (f: string) => NodeRequire }
      | undefined
    const createRequire = moduleBuiltin?.createRequire
    if (createRequire && proc?.cwd) return createRequire(`${proc.cwd()}/package.json`)(mod)
    throw new Error(`nodeRequire: cannot load ${mod} in this runtime`)
  }
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

/** Classify the local database straight from the SQLite file with
 *  node:sqlite — deliberately NOT through Prisma: opening a Prisma connection
 *  caches a file handle that would keep pointing at the pre-restore (empty)
 *  inode after the snapshot swap. Read-only, closed immediately.
 *
 *  The Oct 22 lesson: "restore only when the User table is empty" was not
 *  enough. A deployment that had been running since before the user signed
 *  up carries exactly ONE row — the bootstrapped admin — and that row made a
 *  database with zero real user data look "populated", so the snapshot with
 *  the user's account was never pulled and sign-in kept failing with
 *  "account not found" after every redeploy. The restore condition is
 *  therefore about REAL user data, not merely the presence of any row:
 *
 *    empty     — no User rows at all (fresh volume)
 *    pristine  — exactly the bootstrapped admin and zero activity anywhere
 *                else (a stale deployment that nobody ever really used)
 *    populated — anything else; NEVER overwritten by a restore
 *    unknown   — unreadable file; fail safe, keep local */

/** Minimal common denominator of node:sqlite's DatabaseSync and bun:sqlite's
 *  Database — enough for read-only scalar probes. */
interface RawSqlite {
  prepare: (s: string) => { get: () => Record<string, unknown> | undefined }
  close: () => void
}

/** Open a read-only SQLite connection with whatever runtime we happen to be
 *  on: node:sqlite on Node, bun:sqlite under bun. The Oct 22 lesson: the
 *  standalone production server may run under either, and a hard
 *  node:sqlite requirement made the classifier return 'unknown' under bun —
 *  silently disabling the user-data restore there.
 *
 *  WAL caveat (Oct 2026, the "session init failed" fix put the database in
 *  WAL journal mode): a SQLITE_OPEN_READONLY connection cannot run WAL
 *  recovery, which is needed after an unclean shutdown that left a non-empty
 *  -wal sidecar. In that state the read-only open itself throws. Fallback:
 *  reopen read-write — recovery runs, the probe SELECTs still only read, and
 *  the connection closes immediately. */
function openRawReadOnly(dbPath: string): RawSqlite {
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (p: string, opts?: { readOnly?: boolean }) => RawSqlite
    }
    return new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    // fall through to bun or the read-write fallback
  }
  try {
    const { Database } = nodeRequire('bun:sqlite') as {
      Database: new (p: string, opts?: { readonly?: boolean }) => RawSqlite
    }
    return new Database(dbPath, { readonly: true })
  } catch {
    // fall through to the read-write recovery fallback
  }
  const { DatabaseSync } = nodeRequire('node:sqlite') as {
    DatabaseSync: new (p: string, opts?: { readOnly?: boolean }) => RawSqlite
  }
  return new DatabaseSync(dbPath) // read-write: allows WAL recovery, probe is still read-only
}

async function readLocalDataStateRaw(): Promise<'empty' | 'pristine' | 'populated' | 'unknown'> {
  try {
    const dbPath = dbFilePath()
    if (!dbPath) return 'unknown'
    const { existsSync } = nodeRequire('fs') as typeof import('fs')
    if (!existsSync(dbPath)) return 'empty'
    const raw = openRawReadOnly(dbPath)
    try {
      const scalar = (sql: string): number => {
        try {
          return Number(raw.prepare(sql).get()?.n ?? 0)
        } catch {
          return 0 // table not created yet in an older schema — no data there
        }
      }
      const users = scalar('SELECT COUNT(*) AS n FROM "User"')
      if (users === 0) return 'empty'
      if (users > 1) return 'populated'
      // Exactly one row: pristine ONLY if it is the bootstrapped admin AND
      // every other user-data table is empty.
      const bootAdmin = scalar(
        `SELECT COUNT(*) AS n FROM "User" WHERE email = 'admin@chessx.local' AND role = 'admin'`,
      )
      if (bootAdmin !== 1) return 'populated'
      const activity =
        scalar('SELECT COUNT(*) AS n FROM "GameRecord"') +
        scalar('SELECT COUNT(*) AS n FROM "PuzzleAttempt"') +
        scalar('SELECT COUNT(*) AS n FROM "CoachGame"') +
        scalar('SELECT COUNT(*) AS n FROM "RushRun"') +
        scalar('SELECT COUNT(*) AS n FROM "DnaSnapshot"') +
        scalar('SELECT COUNT(*) AS n FROM "OnlineGame"') +
        scalar('SELECT COUNT(*) AS n FROM "BattleRecord"') +
        scalar('SELECT COUNT(*) AS n FROM "ReviewItem"') +
        scalar('SELECT COUNT(*) AS n FROM "ImportCache"')
      return activity === 0 ? 'pristine' : 'populated'
    } finally {
      raw.close()
    }
  } catch {
    return 'unknown' // table missing / unreadable — fail safe, keep local
  }
}

/** Idempotent ship-notes seed: the What's-new feed survives a database
 *  restore from an older snapshot, because every boot re-inserts any
 *  missing entry (matched by title, never updated, never duplicated). */
async function seedWhatsNew(): Promise<void> {
  const SEEDS: { title: string; body: string; tag: string; version?: string; pinned?: boolean }[] = [
    {
      title: 'Eye training: see the board like a master',
      tag: 'feature',
      version: '0.4.4',
      body:
        'Learn gains Eye Training — four drills for the perception layer that separates masters from beginners. Square colors (name any square’s color on sight), Loose pieces (the LPDO scan: count what is attacked and undefended, then watch the hunters light up), Rays & defenders (count attackers through the lines, name the quiet defender), and Flash chunks (a position flashes, then goes dark — real master games against the same pieces scrambled, so you can measure your own chunking, de Groot style). Every position is a real master-game position from the bank; every best is a real best.',
    },
    {
      title: 'Coaches with signature openings',
      tag: 'feature',
      version: '0.4.3',
      body:
        'Every coach now plays the openings they are known for. Nina opens Italian and classical lines, Victor brings the King’s Gambit, Scotch and open Sicilians, Elena the Queen’s Gambit, English and King’s Indian, Sasha the closed Ruy López mainline, the Najdorf and the classical KID. The picker card says what each coach opens with, and the board proves it: signature repertoires lead the coach’s opening book before the level’s general lines.',
    },
    {
      title: 'The plan tells you what it costs',
      tag: 'update',
      version: '0.4.3',
      body:
        'Every training slot on Today’s Plan now carries an honest minutes estimate (a drill ~4, a repeat ~3, a Woodpecker set ~10, the daily puzzle ~3) and, in the tooltip, which Chess DNA domain it trains. No session math — per-item cost, measured by the slot kind.',
    },
    {
      title: 'Your data survives redeploys of a stale deployment',
      tag: 'fix',
      version: '0.4.3',
      pinned: true,
      body:
        'The last account-loss corner case is closed: a deployment database that only ever held the bootstrapped admin (nobody really used it) no longer blocks the boot restore. On boot, an empty OR pristine database pulls the newest GitHub snapshot; a database with ANY real game, puzzle or account is never overwritten. The production launcher also runs the server on Node now, so the restore and the 5.7M-puzzle bank work in every hosting path.',
    },
    {
      title: 'Type one letter, land anywhere',
      tag: 'update',
      version: '0.4.2',
      body:
        'Chessigma’s “Open with 6” trick, rebuilt for the web: #/a opens analysis, #/p online play, #/z puzzles, #/c a coach game, #/l the games library, #/n What’s New. Full names still work everywhere — the short ones are just faster to share.',
    },
    {
      title: 'Game library: every imported game, browsable',
      tag: 'feature',
      version: '0.4.2',
      body:
        'Tools → Games Library lists every game you ever imported from chess.com or lichess — totals, W-L-D, sources and your most-played openings up top, filters for result/source/opening/opponent below. One click sends any game to the Analysis review pipeline; the report lands in Insights against that exact game. PGN copy included.',
    },
    {
      title: 'Coach’s post-game recap',
      tag: 'feature',
      version: '0.4.1',
      body:
        'When a training game ends, the coach hands you the three costliest moments — engine-verified centipawn loss, the better move named — and each one replays on the board with the improvement drawn in. One click asks the coach to teach the idea behind the better move. Nothing invented: only measured swings make the list.',
    },
    {
      title: 'You can always see which build you are on',
      tag: 'update',
      version: '0.4.1',
      body:
        'The footer now prints the exact build a deployment serves (or the dev boot time). A stale deployment is visible at a glance instead of a guess — the missing signal behind the “still Oct 18” confusion.',
    },
    {
      title: 'Openings to fix, queued from your own games',
      tag: 'feature',
      version: '0.4.0',
      body:
        'The home page now ranks the openings that actually cost you points — games, accuracy, own errors and due practice per opening, worst first — and one click drills exactly those positions in the Mistake Corrector. Like chessigma’s review queue, but built on your locally reviewed games and honest math: nothing appears until at least two games of an opening were reviewed.',
    },
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
 *   1. RESTORE — if the local database has no REAL user data (empty, or
 *      pristine with only the bootstrapped admin) and the private GitHub
 *      snapshot repo has data, pull it BEFORE any account bootstrap can race
 *      in. The Oct 22 refinement: counting users alone kept a stale
 *      deployment's boot-admin blocking the restore forever, so the user's
 *      account never came back after redeploys ("account not found").
 *   2. Admin bootstrap (local safety net for a genuinely fresh deployment).
 *   3. What's-new seed + daily snapshot loop.
 * Resolves once restore + admin bootstrap are done, so instrumentation can
 * chain dependent bootstraps (admin-bootstrap.ts) behind it.
 */
export function runBootMaintenance(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  return (async () => {
    // 1. Restore user data from GitHub when the local db has no real data.
    try {
      const state = await readLocalDataStateRaw()
      if (state === 'empty' || state === 'pristine') {
        const { restoreFromGithub } = await import('./gh-snapshot')
        const ok = await restoreFromGithub()
        if (ok) {
          // Drop any connection Prisma may have opened against the old
          // (stale/empty) file; the next query reopens the restored inode.
          await db.$disconnect().catch(() => {})
          console.log(`[boot] user data restored from GitHub snapshot (local state was ${state})`)
        } else {
          console.log(`[boot] no snapshot pulled (local state ${state}); keeping local database`)
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
