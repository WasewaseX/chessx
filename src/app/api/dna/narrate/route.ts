import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, originOk, rateLimit } from '@/lib/auth'
import { runChat, getAiConfig } from '@/lib/ai'
import { coachMaybe } from '@/lib/coaches'
import { buildDnaReport } from '@/lib/server/chess-dna'

/**
 * The coach reads the player's Chess DNA back to them, in persona. The
 * prompt carries ONLY what the report actually measured — the model is
 * told explicitly never to invent numbers, so the narration stays as
 * honest as the bar charts it describes.
 */
export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (user.role !== 'admin' && !rateLimit(`dna-narrate:${user.id}`, 6, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const coach = coachMaybe(profile.coach) ?? coachMaybe('nina')!

  try {
    const report = await buildDnaReport(profile.id)
    if (!report.ready) {
      return NextResponse.json({ error: 'Your DNA report is not ready yet — analyze a few games first.' }, { status: 409 })
    }

    const measured = report.domains
      .map((d) => `${d.label}: ${d.score ?? 'not measurable yet'}${d.percentile != null ? ` (${d.percentile}th pct of ${report.population})` : ''}`)
      .join('\n')
    const system = [
      coach.systemLine,
      'You are reading the player their Chess DNA report — a five-domain skill profile computed from their own analyzed games.',
      'Rules: use ONLY the numbers given; never invent stats. Under 130 words, spoken, no headers, no lists, no markdown.',
      'Structure: name their archetype, say one real thing about their strongest domain, name the weakest honestly without softening it into nothing, then give exactly ONE concrete thing to work on this week (it must match the weakest domain).',
      'End on one short sentence of belief in them — in your own voice.',
    ].join(' ')

    const text = await runChat(
      await getAiConfig(profile.id),
      system,
      [
        {
          role: 'user',
          content: [
            `Player: ${profile.name}.`,
            report.archetype ? `Archetype: ${report.archetype.name} — ${report.archetype.tagline}` : '',
            `Strongest: ${report.strongest ?? 'n/a'}. Weakest: ${report.weakest ?? 'n/a'}.`,
            `Report: \n${measured}`,
            report.tip ? `Suggested training angle: ${report.tip}` : '',
            'Read them their DNA now.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      400,
    )

    return NextResponse.json({ text: text.trim(), coach: coach.id }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[dna-narrate] failed', e)
    return NextResponse.json({ error: 'Your coach could not read the report right now.' }, { status: 500 })
  }
}
