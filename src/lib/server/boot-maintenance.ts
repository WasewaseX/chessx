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

/** Called once from nodeBoot(). Safe to call again; subsequent calls no-op. */
export function kickBootMaintenance(): void {
  if (started) return
  started = true
  // Give Prisma a beat to warm up, then run. Never block or crash the boot.
  const t = setTimeout(() => {
    ensureBootstrapAdmin().catch((e) => {
      console.warn('[boot] admin bootstrap check failed:', e instanceof Error ? e.message : e)
    })
    backupLoop().catch(() => {})
  }, 5_000)
  // Node-only API; optional chaining keeps the multi-target compile honest.
  ;(t as unknown as { unref?: () => void }).unref?.()
}
