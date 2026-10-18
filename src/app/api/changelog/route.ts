// What's new API — the public changelog feed and its admin-only publisher.
//
//  GET  /api/changelog
//         newest entries (max 20), pinned first. Each carries reaction
//         counts plus the viewer's own reactions. Public: signed-in viewers
//         are keyed by userId, anonymous ones by a salted ip hash. No entries
//         → an empty list (the feed never invents content).
//  POST /api/changelog  { title, body, tag?, version?, pinned? }
//         publish an entry — admin accounts only (User.role === 'admin').
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk } from '@/lib/auth'
import {
  reactionCountsFor,
  reactionVoterKey,
  myReactionsFor,
  publicEntry,
  emptyReactionCounts,
} from '@/lib/server/whatsnew'

const TAGS = ['update', 'feature', 'fix', 'benchmark'] as const

const cleanStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  const viewerKey = reactionVoterKey(req, user)

  if (!rateLimit(`changelog-get:${viewerKey}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const entries = await db.changelogEntry.findMany({
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  })
  const ids = entries.map((e) => e.id)
  const [counts, mine] = await Promise.all([
    reactionCountsFor(ids),
    myReactionsFor(ids, viewerKey),
  ])

  return NextResponse.json({
    entries: entries.map((e) => publicEntry(e, counts.get(e.id) ?? emptyReactionCounts(), mine.get(e.id) ?? [])),
  })
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admin accounts can publish changelog entries' }, { status: 403 })
  }
  if (!rateLimit(`changelog-post:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  const title = cleanStr(body.title, 120)
  if (!title || title.length < 4) {
    return NextResponse.json({ error: 'title (4-120 characters) required' }, { status: 400 })
  }
  const text = cleanStr(body.body, 4000)
  if (!text || text.length < 4) {
    return NextResponse.json({ error: 'body (4-4000 characters) required' }, { status: 400 })
  }
  const tagInput = typeof body.tag === 'string' && body.tag.trim() !== '' ? body.tag : 'update'
  if (!(TAGS as readonly string[]).includes(tagInput)) {
    return NextResponse.json({ error: `tag must be one of: ${TAGS.join(', ')}` }, { status: 400 })
  }
  // version stays a short label, nothing else is read from it
  const version = cleanStr(body.version, 24)
  const pinned = body.pinned === true

  const entry = await db.changelogEntry.create({
    data: { title, body: text, tag: tagInput, version, pinned },
  })
  return NextResponse.json({ entry: publicEntry(entry, emptyReactionCounts(), []) }, { status: 201 })
}
