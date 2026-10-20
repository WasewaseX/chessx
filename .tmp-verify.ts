import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const users = await db.user.findMany({ select: { id: true, email: true, username: true, role: true, createdAt: true } })
  console.log(`Users: ${users.length}`)
  for (const u of users) console.log(`- ${u.email} (${u.role}) created=${u.createdAt.toISOString().slice(0,16)}`)
  const games = await db.game.count()
  const attempts = await (db as any).puzzleAttempt?.count?.() ?? 'n/a'
  const ratings = await db.userRating.findMany({ select: { pool: true, rating: true } })
  console.log(`games=${games} puzzleAttempts=${attempts}`)
  console.log(`ratings: ${ratings.map((r: any) => `${r.pool}=${r.rating}`).join(', ')}`)
}
main().finally(() => db.$disconnect())
