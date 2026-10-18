import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit } from '@/lib/auth'
import {
  ImportUpstreamError,
  TOTAL_BUDGET_MS,
  fetchChessComGames,
  fetchLichessGames,
  storeImportedGames,
} from '@/lib/server/import-games'

/**
 * Username-based bulk import: pulls a player's most recent games straight
 * from chess.com or lichess on the server and stores the ones the profile
 * does not have yet. Session required; 5 imports per minute per account.
 *
 * The route never blocks past ~25s: the helpers share a 22s deadline and a
 * 15s cap per upstream call, so the honest worst case is a 504, not a hang.
 */

const WINDOW_MS = 60_000
const LIMIT = 5

const CHESSCOM_NAME_RE = /^[A-Za-z0-9_-]+$/
/** URL-hostile or injection-ish characters, banned for both providers. */
const HOSTILE_RE = /[\s/\\?%#&'"<>;`|^!$*()[\]{},:=+\x00-\x1f\x7f]/

function sanitizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  while (s.startsWith('@')) s = s.slice(1)
  if (s.length < 2 || s.length > 30) return null
  if (HOSTILE_RE.test(s)) return null
  return s
}

function clampMonths(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(6, Math.floor(n)))
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to import games into your history.' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { platform?: unknown; username?: unknown; months?: unknown } | null

  const platform = body?.platform === 'chesscom' || body?.platform === 'lichess' ? body.platform : null
  if (!platform) {
    return NextResponse.json({ error: 'Choose a platform: "chesscom" or "lichess".' }, { status: 400 })
  }

  const username = sanitizeUsername(body?.username)
  if (!username) {
    return NextResponse.json(
      {
        error: 'Enter a username of 2-30 characters (letters, digits, "-" and "_").',
      },
      { status: 400 },
    )
  }
  if (platform === 'chesscom' && !CHESSCOM_NAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'chess.com usernames only use letters, digits, "-" and "_".' },
      { status: 400 },
    )
  }

  if (!rateLimit(`import-username:${user.id}`, LIMIT, WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many imports — wait a minute and try again.' },
      { status: 429 },
    )
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const months = clampMonths(body?.months)
  const deadline = Date.now() + TOTAL_BUDGET_MS

  let pgns: string[]
  try {
    pgns =
      platform === 'chesscom'
        ? await fetchChessComGames(username, months, deadline)
        : await fetchLichessGames(username, months, deadline)
  } catch (e) {
    if (e instanceof ImportUpstreamError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[import-username] unexpected upstream failure', e)
    return NextResponse.json(
      { error: `Could not reach ${platform === 'chesscom' ? 'chess.com' : 'lichess'} from the server. Try again shortly.` },
      { status: 502 },
    )
  }

  try {
    const stats = await storeImportedGames(profile.id, username, platform, pgns)
    return NextResponse.json({
      ok: true,
      platform,
      username,
      fetched: stats.fetched,
      imported: stats.imported,
      skipped: stats.skipped,
      months,
    })
  } catch (e) {
    console.error('[import-username] store failure', e)
    return NextResponse.json(
      { error: 'The games arrived, but saving them failed. Try again — duplicates are skipped automatically.' },
      { status: 500 },
    )
  }
}
