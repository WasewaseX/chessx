// Boot-time guard against silent data loss.
//
// Order of operations (run BEFORE the dev server starts):
//   1. If db/custom.db is missing entirely -> try GitHub restore, then fall
//      back to recreating the schema (prisma db push).
//   2. If the database has zero users -> pull latest.db.gz from the private
//      GitHub backup repo. This is what saves the owner's data after a
//      sandbox volume rebuild.
//   3. Regardless of restore outcome, guarantee the admin + legacy accounts
//      exist (restore-accounts.ts).
//
// Never overwrites a database that already has users.

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { restoreFromGithub } from '../src/lib/server/gh-snapshot'

const DB_PATH = process.env.DATABASE_URL?.replace(/^file:/, '') || 'db/custom.db'

async function userCount(): Promise<number> {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    return await db.user.count()
  } finally {
    await db.$disconnect()
  }
}

async function main() {
  // 1. Missing db file -> snapshot first, then schema as fallback.
  if (!existsSync(DB_PATH)) {
    console.log('[gh-restore] db file missing; trying GitHub snapshot before schema push')
    const restored = await restoreFromGithub()
    if (!restored) {
      execSync('bunx prisma db push --skip-generate', { stdio: 'inherit', cwd: process.cwd() })
    }
  }

  // 2. Empty database -> pull the last GitHub snapshot.
  let count = 0
  try {
    count = await userCount()
  } catch (err) {
    console.error('[gh-restore] user count failed:', err instanceof Error ? err.message : err)
  }
  if (count === 0) {
    await restoreFromGithub()
    try {
      count = await userCount()
    } catch {
      count = -1
    }
    console.log(`[gh-restore] user count after restore attempt: ${count}`)
  } else {
    console.log(`[gh-restore] local database has ${count} user(s); no restore needed`)
  }

  // 3. Guaranteed accounts (idempotent, never touches existing rows).
  try {
    execSync('bun scripts/restore-accounts.ts', { stdio: 'inherit', cwd: process.cwd() })
  } catch (err) {
    console.error('[gh-restore] account restore failed:', err instanceof Error ? err.message : err)
  }
}

main().catch((e) => {
  console.error('[gh-restore] fatal:', e)
  // Do not block server boot on backup infra failure.
})
