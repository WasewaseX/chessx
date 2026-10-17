// SAFE, idempotent admin seed.
//
// Rules (fixes the "hardcoded admin credentials + password reset on boot"
// audit finding):
//   1. The script only runs when ADMIN_EMAIL and ADMIN_PASSWORD are BOTH
//      provided. No default credentials exist in source anymore.
//   2. An existing account is NEVER touched: no password reset, no role flip
//      on restart. A deployed login can no longer be silently overwritten.
//   3. In production it is a no-op unless ADMIN_SEED=1 is set explicitly.
//
// Run: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret bun run db:seed-admin
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase()
const PASSWORD = process.env.ADMIN_PASSWORD || ''

const db = new PrismaClient()

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_SEED !== '1') {
    console.log('[seed-admin] production without ADMIN_SEED=1: skipped')
    return
  }
  if (!EMAIL || !PASSWORD) {
    console.log('[seed-admin] ADMIN_EMAIL/ADMIN_PASSWORD not set: skipped (no default credentials by design)')
    return
  }
  if (PASSWORD.length < 8) {
    console.error('[seed-admin] ADMIN_PASSWORD must be at least 8 characters')
    process.exit(1)
  }

  const existing = await db.user.findUnique({ where: { email: EMAIL } })
  if (existing) {
    // Never reset credentials of an existing account from a seed script.
    console.log('[seed-admin] admin account already exists, left untouched:', existing.id)
    return
  }

  const username = (process.env.ADMIN_USERNAME || EMAIL.split('@')[0]).slice(0, 20)
  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const user = await db.user.create({
    data: {
      email: EMAIL,
      username,
      usernameLower: username.toLowerCase(),
      passwordHash,
      role: 'admin',
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
  console.log('[seed-admin] admin account created:', user.id, '(password taken from env, never logged)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
