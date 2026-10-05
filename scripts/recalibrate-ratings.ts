// One-time rating recalibration.
//
// Before this the account Elo started at 1000 and legacy per-time-control
// rows (bullet/blitz/rapid) lingered from an older schema. chess.com parity
// means: start at 400 (or the self-assessed seed), one overall pool only.
// This script drops the legacy rows and resets every account to its seed so
// the corrected Glicko-1 system starts from a clean, honest slate.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SEEDS: Record<string, number> = {
  new: 400,
  beginner: 800,
  intermediate: 1200,
  advanced: 1600,
  expert: 2000,
}

async function main() {
  const gone = await prisma.userRating.deleteMany({ where: { pool: { not: 'overall' } } })
  console.log(`deleted ${gone.count} legacy pool rows`)

  const profiles = await prisma.profile.findMany({
    select: { userId: true, skillLevel: true },
  })
  const skillByUser = new Map(profiles.map((p) => [p.userId, p.skillLevel]))
  const rows = await prisma.userRating.findMany({ where: { pool: 'overall' } })

  for (const row of rows) {
    const skill = skillByUser.get(row.userId) ?? 'beginner'
    const seed = SEEDS[skill] ?? 800
    await prisma.userRating.update({
      where: { id: row.id },
      data: { rating: seed, rd: 350, games: 0, wins: 0, losses: 0, draws: 0, lastGameAt: null },
    })
    console.log(`reset overall row for ${row.userId} (${skill}) to ${seed}`)
  }

  console.log('done')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
