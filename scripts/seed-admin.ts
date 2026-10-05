// Idempotent admin seed. Safe to run any time; it refreshes the account
// instead of duplicating it. Run: bun run db:seed-admin
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const EMAIL = 'tiktokaltrachel@atomicmail.io'
const USERNAME = 'admin'
const PASSWORD = 'tiktokaltrachel@atomicmail.io'

const db = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const existing = await db.user.findUnique({ where: { email: EMAIL } })

  if (existing) {
    await db.user.update({
      where: { email: EMAIL },
      data: { username: USERNAME, usernameLower: USERNAME, passwordHash, role: 'admin' },
    })
    console.log('admin account refreshed:', existing.id)
    return
  }

  const user = await db.user.create({
    data: {
      email: EMAIL,
      username: USERNAME,
      usernameLower: USERNAME,
      passwordHash,
      role: 'admin',
      profile: { create: { name: USERNAME, onboarded: true } },
      ratings: {
        create: [
          { pool: 'bullet', rating: 1000, rd: 350 },
          { pool: 'blitz', rating: 1000, rd: 350 },
          { pool: 'rapid', rating: 1000, rd: 350 },
        ],
      },
    },
  })
  console.log('admin account created:', user.id)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
