// GET /api/public/puzzles?rating=1200&themes=mate,fork — a spoiler-free
// window into the Lichess bank: ten sanitized rows around the requested
// rating (server clamps 600-2800), optionally filtered by up to five theme
// ids. 404 when the bank is not installed — never a fake empty list.
import { NextRequest, NextResponse } from 'next/server'
import { preflight, sanitizePuzzle, withPublic } from '@/lib/server/public-api'
import { lichessAvailable, lichessCount, lichessWindow } from '@/lib/server/lichess-bank'

const PAGE = 10
const MAX_THEMES = 5

export async function GET(req: NextRequest) {
  return withPublic(req, async () => {
    if (!lichessAvailable()) {
      return NextResponse.json({ error: 'puzzle bank not installed' }, { status: 404 })
    }
    const sp = req.nextUrl.searchParams
    const rating = Math.round(Number(sp.get('rating') ?? '1200')) || 1200
    const themes = (sp.get('themes') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, MAX_THEMES)
    const rows = lichessWindow(rating, PAGE, themes).map(sanitizePuzzle)
    return NextResponse.json({ count: rows.length, puzzles: rows, totalAvailable: lichessCount() })
  })
}

export function OPTIONS() {
  return preflight()
}
