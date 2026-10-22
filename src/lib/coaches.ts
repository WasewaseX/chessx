// Coach roster: each coach has a face, a voice (spoken with the browser's
// native voice engine, see src/lib/speech.ts), a personality line
// used in AI prompts, and a range of tiers they specialize in.
import { voiceById, coachFromVoice } from '@/lib/coach/voices'

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
  /** Signature openings, surfaced on the picker and PREFERRED by the coach's
   *  opening book in Play with Coach (see coach-game-view pickBookMove).
   *  Every line is a full SAN sequence from the start position; each one is
   *  validated at module load so an illegal line can never reach the board. */
  repertoireLabel?: string
  repertoireLines?: string[][]
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
    repertoireLabel: 'Italian & classical development',
    repertoireLines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'd3', 'd6'],
      ['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3', 'c5'],
      ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'Bd3', 'c5'],
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],
    ],
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
    repertoireLabel: "King's Gambit, Scotch & open Sicilians",
    repertoireLines: [
      ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5', 'h4', 'g4', 'Ng5'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Qg6'],
      ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Bg4'],
      ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6'],
    ],
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
    repertoireLabel: "Queen's Gambit, English & King's Indian",
    repertoireLines: [
      ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bg5', 'O-O', 'e3', 'h6'],
      ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5'],
      ['e4', 'c6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Bg4'],
      ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
    ],
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
    repertoireLabel: "Ruy López, Najdorf & classical King's Indian",
    repertoireLines: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3'],
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be7'],
      ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7'],
      ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6'],
    ],
  },
]

export function coachById(id: string): Coach {
  // Coach voice packs (src/lib/coach/voices.ts) share the profile.coach field;
  // a voice id maps onto the Coach shape, everything else falls back as before.
  const voice = voiceById(id)
  if (voice) return coachFromVoice(voice)
  return COACHES.find((c) => c.id === id) ?? COACHES[0]
}

/** The chosen coach, or undefined when the player has not picked one yet. Never falls back silently. */
export function coachMaybe(id?: string | null): Coach | undefined {
  if (!id) return undefined
  const voice = voiceById(id)
  if (voice) return coachFromVoice(voice)
  return COACHES.find((c) => c.id === id)
}

/** The coach that best fits a tier number (1..6). */
export function coachForTier(tier: number): Coach {
  return COACHES.find((c) => tier >= c.tiers[0] && tier <= c.tiers[1]) ?? COACHES[0]
}
