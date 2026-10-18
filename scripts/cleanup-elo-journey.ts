/** Deletes the Elo journey verification test user and its online games. */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({ where: { usernameLower: 'journeytester' } })
  if (!user) return console.log('nothing to clean')
  const games = await prisma.onlineGame.deleteMany({ where: { id: { startsWith: `journey-verify-${user.id}` } } })
  console.log('online games removed:', games.count)
  await prisma.session.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  console.log('test user removed (profile cascaded)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
