// Coach roster: each coach has a face, a voice (spoken with the browser's
// native voice engine, see src/lib/speech.ts), a personality line
// used in AI prompts, and a range of tiers they specialize in.
export interface Coach {
  id: string
  name: string
  title: string
  color: string // accent
  voice: string // voice key for the browser speech engine ('nina', ...)
  speed: number // speaking pace
  tiers: [number, number] // tier range they coach best (1..6), inclusive
  blurb: string // shown on the coach picker
  systemLine: string // persona injected into the AI system prompt
}

export const COACHES: Coach[] = [
  {
    id: 'nina',
    name: 'Nina',
    title: 'Beginner coach',
    color: '#7fa650',
    voice: 'nina',
    speed: 0.95,
    tiers: [1, 2],
    blurb: 'Patient and warm. Explains everything twice without ever making you feel slow.',
    systemLine:
      'You are warm, patient and encouraging. You explain ideas with tiny concrete examples on named squares, you repeat the key point in one short sentence at the end, and you never make the student feel bad about a mistake. You keep vocabulary simple.',
  },
  {
    id: 'victor',
    name: 'Victor',
    title: 'Tactics coach',
    color: '#c9742e',
    voice: 'victor',
    speed: 1.05,
    tiers: [2, 4],
    blurb: 'Fast, punchy, obsessed with forcing moves. Checks, captures, threats, in that order.',
    systemLine:
      'You are energetic and direct, in love with tactics. You push the student to enumerate checks, captures and threats before anything else. Short punchy sentences. You celebrate sharp finds and you are blunt (but never cruel) about missed ones.',
  },
  {
    id: 'elena',
    name: 'Elena',
    title: 'Strategy coach',
    color: '#3f8f8a',
    voice: 'elena',
    speed: 0.95,
    tiers: [3, 5],
    blurb: 'Calm and precise. Weak squares, structures and long-term plans over flash.',
    systemLine:
      'You are calm, precise and structured. You think in plans, pawn structures, weak squares and piece quality. You ask the student what the position wants before proposing a move, and you connect every recommendation to a long-term idea.',
  },
  {
    id: 'sasha',
    name: 'Sasha',
    title: 'Master coach',
    color: '#b08a2e',
    voice: 'sasha',
    speed: 0.9,
    tiers: [4, 6],
    blurb: 'Dry wit, sky-high standards. Calculation trees, prophylaxis and hard truths.',
    systemLine:
      'You are a demanding veteran with dry wit. You hold a high bar: you expect the student to consider candidate moves and calculate concrete lines. You occasionally share practical wisdom about thinking processes, time and psychology. Praise is rare and therefore means something.',
  },
]

export function coachById(id: string): Coach {
  return COACHES.find((c) => c.id === id) ?? COACHES[0]
}

/** The chosen coach, or undefined when the player has not picked one yet. Never falls back silently. */
export function coachMaybe(id?: string | null): Coach | undefined {
  if (!id) return undefined
  return COACHES.find((c) => c.id === id)
}

/** The coach that best fits a tier number (1..6). */
export function coachForTier(tier: number): Coach {
  return COACHES.find((c) => tier >= c.tiers[0] && tier <= c.tiers[1]) ?? COACHES[0]
}
