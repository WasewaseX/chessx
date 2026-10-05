// Creates (or refreshes) a local sparring account for multiplayer testing
// and prints two fresh session tokens: one for admin, one for the sparrer.
// Test infrastructure only; it never appears in the UI as content.
// The fixture uses a gmail-shaped address because login enforces the same
// provider policy as real signups, and the fixture must be able to log in.
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const EMAIL = 'chessx.sparring.bot@gmail.com'
const LEGACY_EMAIL = 'sparring@chessx.test'

async function sessionFor(userId: string): Promise<string> {
  const { randomBytes, createHash } = await import('crypto')
  const token = randomBytes(32).toString('base64url')
  const id = createHash('sha256').update(token).digest('hex')
  await db.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 86400_000) } })
  return token
}

async function main() {
  const passwordHash = await bcrypt.hash('sparring-test-only', 12)

  // migrate the pre-policy fixture row if it is still on the old address
  const legacy = await db.user.findUnique({ where: { email: LEGACY_EMAIL } })
  if (legacy) {
    await db.user.update({
      where: { email: LEGACY_EMAIL },
      data: { email: EMAIL },
    })
  }

  let sparrer = await db.user.findUnique({ where: { email: EMAIL } })
  if (sparrer) {
    sparrer = await db.user.update({
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
          create: { pool: 'overall', rating: 1000, rd: 350 },
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
