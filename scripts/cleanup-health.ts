/** Deletes the health-check verification user. */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const user = await prisma.user.findUnique({ where: { usernameLower: 'healthcheck' } })
  if (!user) return console.log('nothing to clean')
  const p = await prisma.profile.findUnique({ where: { userId: user.id } })
  if (p) {
    await prisma.activityDay.deleteMany({ where: { profileId: p.id } })
    await prisma.profile.delete({ where: { id: p.id } })
  }
  await prisma.session.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  console.log('healthcheck user removed')
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
