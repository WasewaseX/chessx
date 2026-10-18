// What's new shared server pieces: the reaction vocabulary, the anonymous
// voter identity, and DTO shaping used by every /api/changelog route.
import 'server-only'
import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { clientIp } from '@/lib/auth'
import { db } from '@/lib/db'
import type { ChangelogEntry, FeatureSuggestion } from '@prisma/client'

export const REACTION_EMOJIS = ['🎉', '❤️', '🧠', '🐸'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export type ReactionCounts = Record<ReactionEmoji, number>

export function isReactionEmoji(v: unknown): v is ReactionEmoji {
  return typeof v === 'string' && (REACTION_EMOJIS as readonly string[]).includes(v)
}

// Fixed server salt for anonymous reaction identity. The hash is one-way:
// the DB never stores raw ips, and changing the salt cleanly resets the
// anonymous electorate instead of leaking anything.
const REACTION_SALT = process.env.CHANGELOG_REACTION_SALT ?? 'chessx-whatsnew-reactions-v1'

/** sha256(ip + salt) — a stable per-address key that cannot be reversed. */
export function anonVoterKey(req: NextRequest): string {
  return createHash('sha256').update(`${clientIp(req)}:${REACTION_SALT}`).digest('hex')
}

/** Signed-in viewers react as their userId; anonymous ones as the ip hash. */
export function reactionVoterKey(req: NextRequest, user: { id: string } | null): string {
  return user ? user.id : anonVoterKey(req)
}

export function emptyReactionCounts(): ReactionCounts {
  return { '🎉': 0, '❤️': 0, '🧠': 0, '🐸': 0 }
}

/** Per-entry emoji tallies for the given entries; missing buckets stay zero. */
export async function reactionCountsFor(entryIds: string[]): Promise<Map<string, ReactionCounts>> {
  const counts = new Map<string, ReactionCounts>()
  for (const id of entryIds) counts.set(id, emptyReactionCounts())
  if (entryIds.length === 0) return counts
  const grouped = await db.changelogReaction.groupBy({
    by: ['entryId', 'emoji'],
    where: { entryId: { in: entryIds } },
    _count: { _all: true },
  })
  for (const g of grouped) {
    const bucket = counts.get(g.entryId)
    if (bucket && isReactionEmoji(g.emoji)) bucket[g.emoji] = g._count._all
  }
  return counts
}

/** Which emojis the viewer already used, per entry (for active styling). */
export async function myReactionsFor(
  entryIds: string[],
  voterKey: string,
): Promise<Map<string, ReactionEmoji[]>> {
  const mine = new Map<string, ReactionEmoji[]>()
  if (entryIds.length === 0) return mine
  const rows = await db.changelogReaction.findMany({
    where: { entryId: { in: entryIds }, voterKey },
    select: { entryId: true, emoji: true },
  })
  for (const row of rows) {
    if (!isReactionEmoji(row.emoji)) continue
    const list = mine.get(row.entryId) ?? []
    list.push(row.emoji)
    mine.set(row.entryId, list)
  }
  return mine
}

export function publicEntry(
  e: ChangelogEntry,
  counts: ReactionCounts,
  mine: ReactionEmoji[],
) {
  return {
    id: e.id,
    title: e.title,
    body: e.body,
    tag: e.tag,
    version: e.version,
    pinned: e.pinned,
    createdAt: e.createdAt,
    reactions: counts,
    mine,
  }
}

// Roadmap ladder minus declined: declined items are internal only.
export const SUGGESTION_STATUSES = ['open', 'planned', 'in_progress', 'shipped'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export function isSuggestionStatus(v: unknown): v is SuggestionStatus {
  return typeof v === 'string' && (SUGGESTION_STATUSES as readonly string[]).includes(v)
}

/** Board order: being built first, shipped history last, then votes, then age. */
export const STATUS_RANK: Record<SuggestionStatus, number> = {
  in_progress: 0,
  planned: 1,
  open: 2,
  shipped: 3,
}

export function publicSuggestion(s: FeatureSuggestion, viewerVoted: boolean) {
  return {
    id: s.id,
    title: s.title,
    detail: s.detail,
    status: s.status,
    votes: s.votes,
    authorName: s.authorName,
    createdAt: s.createdAt,
    viewerVoted,
  }
}
