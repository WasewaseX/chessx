import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const username = 'admin'
  const email = 'admin@chessx.local'
  const password = 'admin1234'

  const existing = await db.user.findFirst({
    where: { OR: [{ usernameLower: username }, { email }] },
  })
  if (existing) {
    const upd = await db.user.update({
      where: { id: existing.id },
      data: { role: 'admin', passwordHash: await bcrypt.hash(password, 12) },
    })
    console.log('[seed] admin existed -> role/password refreshed for id', upd.id)
  } else {
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await db.user.create({
      data: {
        email,
        username,
        usernameLower: username,
        passwordHash,
        role: 'admin',
        profile: { create: { name: 'Admin', onboarded: true } },
        ratings: { create: { pool: 'overall', rating: 1200, rd: 350 } },
      },
    })
    console.log('[seed] admin account created:', user.id)
  }

  const check = await db.user.findUnique({ where: { usernameLower: 'admin' } })
  console.log('[seed] verify:', check?.username, check?.role, 'hashPrefix=', check?.passwordHash.slice(0, 7))
}

main().finally(() => db.$disconnect())
