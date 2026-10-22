// Restores the two guaranteed accounts after a database loss.
//
// Design rules:
//   1. ADMIN account (admin / admin1234) is created when missing, never
//      touched when present. Everything unlocked for role=admin is enforced
//      by the app's own role checks, not by this script.
//   2. LEGACY accounts listed in RESTORE_ACCOUNTS are re-created with a
//      temporary password ONLY if they are missing. The user can change it
//      afterwards in Settings. Existing accounts are never modified.
//   3. Safe to run on every boot — fully idempotent.
//
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const ADMIN_EMAIL = 'admin@chessx.local'
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234'

// Accounts the owner must always be able to sign into. If a snapshot restore
// failed or no backup existed, these are re-created with a known password.
const RESTORE_ACCOUNTS = [
  {
    email: 'tiktokaltrachel@atomicmail.io',
    username: 'tiktokaltrachel',
    password: process.env.LEGACY_RESTORE_PASSWORD || 'chessx1234',
  },
]

async function upsertGuaranteed(
  email: string,
  username: string,
  password: string,
  role: 'admin' | 'user',
): Promise<'created' | 'exists'> {
  const existing = await db.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { usernameLower: username.toLowerCase() }] },
  })
  if (existing) return 'exists'

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      username,
      usernameLower: username.toLowerCase(),
      passwordHash,
      role,
      profile: { create: { name: username, onboarded: true } },
      ratings: {
        create: [
          { pool: 'bullet', rating: 1000, rd: 350 },
          { pool: 'blitz', rating: 1000, rd: 350 },
          { pool: 'rapid', rating: 1000, rd: 350 },
        ],
      },
    },
  })
  console.log(`[restore-accounts] created ${role} account:`, user.email)
  return 'created'
}

async function main() {
  const a = await upsertGuaranteed(ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD, 'admin')
  for (const acc of RESTORE_ACCOUNTS) {
    await upsertGuaranteed(acc.email, acc.username, acc.password, 'user')
  }
  console.log('[restore-accounts] done (admin:', a + ')')
}

main()
  .catch((e) => {
    console.error('[restore-accounts] failed:', e instanceof Error ? e.message : e)
  })
  .finally(() => db.$disconnect())
