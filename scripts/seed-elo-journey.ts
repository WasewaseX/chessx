/**
 * Verification-only seeding for the Elo journey chart: inserts finished
 * RATED online games for the test user with realistic post-game ratings
 * (the same rows the game-service writes). Deleted after verification.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const OPP = 'JourneyOpponent'

async function main() {
  const user = await prisma.user.findUnique({ where: { usernameLower: 'journeytester' } })
  if (!user) throw new Error('test user not found')

  // 9 rated games: a believable journey 1080 -> 1123 with a dip.
  const seq = [1080, 1097, 1112, 1096, 1081, 1099, 1111, 1123, 1123]
  const results = ['1-0', '1-0', '1-0', '0-1', '0-1', '1-0', '1-0', '1-0', '1/2-1/2']
  const deltas = [null, 17, 15, -16, -15, 18, 12, 12, 0]

  for (let i = 0; i < seq.length; i++) {
    const iAmWhite = i % 2 === 0
    // player's rating AFTER the game; opponent symmetric-ish around 1100
    const mine = seq[i]
    const opp = 1100 + (i % 3) * 8
    await prisma.onlineGame.create({
      data: {
        id: `journey-verify-${user.id}-${i}`,
        whiteName: iAmWhite ? user.username : OPP,
        blackName: iAmWhite ? OPP : user.username,
        whiteId: iAmWhite ? user.id : null,
        blackId: iAmWhite ? null : user.id,
        pool: 'rapid',
        initialSec: 600,
        incSec: 0,
        rated: true,
        result: results[i],
        termination: results[i] === '1/2-1/2' ? 'agreement' : 'checkmate',
        whiteRating: iAmWhite ? mine : opp,
        blackRating: iAmWhite ? opp : mine,
        whiteDelta: iAmWhite ? deltas[i] : null,
        blackDelta: iAmWhite ? null : deltas[i],
        pgn: '',
        createdAt: new Date(Date.now() - (seq.length - i) * 86_400_000),
        endedAt: new Date(Date.now() - (seq.length - i) * 86_400_000 + 900_000),
      },
    })
  }
  console.log('seeded', seq.length, 'rated online games for', user.username)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
