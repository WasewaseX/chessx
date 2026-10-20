// Seeds the What's-new feed with the real ship notes. Idempotent: it skips
// any entry whose title already exists, so it can run on every boot without
// duplicating. Everything below describes work that actually shipped —
// no invented filler (the feed's contract is "never invents content").
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Seed {
  title: string
  body: string
  tag: 'update' | 'feature' | 'fix' | 'benchmark'
  version?: string
  pinned?: boolean
}

const SEEDS: Seed[] = [
  {
    title: 'Play with Coach',
    tag: 'feature',
    version: '0.3.0',
    pinned: true,
    body:
      'Your coach plays a full training game at the strength you pick (400–2400), and grades every move you make — book, best, excellent, good, inaccuracy, mistake, blunder — with the eval swing and the reason.\n\nBetter than a grade: the coach says why. Captures name the piece and square, good moves name the engine’s better idea, and every mistake opens a teaching chat you can question. Show line draws the engine’s preference on the board.',
  },
  {
    title: 'Chess.com-style two-level sidebar',
    tag: 'update',
    version: '0.3.0',
    body:
      'The rail now works like chess.com: Home, Play, Learn, Puzzles, Tools, More — each opens its own sub-tabs inside the rail, with an All tabs back row and deep links (#/puzzles/rush, #/play/online). On phones the bottom bar mirrors the same groups.',
  },
  {
    title: 'Your data survives rebuilds',
    tag: 'fix',
    version: '0.3.0',
    pinned: true,
    body:
      'The account loss is fixed at the root: the database snapshots itself to a private GitHub repo every 2 hours (plus daily copies, 30 kept), and boots restore from the newest snapshot automatically. Settings → Password lets you replace the temporary emergency password yourself.',
  },
  {
    title: 'Game review benchmark: the Opera Game',
    tag: 'benchmark',
    body:
      'We ran Morphy’s 1858 Opera Game through the reviewer. Verdict: 89.5% / 76.4% accuracy per side, best move Nxb5 (the famous queen sacrifice, “the runner-up loses about 12% of the winning chances”), turning point Nxd7 — every call historically correct. The same pipeline grades your games.',
  },
  {
    title: 'chess.com & Lichess imports, smarter re-imports',
    tag: 'feature',
    version: '0.3.0',
    body:
      'Username import now remembers each monthly archive’s ETag, so re-imports only download the months that actually changed. The signup card says it plainly: works with Chess.com · Lichess.',
  },
  {
    title: 'Security & fairness, published',
    tag: 'update',
    body:
      'Settings now states exactly how the platform behaves: rated games are human-only (the queue never inserts bots), the engine plays only where you asked for it, coach statements are verified against the real moves, credentials are hashed, rate limits protect the service.',
  },
  {
    title: 'Build gate: every push is proven buildable',
    tag: 'fix',
    body:
      'CI now installs, type-checks, lints and builds on every push to main. Two silent deployment killers were found and fixed in the process (a Turbopack/webpack conflict and a missing prisma generate on fresh builds). The hosted app can no longer fall behind by accident.',
  },
  {
    title: 'Daily plan with a DNA focus strip',
    tag: 'feature',
    body:
      'Today’s plan reads your Chess DNA and points at the weakest domain first, with one-click training. Chess DNA itself measures seven domains — including Clock (time trouble from real %clk data) and Conversion (winning positions actually won).',
  },
]

async function main() {
  let created = 0
  let skipped = 0
  for (const seed of SEEDS) {
    const exists = await prisma.changelogEntry.findFirst({ where: { title: seed.title } })
    if (exists) {
      skipped += 1
      continue
    }
    await prisma.changelogEntry.create({
      data: {
        title: seed.title,
        body: seed.body,
        tag: seed.tag,
        ...(seed.version ? { version: seed.version } : {}),
        ...(seed.pinned ? { pinned: true } : {}),
      },
    })
    created += 1
  }
  console.log(`[whatsnew-seed] created ${created}, skipped ${skipped} (already present)`)
}

main()
  .catch((e) => {
    console.error('[whatsnew-seed] failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
