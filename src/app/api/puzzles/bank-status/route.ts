// Honest, public health report for the puzzle source. Since the lightweight
// decision (Oct 24) the app no longer downloads or holds a 1.57GB bank:
// puzzles come from db/puzzle-pack.json (small, in git) plus the free
// lichess daily API. This endpoint reports exactly that — instead of a
// mysterious number with no explanation.
import { NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { lichessAvailable, lichessCount } from '@/lib/server/lichess-bank'

export async function GET() {
  const packPath = path.join(process.cwd(), 'db', 'puzzle-pack.json')
  const packBytes = existsSync(packPath) ? statSync(packPath).size : 0
  const available = lichessAvailable()
  return NextResponse.json({
    source: 'pack+lichess-daily-api',
    available,
    count: available ? lichessCount() : 0,
    packFile: 'db/puzzle-pack.json',
    packBytes,
    daily: 'https://lichess.org/api/puzzle/daily (free, cached 6h, deterministic pack fallback)',
  })
}
