/** Deletes the DNA verification test user and all its rows. */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({ where: { usernameLower: 'narrtester' } })
  if (!user) {
    console.log('nothing to clean')
    return
  }
  const profiles = await prisma.profile.findMany({ where: { userId: user.id } })
  for (const p of profiles) {
    // GameRecord.profileId is not an FK — delete explicitly.
    const games = await prisma.gameRecord.deleteMany({ where: { profileId: p.id } })
    const drills = await prisma.drill.deleteMany({ where: { profileId: p.id } })
    const attempts = await prisma.puzzleAttempt.deleteMany({ where: { profileId: p.id } })
    const days = await prisma.activityDay.deleteMany({ where: { profileId: p.id } })
    const rush = await prisma.rushRun.deleteMany({ where: { profileId: p.id } })
    const review = await prisma.reviewItem.deleteMany({ where: { profileId: p.id } })
    const mastery = await prisma.skillMastery.deleteMany({ where: { profileId: p.id } })
    const battle = await prisma.battleRecord.deleteMany({ where: { profileId: p.id } })
    const artifacts = await prisma.coachArtifact.deleteMany({ where: { profileId: p.id } })
    const vision = await prisma.visionRun.deleteMany({ where: { profileId: p.id } })
    const positions = await prisma.savedPosition.deleteMany({ where: { profileId: p.id } })
    const woodpecker = await prisma.woodpeckerSet.deleteMany({ where: { profileId: p.id } })
    const progress = await prisma.lessonProgress.deleteMany({ where: { profileId: p.id } })
    const dna = await prisma.dnaSnapshot.deleteMany({ where: { profileId: p.id } })
    console.log(
      `profile ${p.id}: games=${games.count} drills=${drills.count} attempts=${attempts.count} days=${days.count} rush=${rush.count} review=${review.count} mastery=${mastery.count} battle=${battle.count} artifacts=${artifacts.count} vision=${vision.count} positions=${positions.count} woodpecker=${woodpecker.count} progress=${progress.count} dna=${dna.count}`,
    )
    await prisma.profile.delete({ where: { id: p.id } })
  }
  await prisma.session.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  console.log('test user removed')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
