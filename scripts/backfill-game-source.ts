/**
 * Backfill GameRecord.source for imported games (botLevel = 0) that predate
 * the column: the PGN's Site header self-identifies the provider
 * (chess.com vs lichess). Anything unrecognizable stays null and the library
 * shows it honestly as "imported" without a provider chip.
 *
 *   bun scripts/backfill-game-source.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function sourceFromPgn(pgn: string): string | null {
  const m = pgn.match(/^\[Site\s+"([^"]*)"\]/m)
  if (!m) return null
  const site = m[1].toLowerCase()
  if (site.includes('chess.com')) return 'chesscom'
  if (site.includes('lichess')) return 'lichess'
  return null
}

async function main() {
  const rows = await prisma.gameRecord.findMany({
    where: { botLevel: 0, source: null },
    select: { id: true, pgn: true },
  })
  let patched = 0
  let unknown = 0
  for (const r of rows) {
    const src = sourceFromPgn(r.pgn)
    if (src) {
      await prisma.gameRecord.update({ where: { id: r.id }, data: { source: src } })
      patched++
    } else {
      unknown++
    }
  }
  console.log(`backfill-game-source: scanned ${rows.length}, patched ${patched}, unknown-site ${unknown}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
