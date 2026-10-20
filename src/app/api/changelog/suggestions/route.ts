// Feature suggestions — the public idea board behind "Roadmap & ideas".
//
//  GET  /api/changelog/suggestions[?status=open|planned|in_progress|shipped]
//         the board (max 30, declined excluded): roadmap status first, then
//         most votes, then newest. viewerVoted is computed at read time.
//  POST /api/changelog/suggestions  { title, detail }
//         signed-in players only. title 8-90 chars, detail 10-500 chars,
//         at most 3 open suggestions per profile (enforced, not decorative).
//         A new suggestion starts with the author's own vote (votes = 1).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, clientIp, originOk } from '@/lib/auth'
import {
  SUGGESTION_STATUSES,
  isSuggestionStatus,
  STATUS_RANK,
  publicSuggestion,
} from '@/lib/server/whatsnew'
import type { SuggestionStatus } from '@/lib/server/whatsnew'

const MAX_OPEN_PER_PROFILE = 3
const TITLE_MIN = 8
const TITLE_MAX = 90
const DETAIL_MIN = 10
const DETAIL_MAX = 500

const cleanStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  let viewerKey = clientIp(req)
  if (user) {
    const profile = await db.profile.findUnique({ where: { userId: user.id } })
    if (profile) viewerKey = profile.id // votes are keyed by profile id
  }

  if (!rateLimit(`changelog-sugg-get:${viewerKey}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const statusParam = req.nextUrl.searchParams.get('status')
  const statusFilter = statusParam && isSuggestionStatus(statusParam) ? statusParam : null

  const rows = await db.featureSuggestion.findMany({
    where: statusFilter ? { status: statusFilter } : { status: { in: [...SUGGESTION_STATUSES] } },
    orderBy: [{ votes: 'desc' }, { createdAt: 'desc' }],
    take: 30,
  })
  // Prisma cannot order by a custom status ladder — apply it here, keeping
  // votes-desc then newest inside each band.
  rows.sort((a, b) => {
    const rankDiff =
      (STATUS_RANK[a.status as SuggestionStatus] ?? 9) - (STATUS_RANK[b.status as SuggestionStatus] ?? 9)
    if (rankDiff !== 0) return rankDiff
    if (b.votes !== a.votes) return b.votes - a.votes
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  const ids = rows.map((r) => r.id)
  const votedIds = new Set<string>()
  if (ids.length > 0) {
    const voteRows = await db.suggestionVote.findMany({
      where: { suggestionId: { in: ids }, voterKey: viewerKey },
      select: { suggestionId: true },
    })
    for (const v of voteRows) votedIds.add(v.suggestionId)
  }

  return NextResponse.json({
    suggestions: rows.map((r) => publicSuggestion(r, votedIds.has(r.id))),
  })
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to suggest a feature' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  if (!rateLimit(`changelog-sugg-post:${pid}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  const title = cleanStr(body.title, TITLE_MAX + 1)
  if (!title || title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Title must be ${TITLE_MIN}-${TITLE_MAX} characters` },
      { status: 400 },
    )
  }
  const detail = cleanStr(body.detail, DETAIL_MAX + 1)
  if (!detail || detail.length < DETAIL_MIN || detail.length > DETAIL_MAX) {
    return NextResponse.json(
      { error: `Details must be ${DETAIL_MIN}-${DETAIL_MAX} characters` },
      { status: 400 },
    )
  }

  const openCount = await db.featureSuggestion.count({ where: { profileId: pid, status: 'open' } })
  if (openCount >= MAX_OPEN_PER_PROFILE) {
    return NextResponse.json(
      {
        error: `You already have ${MAX_OPEN_PER_PROFILE} open suggestions — wait until one moves up the roadmap before adding another`,
      },
      { status: 409 },
    )
  }

  const created = await db.$transaction(async (tx) => {
    const suggestion = await tx.featureSuggestion.create({
      data: { profileId: pid, authorName: profile.name, title, detail, votes: 1 },
    })
    await tx.suggestionVote.create({ data: { suggestionId: suggestion.id, voterKey: pid } })
    return suggestion
  })

  return NextResponse.json({ suggestion: publicSuggestion(created, true) }, { status: 201 })
}

// PATCH — admin-only roadmap triage: move a suggestion between columns
// (open → planned → in_progress → shipped, plus 'declined' to hide it).
// The board is public; this is the only hand that moves the cards.
export async function PATCH(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }
  if (!rateLimit(`changelog-sugg-patch:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id.slice(0, 64) : ''
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!id || !isSuggestionStatus(status)) {
    return NextResponse.json({ error: 'id and a valid status required' }, { status: 400 })
  }

  const updated = await db.featureSuggestion.update({
    where: { id },
    data: { status: status as SuggestionStatus },
  }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ suggestion: publicSuggestion(updated, false) })
}
