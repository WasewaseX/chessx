export interface Bot {
  level: number
  id: string // face file: /bots/<id>.png
  name: string
  rating: number
  description: string
  color: string // accent (fallback plate color)
  skill: number // UCI Skill Level 0-20
  depth: number // search depth cap
  blunder: number // 0-1 chance of playing a random legal move
  minTime: number // ms the bot "thinks" (ui pacing)
  style: string // how they play, shown in the lobby
  barks: {
    greet: string[]
    playerGood: string[] // player just won material
    playerBlunder: string[] // player just dropped material
    win: string[] // bot won
    lose: string[] // bot lost
    draw: string[]
  }
}

// Engine-powered opponents with faces and personalities, ordered by strength.
export const BOTS: Bot[] = [
  {
    level: 1,
    id: 'pip',
    name: 'Pip',
    rating: 350,
    description: 'Knows how the pieces move. Barely.',
    color: '#b0a089',
    skill: 0,
    depth: 1,
    blunder: 0.55,
    minTime: 400,
    style: 'Plays on pure vibes, forgets pieces exist.',
    barks: {
      greet: ['Hi hi! I am SO ready. I think.', 'I learned chess yesterday!'],
      playerGood: ['Whoa. That was big.', 'Wait, can you do that?'],
      playerBlunder: ['Ooh, shiny!', 'I take it? I take it.'],
      win: ['I won?! I actually won!', 'Pip the pawn slayer!'],
      lose: ['Good game! Teach me that trick.', 'I almost had it. Almost.'],
      draw: ['A tie? Is that good?'],
    },
  },
  {
    level: 2,
    id: 'maple',
    name: 'Maple',
    rating: 600,
    description: 'Grabs loose pieces but drops her own.',
    color: '#c98f4e',
    skill: 1,
    depth: 2,
    blunder: 0.35,
    minTime: 500,
    style: 'Hoards pawns like jam jars, forgets her king.',
    barks: {
      greet: ['Sit down, dear. Tea is brewing.', 'Mind the pawns, they are my babies.'],
      playerGood: ['Oh my. That was tidy.', 'You took my jam jar!'],
      playerBlunder: ['I will have that, thank you.', 'Careless, dearie.'],
      win: ['Grandma still has it!', 'Another jar for the shelf.'],
      lose: ['Well played, sweetheart.', 'My pawns fought bravely.'],
      draw: ['Split the pot, as they say.'],
    },
  },
  {
    level: 3,
    id: 'squire',
    name: 'Squire',
    rating: 800,
    description: 'Simple tactics, simple plans.',
    color: '#7fa650',
    skill: 3,
    depth: 4,
    blunder: 0.2,
    minTime: 600,
    style: 'Charges forward first, thinks second.',
    barks: {
      greet: ['Squire reporting for duty!', 'For the board! For glory!'],
      playerGood: ['A solid blow. Respect.', 'My flank! My flank!'],
      playerBlunder: ['The knight strikes!', 'Gotcha!'],
      win: ['The squire prevails!', 'Victory tastes like iron.'],
      lose: ['Worthy opponent. I bow.', 'Back to training.'],
      draw: ['No victor today.'],
    },
  },
  {
    level: 4,
    id: 'rex',
    name: 'Rex',
    rating: 950,
    description: 'Attacks everything, defends nothing.',
    color: '#c04a3a',
    skill: 4,
    depth: 5,
    blunder: 0.16,
    minTime: 550,
    style: 'All-out aggression, every single game.',
    barks: {
      greet: ['Grrr. Let us fight.', 'I smell fear. Or a sandwich.'],
      playerGood: ['Bite blocked. Angry now.', 'Lucky shot.'],
      playerBlunder: ['CHOMP.', 'Too slow!'],
      win: ['WHO IS THE GOOD BOY NOW.', 'Crowned and victorious.'],
      lose: ['Grrr. Rematch. NOW.', 'I demand a belly rub.'],
      draw: ['A draw? Boring.'],
    },
  },
  {
    level: 5,
    id: 'sentry',
    name: 'Sentry',
    rating: 1100,
    description: 'Watches the board. Punishes one-move threats.',
    color: '#5d9948',
    skill: 6,
    depth: 6,
    blunder: 0.1,
    minTime: 600,
    style: 'Never attacks first. Never misses yours.',
    barks: {
      greet: ['All quiet on my side.', 'I see everything, you know.'],
      playerGood: ['Noted. Adjusting.', 'A real threat. Finally.'],
      playerBlunder: ['Nothing gets past the watch.', 'You left a door open.'],
      win: ['The watch never sleeps.', 'Calmly done.'],
      lose: ['You outwatched the watcher.', 'I saw it coming. Almost.'],
      draw: ['The night holds.'],
    },
  },
  {
    level: 6,
    id: 'vanguard',
    name: 'Vanguard',
    rating: 1250,
    description: 'Solid club-level play. Castles on time.',
    color: '#4f8f4a',
    skill: 8,
    depth: 8,
    blunder: 0.06,
    minTime: 700,
    style: 'Textbook development, no experiments.',
    barks: {
      greet: ['Formation first. Then blood.', 'Standard opening protocol.'],
      playerGood: ['Clean technique.', 'You read my plan.'],
      playerBlunder: ['That costs you a pawn. Or more.', 'Discipline wins.'],
      win: ['Order over chaos.', 'The plan held.'],
      lose: ['Your initiative beat my structure.', 'Well executed.'],
      draw: ['A fair contest.'],
    },
  },
  {
    level: 7,
    id: 'fortress',
    name: 'Fortress',
    rating: 1400,
    description: 'Few mistakes, patient endgames.',
    color: '#8a8a80',
    skill: 10,
    depth: 9,
    blunder: 0.04,
    minTime: 700,
    style: 'Builds walls, waits, wins slowly.',
    barks: {
      greet: ['My walls are high. Climb if you dare.', 'Patience is a weapon.'],
      playerGood: ['A crack in the stone. Impressive.', 'You hammer well.'],
      playerBlunder: ['The gate was open all along.', 'Storms break on walls.'],
      win: ['The fortress stands.', 'Slow. Steady. Stone.'],
      lose: ['Even stone erodes.', 'You starved me out. Respect.'],
      draw: ['A siege without end.'],
    },
  },
  {
    level: 8,
    id: 'cornerstone',
    name: 'Cornerstone',
    rating: 1550,
    description: 'Positional grinder, converts small edges.',
    color: '#3f7d8c',
    skill: 12,
    depth: 10,
    blunder: 0.02,
    minTime: 750,
    style: 'Wins +0.5 advantages like a craftsman.',
    barks: {
      greet: ['Small edges. Big results.', 'Let us measure, then build.'],
      playerGood: ['A quality move. Careful.', 'You build well.'],
      playerBlunder: ['Your foundation slipped.', 'Hairline cracks decide buildings.'],
      win: ['Craft over flash.', 'Every block in place.'],
      lose: ['Better mason today. You.', 'The blueprint failed. Interesting.'],
      draw: ['Perfectly balanced structures.'],
    },
  },
  {
    level: 9,
    id: 'tactician',
    name: 'Tactician',
    rating: 1700,
    description: 'Lives for forks, pins and skewers.',
    color: '#c9742e',
    skill: 14,
    depth: 12,
    blunder: 0,
    minTime: 800,
    style: 'Sees combinations two moves before you do.',
    barks: {
      greet: ['Checks, captures, threats. Your funeral.', 'Every move is a trap today.'],
      playerGood: ['Sharp. Very sharp.', 'You saw my combination first.'],
      playerBlunder: ['Fork. Pin. Game.', 'Did you count defenders?'],
      win: ['Tactics is 99 percent of chess. And I studied.', 'Checkmate by mathematics.'],
      lose: ['You calculated deeper. Rare.', 'Outplayed. I will dissect it later.'],
      draw: ['Perpetual annoyance, I respect it.'],
    },
  },
  {
    level: 10,
    id: 'strategist',
    name: 'Strategist',
    rating: 1850,
    description: 'Plays the position, not just the move.',
    color: '#35597a',
    skill: 16,
    depth: 13,
    blunder: 0,
    minTime: 800,
    style: 'Long plans, weak squares, slow strangulation.',
    barks: {
      greet: ['Every position has a plan. Do you know yours?', 'We play the board, 64 squares at a time.'],
      playerGood: ['Positionally sound. Worrisome.', 'You fight for squares, not pieces. Good.'],
      playerBlunder: ['That square is now mine forever.', 'Structural damage. Enjoy.'],
      win: ['The plan completed itself.', 'Strategy outlives tactics.'],
      lose: ['Your initiative overran my plan.', 'A lesson in dynamics. Thank you.'],
      draw: ['Equal structures. Honest result.'],
    },
  },
  {
    level: 11,
    id: 'nyx',
    name: 'Nyx',
    rating: 2000,
    description: 'Quiet, deep, ruthless in the dark.',
    color: '#2f2f38',
    skill: 18,
    depth: 14,
    blunder: 0,
    minTime: 850,
    style: 'Says little. Calculates much.',
    barks: {
      greet: ['...', 'The night is long. Your position is shorter.'],
      playerGood: ['Interesting.', 'Hm.'],
      playerBlunder: ['As foreseen.', 'Shadows take that.'],
      win: ['The dark closes in.', '...'],
      lose: ['Light finds a way. Today.', 'You saw through the dark.'],
      draw: ['Neither light nor dark.'],
    },
  },
  {
    level: 12,
    id: 'grandmaster',
    name: 'Grandmaster',
    rating: 2150,
    description: 'Deep calculation. Do not hang anything.',
    color: '#5b4a68',
    skill: 19,
    depth: 16,
    blunder: 0,
    minTime: 900,
    style: 'Plays like a titled professional, endgame included.',
    barks: {
      greet: ['Show me something I have not seen.', 'I have played this game for centuries. Prove me old.'],
      playerGood: ['A master touch.', 'That belongs in a textbook.'],
      playerBlunder: ['In my head, that move lost already.', 'Amateurs capture. Masters calculate.'],
      win: ['Textbook. Read it again.', 'The difference is the last ten percent.'],
      lose: ['You played the last ten percent.', 'I tip my hat. Once.'],
      draw: ['A grandmaster draw. How fitting.'],
    },
  },
  {
    level: 13,
    id: 'titan',
    name: 'Titan',
    rating: 2350,
    description: 'Crushing endgames, ice-cold technique.',
    color: '#4a4a52',
    skill: 20,
    depth: 17,
    blunder: 0,
    minTime: 950,
    style: 'Reaches an edge and never lets go.',
    barks: {
      greet: ['I do not blunder. I do not forgive.', 'Bring a real fight or bring a snack.'],
      playerGood: ['You found a seam in the armor.', 'A real move. Noted.'],
      playerBlunder: ['The mountain does not blink.', 'Gravity does the rest.'],
      win: ['Crushed. Methodically.', 'Technique is destiny.'],
      lose: ['You moved a mountain. Take the crown.', 'Impossible. Impressive.'],
      draw: ['Immovable meets unstoppable.'],
    },
  },
  {
    level: 14,
    id: 'maximum',
    name: 'Maximum',
    rating: 2600,
    description: 'Full-strength engine. Good luck.',
    color: '#1f1f22',
    skill: 20,
    depth: 20,
    blunder: 0,
    minTime: 1000,
    style: 'No personality. No mercy. Just precision.',
    barks: {
      greet: ['EVALUATION: HOPELESS. FOR YOU.', 'Searching depth 20. Take your time.'],
      playerGood: ['MOVE QUALITY: ACCEPTABLE.', 'DEVIATION FROM BEST: MINOR.'],
      playerBlunder: ['MATERIAL DIFFERENTIAL: FATAL.', 'ERROR LOG UPDATED.'],
      win: ['OUTCOME: CALCULATED.', 'HUMANS ARE APPROXIMATIONS.'],
      lose: ['ANOMALY. RECALIBRATING.', 'STATISTICALLY IMPLAUSIBLE. YET LOGGED.'],
      draw: ['EQUILIBRIUM REACHED.'],
    },
  },
]

export function botForLevel(level: number): Bot {
  return BOTS[Math.min(Math.max(level, 1), BOTS.length) - 1]
}

// Closest bot to a given ladder rating, used for rated ladder games.
export function botForRating(rating: number): Bot {
  let best = BOTS[0]
  for (const b of BOTS) {
    if (Math.abs(b.rating - rating) < Math.abs(best.rating - rating)) best = b
  }
  return best
}

export function pickBark(list: string[], avoid?: string): string {
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  let bark = list[Math.floor(Math.random() * list.length)]
  let tries = 0
  while (bark === avoid && tries < 4) {
    bark = list[Math.floor(Math.random() * list.length)]
    tries++
  }
  return bark
}
