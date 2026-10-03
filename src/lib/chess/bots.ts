export interface Bot {
  level: number
  name: string
  rating: number
  description: string
  avatar: string // initials shown on the plate
  color: string // avatar bg
  skill: number // UCI Skill Level 0-20
  depth: number // search depth cap
  blunder: number // 0-1 chance of playing a random legal move
  minTime: number // ms the bot "thinks" (ui pacing)
}

// Engine-powered opponents, ordered by strength.
export const BOTS: Bot[] = [
  {
    level: 1,
    name: 'Pip',
    rating: 350,
    description: 'Knows how the pieces move. Barely.',
    avatar: 'P',
    color: '#b0a089',
    skill: 0,
    depth: 1,
    blunder: 0.55,
    minTime: 400,
  },
  {
    level: 2,
    name: 'Maple',
    rating: 600,
    description: 'Grabs loose pieces but drops her own.',
    avatar: 'M',
    color: '#c98f4e',
    skill: 1,
    depth: 2,
    blunder: 0.35,
    minTime: 500,
  },
  {
    level: 3,
    name: 'Squire',
    rating: 800,
    description: 'Simple tactics, simple plans.',
    avatar: 'S',
    color: '#7fa650',
    skill: 3,
    depth: 4,
    blunder: 0.2,
    minTime: 600,
  },
  {
    level: 4,
    name: 'Sentry',
    rating: 1000,
    description: 'Watches the board. Punishes one-move threats.',
    avatar: 'S',
    color: '#5d9948',
    skill: 5,
    depth: 6,
    blunder: 0.12,
    minTime: 600,
  },
  {
    level: 5,
    name: 'Vanguard',
    rating: 1200,
    description: 'Solid club-level play. Castles on time.',
    avatar: 'V',
    color: '#4f8f4a',
    skill: 8,
    depth: 8,
    blunder: 0.06,
    minTime: 700,
  },
  {
    level: 6,
    name: 'Cornerstone',
    rating: 1400,
    description: 'Few mistakes, patient endgames.',
    avatar: 'C',
    color: '#3f7d8c',
    skill: 11,
    depth: 10,
    blunder: 0.03,
    minTime: 700,
  },
  {
    level: 7,
    name: 'Tactician',
    rating: 1600,
    description: 'Lives for forks, pins and skewers.',
    avatar: 'T',
    color: '#3c6e8f',
    skill: 14,
    depth: 12,
    blunder: 0,
    minTime: 800,
  },
  {
    level: 8,
    name: 'Strategist',
    rating: 1800,
    description: 'Plays the position, not just the move.',
    avatar: 'S',
    color: '#35597a',
    skill: 17,
    depth: 14,
    blunder: 0,
    minTime: 800,
  },
  {
    level: 9,
    name: 'Grandmaster',
    rating: 2100,
    description: 'Deep calculation. Do not hang anything.',
    avatar: 'G',
    color: '#5b4a68',
    skill: 20,
    depth: 16,
    blunder: 0,
    minTime: 900,
  },
  {
    level: 10,
    name: 'Maximum',
    rating: 2500,
    description: 'Full-strength engine. Good luck.',
    avatar: 'X',
    color: '#2b2b2b',
    skill: 20,
    depth: 20,
    blunder: 0,
    minTime: 1000,
  },
]

export function botForLevel(level: number): Bot {
  return BOTS[Math.min(Math.max(level, 1), BOTS.length) - 1]
}

// Closest bot to a given ladder rating — used for rated ladder games.
export function botForRating(rating: number): Bot {
  let best = BOTS[0]
  for (const b of BOTS) {
    if (Math.abs(b.rating - rating) < Math.abs(best.rating - rating)) best = b
  }
  return best
}
