// Creates (or refreshes) a local sparring account for multiplayer testing
// and prints two fresh session tokens: one for admin, one for the sparrer.
// Test infrastructure only; it never appears in the UI as content.
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function sessionFor(userId: string): Promise<string> {
  const { randomBytes, createHash } = await import('crypto')
  const token = randomBytes(32).toString('base64url')
  const id = createHash('sha256').update(token).digest('hex')
  await db.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 86400_000) } })
  return token
}

async function main() {
  const EMAIL = 'sparring@chessx.test'
  const passwordHash = await bcrypt.hash('sparring-test-only', 12)
  const existing = await db.user.findUnique({ where: { email: EMAIL } })
  let sparrer = existing
  if (sparrer) {
    await db.user.update({
      where: { email: EMAIL },
      data: { username: 'SparringPartner', usernameLower: 'sparringpartner', passwordHash },
    })
  } else {
    sparrer = await db.user.create({
      data: {
        email: EMAIL,
        username: 'SparringPartner',
        usernameLower: 'sparringpartner',
        passwordHash,
        profile: { create: { name: 'SparringPartner', onboarded: true } },
        ratings: {
          create: [
            { pool: 'bullet', rating: 1000, rd: 350 },
            { pool: 'blitz', rating: 1000, rd: 350 },
            { pool: 'rapid', rating: 1000, rd: 350 },
          ],
        },
      },
    })
  }

  const admin = await db.user.findUnique({ where: { email: 'tiktokaltrachel@atomicmail.io' } })
  if (!admin) throw new Error('admin missing; run db:seed-admin first')

  const adminToken = await sessionFor(admin.id)
  const sparrToken = await sessionFor(sparrer.id)
  console.log(JSON.stringify({ adminToken, sparrToken }))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
