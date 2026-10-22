// E2E test of the Oct 22 restore-policy fix: a "stale deployment" database
// (full schema, only the bootstrapped admin, zero real activity) must have
// its user data restored from the GitHub snapshot repo on boot.
//
// Run: DATABASE_URL=file:/tmp/stale-deploy.db bun scripts/verify-restore-policy.ts

import { Database } from 'bun:sqlite'

const DB = process.env.DATABASE_URL?.replace(/^file:/, '') || '/tmp/stale-deploy.db'

function dump(label: string) {
  const raw = new Database(DB, { readonly: true })
  try {
    const users = raw.prepare('SELECT email, role FROM "User" ORDER BY email').all()
    const games = raw.prepare('SELECT COUNT(*) n FROM "GameRecord"').get()
    const attempts = raw.prepare('SELECT COUNT(*) n FROM "PuzzleAttempt"').get()
    console.log(`[${label}] users=${JSON.stringify(users)} games=${games?.n} attempts=${attempts?.n}`)
  } finally {
    raw.close()
  }
}

async function main() {
  dump('before boot (simulated stale deployment)')
  const { runBootMaintenance } = await import('../src/lib/server/boot-maintenance')
  await runBootMaintenance()
  // give the fire-and-forget seed a moment, then inspect the file directly
  await new Promise((r) => setTimeout(r, 1500))
  dump('after boot')
  const raw = new Database(DB, { readonly: true })
  const hasUser = raw
    .prepare(`SELECT COUNT(*) n FROM "User" WHERE email = 'tiktokaltrachel@atomicmail.io'`)
    .get()
  raw.close()
  if (Number(hasUser?.n) === 1) {
    console.log('PASS: user account restored from GitHub snapshot on a pristine local db')
  } else {
    console.log('FAIL: user account still missing after boot')
    process.exitCode = 1
  }
  process.exit(process.exitCode ?? 0)
}

main()
