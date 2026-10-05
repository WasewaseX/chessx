// Dev-only helper: print compact per-level summaries to decide concept tags.
// Run: bun run scripts/summarize-levels.ts [tierId]
import { TIERS } from '../src/content/levels'

const arg = process.argv[2]
for (const tier of TIERS) {
  if (arg && tier.id !== arg) continue
  console.log(`\n=== ${tier.id} ===`)
  for (const level of tier.levels) {
    console.log(`\n${level.id} [${level.n}] ${level.title} :: ${level.subtitle}`)
    for (const s of level.steps) {
      const body = (s as { body?: unknown }).body
      let detail = ''
      if (Array.isArray(body)) detail = String(body[0] ?? '').slice(0, 110)
      else if (typeof body === 'string') detail = body.slice(0, 110)
      const extra =
        'solution' in s && Array.isArray(s.solution)
          ? ` sol=[${s.solution.join(' ')}]`
          : 'moves' in s && Array.isArray(s.moves)
            ? ` mv=${s.moves.map((m) => (typeof m === 'string' ? m : (m as { san?: string }).san)).slice(0, 4).join(' ')}`
            : 'goal' in s && typeof s.goal === 'string'
              ? ` goal=${s.goal.slice(0, 60)}`
              : ''
      console.log(`  - ${s.type}: "${s.title}" ${detail}${extra}`)
    }
  }
}
