import { PrismaClient } from '@prisma/client'

/**
 * SQLite durability settings — the fix behind the intermittent "session init
 * failed" (and every other random 500 on a write route).
 *
 * Diagnosis (Oct 2026): the database ran in rollback-journal mode
 * (`journal_mode=delete`) with `busy_timeout=0` and Prisma's default
 * multi-connection pool. Any two overlapping requests — a login writing a
 * session while another request wrote anything, or the boot VACUUM snapshot
 * holding a read lock — collided with an IMMEDIATE `SQLITE_BUSY`, because a
 * busy_timeout of 0 never waits. The losing write threw, the route 500'd.
 *
 * Three layers fix it at the root:
 *   1. WAL journal mode (persistent, stored in the db file): readers never
 *      block the writer, the writer never blocks readers.
 *   2. `connection_limit=1` on the pool: one process, one connection, so the
 *      app can never collide with itself. Writes serialize; they are
 *      sub-millisecond on this database.
 *   3. `busy_timeout=5000` + a retry-with-backoff wrapper
 *      (`withWriteRetry`) as the backstop for the rare cross-process
 *      writer (backup scripts, CLI seeds).
 */
function withSqlitePoolLimits(url: string | undefined): string {
  if (!url || !url.startsWith('file:')) return url ?? ''
  const [base, query = ''] = url.slice('file:'.length).split('?')
  const params = new URLSearchParams(query)
  if (!params.has('connection_limit')) params.set('connection_limit', '1')
  return `file:${base}${params.toString() ? `?${params.toString()}` : ''}`
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: withSqlitePoolLimits(process.env.DATABASE_URL) } },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * One-time pragma init on the (single) pooled connection. WAL persists in the
 * file across restarts; busy_timeout and synchronous are per-connection, but
 * with connection_limit=1 this same connection serves the process for life.
 * Memoized so concurrent first callers await one run.
 */
let pragmaInit: Promise<void> | null = null

export function ensureSqliteReady(): Promise<void> {
  if (!pragmaInit) {
    pragmaInit = (async () => {
      if (!process.env.DATABASE_URL?.startsWith('file:')) return
      try {
        // Every PRAGMA returns a row, so queryRaw — not executeRaw.
        const mode = await db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode=WAL')
        await db.$queryRawUnsafe('PRAGMA busy_timeout=5000')
        // WAL + NORMAL is crash-safe for application crashes (the checkpoint
        // log protects commits); it only relaxes fsync on OS power loss.
        await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL')
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[db] sqlite journal mode: ${mode?.[0]?.journal_mode ?? 'unknown'}`)
        }
      } catch (e) {
        console.warn('[db] sqlite pragma init failed:', e instanceof Error ? e.message : e)
      }
    })()
  }
  return pragmaInit
}

/** Transient SQLite lock/pool contention — always worth one more try. */
const BUSY_MARKERS = [
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'database is locked',
  'database table is locked',
  'P2024', // Prisma: timed out fetching a connection from the pool
  'Timed out fetching a connection from the connection pool',
  'P1002', // Prisma: timed out trying to reach the database
]

export function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''}` : String(e)
  return BUSY_MARKERS.some((m) => msg.includes(m))
}

/**
 * Run a database operation through lock-storm retries. First call also
 * guarantees the pragmas are set before the operation runs. Total backoff is
 * ~1.3s across 6 attempts — invisible to a user, decisive against bursts.
 */
export async function withWriteRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  await ensureSqliteReady()
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isTransientDbError(e)) throw e
      last = e
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 30))
    }
  }
  throw last
}

// Kick pragma init eagerly: WAL must be on before the first write of boot
// (admin bootstrap, what's-new seeds, snapshot VACUUM), not lazily on the
// first withWriteRetry call. WAL is persistent in the file, so this one-time
// switch survives every later connection.
void ensureSqliteReady()
