// One-off migration: the rating model moved from one Glicko rating per time
// pool to a single overall Elo. For every user who already played rated
// online games, the new overall row carries the numbers of their most-played
// pool, so no real history is lost. Users with no rated games get nothing
// here; the game service creates their overall row (1000 / RD 350) on first
// queue join, exactly as before.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({ include: { ratings: true } })
  let migrated = 0
  let skipped = 0
  for (const u of users) {
    if (u.ratings.some((r) => r.pool === 'overall')) {
      skipped++
      continue
    }
    const played = u.ratings.filter((r) => r.games > 0)
    if (played.length === 0) {
      skipped++
      continue
    }
    const best = played.sort((a, b) => b.games - a.games || (b.lastGameAt?.getTime() ?? 0) - (a.lastGameAt?.getTime() ?? 0))[0]
    await prisma.userRating.create({
      data: {
        userId: u.id,
        pool: 'overall',
        rating: best.rating,
        rd: best.rd,
        games: best.games,
        wins: best.wins,
        losses: best.losses,
        draws: best.draws,
        lastGameAt: best.lastGameAt,
      },
    })
    migrated++
    console.log(`overall rating for ${u.username}: ${Math.round(best.rating)} from pool ${best.pool} (${best.games} games)`)
  }
  console.log(`done: ${migrated} migrated, ${skipped} skipped`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
