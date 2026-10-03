// Tier 5: Master. Imbalances, prophylaxis, initiative, deep technique.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const master: Tier = {
  id: 'master',
  n: 5,
  title: 'Master',
  tagline: 'Imbalances, prophylaxis, initiative, professional technique.',
  color: '#b0483a',
  levels: [
    {
      id: 'ms-01',
      n: 1,
      title: 'Thinking in imbalances',
      subtitle: 'Stop counting. Start comparing.',
      minutes: 10,
      steps: [
        text(
          'The six comparisons',
          [
            'Masters do not evaluate by points. They compare: material, space, development, king safety, pawn structure, and piece activity. Every position leans one way on some of these and the other way on the rest.',
            'Your plan comes from YOUR favorable imbalance. Space advantage: maneuver and press. Better structure: trade pieces and simplify into the endgame. Development lead: open the center and hit now.',
          ],
          'Find the imbalance you own. Your plan is inside it.',
        ),
        demo(
          'Reading a real position',
          ['Equal material. White owns more space (d4, e4) and the bishop pair is coming. Black\u2019s compensation: solid structure and no weaknesses. White\u2019s plan: expand; Black\u2019s: trade and hold.'],
          'r1bq1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 8',
          {
            marks: [
              { square: 'd4', color: 'green' },
              { square: 'e4', color: 'green' },
              { square: 'd5', color: 'yellow' },
            ],
            caption: 'Green: White\u2019s space. Yellow: Black\u2019s fortress.',
          },
        ),
        quiz('Plan from imbalance', 'You have the better pawn structure but less space. Your best strategy?', [
          right('Trade pieces, keep pawns, steer to an endgame', 'Structure wins endgames. Space wins middlegames. Choose your battlefield.'),
          wrong('Storm the enemy king with pawns', 'Less space means less room for a storm.'),
          wrong('Avoid all trades and maneuver forever', 'Maneuvering in less space is losing the position slowly.'),
        ]),
        quiz('Space advantage plan', 'You own more space on the queenside. Your pieces should generally...', [
          right('Maneuver for better squares and eventually break with pawns there', 'Space means freedom to redeploy. Use it before trading it away.'),
          wrong('Trade two pairs of minor pieces immediately', 'Trades shrink the position. Space wants pieces on the board.'),
          wrong('Attack the enemy king at once', 'Attacks need pieces pointed at the king. Yours are on the other wing.'),
        ]),
      ],
    },
    {
      id: 'ms-02',
      n: 2,
      title: 'Prophylaxis',
      subtitle: 'Ask what he wants. Take it away first.',
      minutes: 10,
      steps: [
        text(
          'The master question',
          [
            'Beginners ask: what do I want to do? Masters also ask: what does my opponent want to do, and which of his ideas actually works? Prophylaxis is playing the move that removes the opponent\u2019s best plan, often before starting your own.',
            'The strongest prophylactic moves are quiet: a rook sliding to cover a square, a pawn blocking a file. They feel like nothing and they decide everything, because chess is played against a person with a plan.',
          ],
          'Every move: what does he want? Kill it, then play your idea.',
        ),
        demo(
          'The quiet block',
          ['Black\u2019s queen eyes b1: check along the first rank. Rc1 ends that idea before it exists. Nothing happens on the board, and everything changes.'],
          '4k3/8/8/8/8/8/1q6/R3K3 w - - 0 1',
          { marks: [{ square: 'b1', color: 'red' }], caption: 'Red: the threat. Rc1 erases it.' },
        ),
        drill('Remove the threat', '4k3/8/8/8/8/8/1q6/R3K3 w - - 0 1', ['Rc1'], 'Black threatens Qb1+. Take the idea off the board', 'The c1 square sits between the queen and your king\u2019s rank.', 'Rc1. Prophylaxis: the threat was real and now it is fiction.'),
        quiz('Prophylaxis trigger', 'When is a prophylactic move worth a full tempo over your own plan?', [
          right('When the opponent\u2019s idea, if allowed, is stronger than yours', 'Removing their best plan IS the move.'),
          wrong('Never, always push your plan', 'That is how attacks run into counterattacks.'),
          wrong('Only when losing', 'Prophylaxis wins positions, not just saves them.'),
        ]),
      ],
    },
    {
      id: 'ms-03',
      n: 3,
      title: 'The initiative',
      subtitle: 'Spend material. Buy the tempo that mates.',
      minutes: 10,
      steps: [
        text(
          'The only currency that matters',
          [
            'The initiative is the right to keep asking questions. While you check, capture and threaten, the opponent answers; their plans rot on the bench.',
            'Material can buy initiative: sacrifice a pawn or piece to seize open lines and forcing sequences. The price is acceptable when the opponent never gets a single free move until the position is won. The moment your attack requires TWO quiet moves in a row, the initiative is gone.',
          ],
          'Spend money, not tempo. Every move must ask a question.',
        ),
        demo('Buying the mate', ['Qd8+ hands over a queen but asks a question the opponent cannot refuse. Bxd8 is forced; Re8 is mate. The initiative paid.'], 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', {
          moves: ['Qd8+', 'Bxd8', 'Re8#'],
          caption: 'Material spent, initiative cashed',
        }),
        drill('Stay forcing', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Convert the initiative into mate in three', 'Every move must be a check or a threat. No pauses.', 'Check, forced reply, mate. Not one free tempo for the opponent. That is what initiative looks like.'),
        quiz('Initiative check', 'Your attack has won a pawn but now needs two quiet regrouping moves. What happened?', [
          right('The initiative is over. Consolidate before continuing', 'Attacks live on forcing moves. Two quiet moves hand the baton back.'),
          wrong('The attack is fine, keep going', 'Without checks or threats there is no attack. Only hope.'),
          wrong('Sacrifice more pieces', 'Sacrifices buy tempo only when they force replies. Otherwise they are donations.'),
        ]),
      ],
    },
    {
      id: 'ms-04',
      n: 4,
      title: 'Majorities and the minority attack',
      subtitle: 'Pawn geography decides plans.',
      minutes: 10,
      steps: [
        text(
          'Counting pawn armies',
          [
            'A pawn majority attacks: it creates a passed pawn where the enemy has fewer pawns. The minority attack is the mirror trick: with two pawns against three on one wing, you advance the two (b4-b5) to FIX the enemy pawns on weakened squares and open lines for your rooks.',
            'The Carlsbad structure is the classic classroom: White\u2019s plan is b4-b5 against c6; Black\u2019s plan is the e5 or f5 strike for kingside space. Know which side of the board your pawns have booked.',
          ],
          'Majorities create passers. Minorities create files. Both are plans.',
        ),
        demo('The Carlsbad classroom', ['The classical structure: White attacks the base of Black\u2019s queenside chain with b4-b5; Black builds kingside space with f5. Two plans, two wings, one board.'], 'r1bq1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 8', {
          marks: [
            { square: 'b4', color: 'green' },
            { square: 'b5', color: 'green' },
            { square: 'f5', color: 'yellow' },
          ],
          caption: 'Green: White\u2019s minority attack. Yellow: Black\u2019s strike.',
        }),
        quiz('Minority attack goal', 'Why does White play b4-b5 against a queenside majority?', [
          right('To fix a pawn on c6 (a weak square target) and open the b-file for rooks', 'The attack creates weakness and files, not necessarily passers.'),
          wrong('To create a passed b-pawn', 'Three black pawns beat two. The passer dream is the wrong tool here.'),
          wrong('To win material immediately', 'It is a positional lever. The loot is squares and files.'),
        ]),
        quiz('Majority plan', 'You have a healthy kingside majority (f2, g2, h2 vs his g7 only). The plan?', [
          right('Push the majority to create a passed pawn, supported by the king', 'Majorities are passers in training. Push them when the pieces are settled.'),
          wrong('Trade all pawns on the kingside', 'Trading away the majority donates the endgame.'),
          wrong('Ignore pawns, attack with pieces', 'Pieces plus a passed pawn win games. The pawn is the plan.'),
        ]),
      ],
    },
    {
      id: 'ms-05',
      n: 5,
      title: 'Permanent versus temporary',
      subtitle: 'Which weaknesses can outlive this attack?',
      minutes: 10,
      steps: [
        text(
          'The mortgage versus the loan',
          [
            'Temporary weaknesses die when the attacking pieces go home: a loose piece, a temporarily misplaced knight, a hanging pawn that can be defended later. Permanent weaknesses are structural: doubled, isolated, backward pawns and broken king walls. Pawns never move back, so pawns decide what is permanent.',
            'Winning strategy: collect permanent weaknesses early (they pay interest every move), and never buy one yourself unless the dynamic compensation is overwhelming and temporary in your favor.',
          ],
          'Pawns are mortgages. Pieces are loans. Know which you are signing.',
        ),
        demo('Forever weak', ['The black d5 pawn will need a bodyguard every single move for the rest of the game. Compare that with the loose knight: it moves and the problem vanishes.'], '3k4/8/8/3p4/8/8/8/R3K3 w - - 0 1', {
          marks: [
            { square: 'd5', color: 'red' },
            { square: 'd6', color: 'yellow' },
          ],
          caption: 'Red: permanent. The parking square is forever.',
        }),
        quiz('Weakness shelf life', 'Which weakness can your opponent fix by moving a piece?', [
          right('A hanging piece: temporary', 'One move and it is gone. Structure outlives every tactic.'),
          wrong('A doubled pawn', 'Pawns cannot merge back. Permanent.'),
          wrong('An isolated pawn', 'No neighbor, no pawn defense, ever. Permanent.'),
        ]),
        quiz('Buying weakness', 'When is it correct to accept a permanent structural weakness?', [
          right('When you get overwhelming dynamic compensation that converts before the weakness matters', 'Mortgages are fine when you win the lottery this move.'),
          wrong('Never, structure is everything', 'Structure is a lot, not everything. Initiative can be a bigger deal.'),
          wrong('Whenever you feel aggressive', 'Feelings are not compensation. Concrete lines are.'),
        ]),
      ],
    },
    {
      id: 'ms-06',
      n: 6,
      title: 'Trading with intent',
      subtitle: 'Which pieces stay, which pieces go, and why.',
      minutes: 10,
      steps: [
        text(
          'The trade interview',
          [
            'Before any trade, ask three questions: after the trade, whose remaining pieces are better? Whose king is safer? Whose structure survives the endgame better? A trade is a vote for the resulting position.',
            'The side with better pieces REFUSES trades; the side with worse pieces BEGS for them. This one rule explains ninety percent of grandmaster middlegames: watch them spend tempi AVOIDING exchanges while ahead in activity.',
          ],
          'Every trade is a vote for the next position. Vote carefully.',
        ),
        drill('Vote to win', '4k3/8/8/8/3b4/5N2/8/4K3 w - - 0 1', ['Nxd4'], 'His bishop outperforms your knight. Decide the trade.', 'The knight on f3 reaches d4. Take the better piece and call it even.', 'Nxd4. The bishop was his best piece. Even trade, better position for you.'),
        quiz('Refusing trades', 'You have the more active pieces. Your opponent offers a bishop trade. You should generally...', [
          right('Decline and keep the activity', 'Activity is your imbalance. Trading it away donates the plan.'),
          wrong('Accept, material is equal anyway', 'Equal material, unequal positions. The position is what matters.'),
          wrong('Accept only if losing', 'Backwards. The LOSING side wants the trades.'),
        ]),
        quiz('Trading pieces vs pawns', 'You are up a piece in a middlegame. The standard trade policy is...', [
          right('Trade pieces, keep pawns', 'Fewer enemy pieces means less counterplay. Pawns are the winning margin.'),
          wrong('Trade pawns, keep pieces', 'Open lines favor the side hunting compensation.'),
          wrong('Trade everything, anything', 'Indiscriminate trading is not a policy. Direction is.'),
        ]),
      ],
    },
    {
      id: 'ms-07',
      n: 7,
      title: 'Owning the color',
      subtitle: 'Deep color complexes: plan by square color.',
      minutes: 10,
      steps: [
        text(
          'The board in two colors',
          [
            'Beyond weak color complexes: color control is a positive plan. Park your pieces where the enemy pawns cannot chase them, and aim at squares of the color your opponent\u2019s remaining bishop cannot defend.',
            'If he keeps only a dark-squared bishop, your light-squared bishop and light-square outposts face no resistance of the same kind. Build your attack on HIS missing color.',
          ],
          'His missing color is your highway. Drive on it.',
        ),
        drill('Invade the dark squares', '6k1/8/8/8/8/8/3B2PP/4B1K1 w - - 0 1', ['Bh6'], 'Black has no dark-squared defender. Plant the bishop deep.', 'The d2 bishop travels d2-e3-f4-g5-h6.', 'Bh6. The dark squares are yours. g7 and f8 now live in fear.'),
        quiz('Color targeting', 'The enemy kept only a light-squared bishop. Your invasion force should be...', [
          right('Dark-squared pieces heading for dark squares', 'His bishop is blind to everything on dark squares.'),
          wrong('Light-squared pieces', 'Those meet his bishop head on. Why fight the one defender he has?'),
          wrong('Pawns of either color', 'Pawns are color-bound too. Plan the invasion in color.'),
        ]),
        quiz('Bishop pair and color', 'You hold both bishops against one. Your long-term plan?', [
          right('Open the position and keep the pair alive: they cover every square color', 'The pair earns its half point in open positions with targets on both colors.'),
          wrong('Trade one bishop early to simplify', 'That donates the very advantage you own.'),
          wrong('Lock the center closed', 'Closed centers mute both bishops. The pair wants air.'),
        ]),
      ],
    },
    {
      id: 'ms-08',
      n: 8,
      title: 'Blockade as a strategy',
      subtitle: 'Passed pawns are prisoners if you hold the square.',
      minutes: 10,
      steps: [
        text(
          'Arrest, then attack elsewhere',
          [
            'A well-blockaded passed pawn is not a weakness for the blockading side: it is a target that CANNOT run, defended by pieces you can outplay. Nimzowitsch: first restrain, then blockade, then destroy.',
            'Meanwhile the blockading knight often sits on a gorgeous outpost in front of the enemy passer, winning material elsewhere. One piece holds two jobs: jailer and attacker.',
          ],
          'Restrain. Blockade. Destroy. In that order.',
        ),
        drill('The perfect jailer', '4k3/2p1p3/8/8/8/8/8/1N2K3 w - - 0 1', ['Nc3', 'Kd7', 'Nd5'], 'March the knight to the central outpost', 'Two hops to d5, the square no pawn can touch.', 'Nd5. From here the knight polices the whole board. The pawns on c7 and e7 will never bother him.'),
        quiz('Blockade choice', 'An enemy pawn is about to run on d4. The best blockader is...', [
          right('A knight, on d4 or the square in front', 'Knights blockade best and thrive on the outpost.'),
          wrong('The queen', 'Your best piece ends up babysitting. Wrong trade of roles.'),
          wrong('A pawn of yours', 'Pawns cannot stand in front of an enemy pawn on the same file and stop it: they just get captured or traded.'),
        ]),
        quiz('Restrain first', 'The enemy pawn just became passed on d4. The Nimzowitsch order of operations is...', [
          right('Restrain it, blockade it with a piece, then destroy the blockaded pile', 'First stop the runner, then jail it, then win it. Skipping steps loses.'),
          wrong('Capture it immediately with a piece', 'The pieces behind it will recapture. Restraint comes first.'),
          wrong('Ignore it and attack the king', 'Passers promote while you are busy. Restrain it now.'),
        ]),
      ],
    },
    {
      id: 'ms-09',
      n: 9,
      title: 'Dynamic versus static',
      subtitle: 'Know when the clock on your advantage expires.',
      minutes: 10,
      steps: [
        text(
          'Two currencies, one exchange rate',
          [
            'Static advantages (better structure, permanent weak squares) age well: they are still there in the endgame. Dynamic advantages (development lead, initiative, exposed king) age terribly: use them NOW or they evaporate.',
            'The master decision: when your dynamic edge peaks, either convert it into material or into a permanent static gain, today. Holding a dynamic advantage with quiet moves is how equal positions happen to strong players.',
          ],
          'Dynamic: spend today. Static: invest for later.',
        ),
        demo('The aging advantage', ['White is up material: a STATIC edge that will still be there in the endgame. The next moves decide only HOW well it converts.'], '7k/8/8/8/8/8/8/R3K3 w - - 0 1', {
          marks: [{ square: 'a5', color: 'green' }],
          caption: 'Static: it ages well. Use it calmly.',
        }),
        quiz('Dynamic expiration', 'You are two moves ahead in development with the enemy king stuck. Your best approach?', [
          right('Open the center immediately with pawn breaks and piece play', 'Development lead has a shelf life of a few moves. Spend it now.'),
          wrong('Slowly improve your worst piece first', 'By then he is developed. The gift expires.'),
          wrong('Trade queens to simplify', 'Simplification is exactly what the undeveloped side dreams of.'),
        ]),
        playout(
          'Spend it now',
          'You start with the full toolkit. Convert your ideas into material before the engine equalizes.',
          START,
          'w',
          'Win at least 3 points of material within 18 moves',
          4,
          'material',
          18,
          'Dynamic converted into material. That is the exchange rate working.',
        ),
      ],
    },
    {
      id: 'ms-10',
      n: 10,
      title: 'Practice arena: master tools',
      subtitle: 'Everything from this tier, live.',
      minutes: 12,
      steps: [
        text(
          'Five rounds',
          [
            'Name the tool before you move: prophylaxis, trade vote, color invasion, blockade, initiative.',
            'The drills are known positions. The SKILL is recognizing which tool the position is asking for.',
          ],
        ),
        drill('Prophylaxis', '4k3/8/8/8/8/8/1q6/R3K3 w - - 0 1', ['Rc1'], 'Kill his idea before it exists', 'b1 is the square he wants.', 'Rc1. First tool of the masters.'),
        drill('Trade vote', '4k3/8/8/8/3b4/5N2/8/4K3 w - - 0 1', ['Nxd4'], 'Trade his best piece', 'f3 to d4.', 'Nxd4. The vote is in.'),
        drill('Color invasion', '6k1/8/8/8/8/8/3B2PP/4B1K1 w - - 0 1', ['Bh6'], 'Drive to the missing color', 'Dark squares all the way.', 'Bh6. Highway open.'),
        drill('Initiative', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Force the mate', 'No free moves for him.', 'Three forcing moves. Initiatia paid in full.'),
      ],
    },
    {
      id: 'ms-11',
      n: 11,
      title: 'Steering the game',
      subtitle: 'Choose openings by the endgames they promise.',
      minutes: 10,
      steps: [
        text(
          'Play chess backwards',
          [
            'Strong players choose openings by the TYPE of endgame or middlegame they want to reach. If you are a great rook endgame player, steer into symmetrical structures where rook endings decide. If your tactics are sharp, take the initiative early.',
            'Practical rule: review your own games, find the structures where you WIN, and build a repertoire that walks into them on purpose.',
          ],
          'Pick the battlefield before the first move.',
        ),
        drill('Choose your battlefield', START, ['d4'], 'You love closed, strategic structures. Open with the queen pawn', 'd4 leads to closed centers and long plans.', 'd4. The strategic battlefield. Now every opening choice serves your strengths.'),
        quiz('Repertoire logic', 'You win most of your rook endings but lose sharp tactical fights. Your repertoire should...', [
          right('Avoid early queen trades, aim for balanced middlegames that simplify into rook endings', 'Play toward your strength on purpose.'),
          wrong('Play the sharpest gambits available', 'You are buying tickets to your own weakness.'),
          wrong('Memorize twenty moves of theory', 'Theory without direction is a library with no map.'),
        ]),
        quiz('Steering example', 'Your opponent plays sharp gambits for a living. The steering move is...', [
          right('Choose lines that close the center and mute the tactics', 'Take the game where their weapons do not work.'),
          wrong('Accept every gambit and out-calculate them', 'You are choosing their favorite game.'),
          wrong('Mirror their style to practice', 'Rated games are not practice arenas. Win the ones that count.'),
        ]),
      ],
    },
    {
      id: 'ms-12',
      n: 12,
      title: 'Rook endings deep',
      subtitle: 'Short-side defense, checking distance, the active king.',
      minutes: 12,
      steps: [
        text(
          'The defender\u2019s masterclass',
          [
            'Defending a pawn down in a rook ending: put your king on the SHORT side of the pawn (away from the checks), and the rook on the LONG side giving checks from maximum distance. The attacker\u2019s king never gets to hide from the checks.',
            'Checking distance: the rook must check from three squares away or more, so the enemy king can never approach and block. Three, four, five files of distance: that is how half points are held.',
          ],
          'King short side. Rook long side. Checks from far away.',
        ),
        drill('Hold the distance', '4k3/8/4K3/4P3/8/8/8/7r b - - 0 1', ['Rd1'], 'The classic rear-rank defense, one more time', 'd1 keeps the maximum distance from the future king walk.', 'Rd1. Distance, checks, draw. The defender\u2019s bread and butter.'),
        playout(
          'Defend the fortress',
          'Equal rook ending. Hold the balance for 12 moves: active rook, careful king, no gifts.',
          '4k3/8/8/8/8/8/1r6/4K1R1 w - - 0 1',
          'w',
          'Reach the move limit without losing material',
          2,
          'draw',
          12,
          'Held. Defensive technique is a skill, not an accident.',
          'Reset. Keep the rook active: a passive rook defends nothing for twelve straight moves.',
        ),
        quiz('Checking distance', 'Your rook checks the enemy king from two squares away. Why is this wrong?', [
          right('The king can step toward your rook and force a trade or block', 'Three files or more of distance keeps the checks unblockable.'),
          wrong('Two squares is illegal', 'It is legal. It is just losing.'),
          wrong('Distance never matters in rook endings', 'Distance is HALF of rook endgame technique.'),
        ]),
      ],
    },
    {
      id: 'ms-13',
      n: 13,
      title: 'Fortresses',
      subtitle: 'Positions that cannot be cracked, no matter what.',
      minutes: 10,
      steps: [
        text(
          'The unbreakable wall',
          [
            'A fortress is a position where the stronger side\u2019s extra material simply cannot be converted: the pawns and king form a shape no invasion can breach. A rook against two connected sheltered pawns is the everyday example.',
            'Two fortress skills: BUILDING them when defending (choose the wall before the pieces arrive), and RECOGNIZING them when attacking, so you trade into a real endgame instead of beating your head on the wall.',
          ],
          'Some walls do not fall. Recognize them, do not rent a ladder.',
        ),
        demo('The everyday wall', ['Black has a whole rook. White has two pawns and the king in front of them. Try as he might, the rook can never make progress: this is a draw with correct play.'], '7k/8/8/8/8/8/r5PP/6K1 w - - 0 1', {
          marks: [
            { square: 'f2', color: 'green' },
            { square: 'g2', color: 'green' },
          ],
          caption: 'Green: the wall. The rook is furniture.',
        }),
        quiz('Fortress verdict', 'You are up a rook. Your opponent\u2019s king and two connected pawns form a perfect wall and nothing else is on the board. Result with best play?', [
          right('Draw: this fortress holds', 'No invasion square, no zugzwang, no win. Take the half point and move on.'),
          wrong('Win: material is material', 'Material only converts when the position lets you use it.'),
          wrong('Win by zugzwang', 'The rook has spare tempi; the wall has none to give. No zugzwang exists here.'),
        ]),
        quiz('Building a fortress', 'You are DEFENDING a pawn down. When should fortress thinking start?', [
          right('Before the attackers arrive: choose the pawn wall and king placement early', 'Fortresses are built in advance. Improvised walls crumble.'),
          wrong('Only when the position is already hopeless', 'Hopeless is too late. The wall needs moves to build.'),
          wrong('Never, fortresses are luck', 'Fortresses are technique. Books are written about them.'),
        ]),
      ],
    },
    {
      id: 'ms-14',
      n: 14,
      title: 'Opposite bishops, mastered',
      subtitle: 'The outside passed pawn doctrine.',
      minutes: 12,
      steps: [
        text(
          'Two runners beat one bishop',
          [
            'With opposite-colored bishops, the attacker wins by creating TWO passed pawns on DIFFERENT colors: the bishop can arrest one runner; the other, on the far side of the board, promotes while everyone watches.',
            'The defender\u2019s counter-doctrine: park the bishop on the color where the DANGEROUS pawn lives, and give up the other color completely. Half a board is defensible. All of it is not.',
          ],
          'Create the second runner, or become the bishop that stops both.',
        ),
        demo('The map', ['One pawn on b2 with opposite bishops: draw. The gold square h5 marks where a SECOND pawn would make the position winning: the bishop cannot be in two countries.'], '8/8/4k3/8/8/8/1P2B3/2B1K3 w - - 0 1', {
          marks: [
            { square: 'b2', color: 'green' },
            { square: 'h5', color: 'gold' },
          ],
          caption: 'Green: stopped. Gold: the second front that wins.',
        }),
        drill('Escort the runner', '8/8/4k3/8/8/8/1P2B3/2B1K3 w - - 0 1', ['b4'], 'Advance the passed pawn under the bishop\u2019s protection', 'The bishop escorts its own color; the king walks beside.', 'b4. One runner with correct support. Remember: against a real defense, the SECOND pawn on the other color is what cashes the win.'),
        quiz('Outside pawn rule', 'In opposite-bishop endings, the outside passed pawn matters because...', [
          right('It attacks on the color complex the defending bishop has abandoned', 'The defender must choose which color to live on. The outside pawn lives on the other one.'),
          wrong('It is worth two pawns', 'Same value. Different geography.'),
          wrong('Bishops cannot capture pawns', 'Bishops capture fine. They just cannot be in two places.'),
        ]),
      ],
    },
    {
      id: 'ms-15',
      n: 15,
      title: 'The opposite-side storm',
      subtitle: 'Racing pawns with everything on the line.',
      minutes: 12,
      steps: [
        text(
          'The race doctrine',
          [
            'Opposite-side castling removes the brakes: both players storm, and the game is decided by WHO OPENS THE FILE FIRST and whose pieces arrive through it. Defense is almost impossible; the correct strategy is to be one tempo faster.',
            'Rule of the race: every pawn move must either advance the storm or slow their storm. Quiet development is a donation. If you have committed to the race, count tempi like cash.',
          ],
          'Count tempi like cash. The first open file wins.',
        ),
        drill('Roll the storm', 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', ['h4'], 'The kings are on opposite wings. Start the race', 'The h-pawn leads. Every move counts now.', 'h4. The race is on. h5 comes next, then the rook lifts. Count his tempi and stay ahead.'),
        quiz('Race discipline', 'In an opposite-side castling race, your opponent just slowed down to defend. You should...', [
          right('Speed up: his defensive tempo is your free move', 'Races are decided by tempo. His pause is your opening.'),
          wrong('Slow down too, to stay balanced', 'Balance is a middlegame concept. This is a sprint.'),
          wrong('Trade queens immediately', 'Queens deliver the mate in races. Trading them defends HIM.'),
        ]),
        quiz('Storm composition', 'Your pawn storm is rolling. Where do the heavy pieces go?', [
          right('Behind the pawns, ready to enter through the first opened file', 'Pawns clear the road. Rooks and queen take it.'),
          wrong('Defending your own king', 'You castled opposite wings. Defense was not the plan.'),
          wrong('In the center', 'The center is a sideshow. The race is on the wings.'),
        ]),
      ],
    },
    {
      id: 'ms-16',
      n: 16,
      title: 'Difficult defense',
      subtitle: 'Staying alive with activity, not hope.',
      minutes: 12,
      steps: [
        text(
          'The active defense doctrine',
          [
            'In worse positions, passive defense loses slowly and surely. The correct defense trades PIECES (never pawns), creates ONE concrete counter-threat, and plays for the position to simplify.',
            'The psychological rule: never defend a position you have already mentally resigned. As long as one forcing line exists, the opponent still has to find it. Players rated far above the position lose worse positions every day to active, annoying defense.',
          ],
          'Trade pieces, threaten something, make him prove it.',
        ),
        drill('One concrete threat', '4k3/8/8/8/R2q4/8/8/4K3 w - - 0 1', ['Rxd4'], 'Worse position, one forcing move available. Find it.', 'The queen shares your rook\u2019s rank. Capture is the loudest answer.', 'Rxd4. The concrete threat resolved the pressure. Defense is a sequence of exactly these.'),
        quiz('Defensive trades', 'Down material and defending. What do you trade?', [
          right('Pieces, to reduce the attacking force', 'Fewer attackers, fewer mating nets. Pawns are your comeback margin.'),
          wrong('Pawns, to open lines', 'Opening lines helps the side with more pieces.'),
          wrong('Nothing, sit tight', 'Passive defense is a slow resignation.'),
        ]),
        quiz('Psychological defense', 'The opponent starts playing fast and confidently while you defend. What does that change?', [
          right('Nothing on the board. Keep finding the best defensive moves', 'Confidence is not a chess move. The position decides.'),
          wrong('Play sharper to punish his overconfidence', 'Sharpness favors the attacking side. Solid moves punish confidence.'),
          wrong('Resign: he clearly knows what he is doing', 'Rating comes and goes. The position is what it is.'),
        ]),
      ],
    },
    {
      id: 'ms-17',
      n: 17,
      title: 'Clock and mind',
      subtitle: 'Practical decisions: time, tilt, and tempo bluffs.',
      minutes: 10,
      steps: [
        text(
          'The invisible pieces',
          [
            'Time is a resource with its own tactics: spend minutes on critical branches (captures, pawn structure decisions, king safety) and seconds on forced or obviously bad alternatives. Decide BEFORE your clock bleeds, not after.',
            'Tilt is the most expensive piece on the board. After a mistake, the losing move is the immediate aggressive compensation attempt. The correct move is the most solid one: stabilize first, the position does not know your feelings.',
          ],
          'Spend minutes on branches, seconds on forced moves, zero on emotions.',
        ),
        quiz('Time triage', 'The position just became sharp: three captures available, unclear consequences. The clock shows five minutes for fifteen moves. You should...', [
          right('Spend real time here: this is exactly what the clock is for', 'Critical moments buy more rating per minute than any other investment.'),
          wrong('Play the first capture on instinct', 'Sharp positions punish instinct. That is what makes them sharp.'),
          wrong('Save time for later, move fast now', 'There is no later if the position is lost now.'),
        ]),
        quiz('After the blunder', 'You just dropped a piece but the position is messy and he has five minutes left too. The best practical response?', [
          right('Play the most solid, annoying move and make him convert', 'Conversion under time pressure is a skill. Make him show it.'),
          wrong('Immediate speculative sacrifice to get it back', 'The classic tilt double-loss. Two mistakes in a row.'),
          wrong('Resign on the spot', 'Rated players win pieces back every day. Nobody wins resignations.'),
        ]),
        drill('The solid move', '4k3/8/8/2b5/3N4/8/8/4K3 w - - 0 1', ['Nb3'], 'Shaken position. Play the most solid retreat', 'b3 keeps the knight safe and eyeing the center.', 'Nb3. Stabilize first. The position does not know your feelings.'),
      ],
    },
    {
      id: 'ms-18',
      n: 18,
      title: 'Practice arena: master tactics I',
      subtitle: 'Deep combinations, verified.',
      minutes: 12,
      steps: [
        text(
          'Depth over speed',
          [
            'Three multi-move drills. Calculate to the END of the line before moving: the master habit is finishing the line in the head, not on the board.',
            'If a drill repeats an earlier position, solve it faster. Speed on known patterns is what buys clock time for the hard ones.',
          ],
        ),
        drill('Sacrifice to mate', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Mate in three', 'Sacrifice, forced reply, open file.', 'Three forcing moves. Calculated, not lucky.'),
        drill('Deflection mate', 'r5k1/5ppp/8/8/8/8/3R4/3R2K1 w - - 0 1', ['Rd8+', 'Rxd8', 'Rxd8#'], 'The back rank never had a second defender', 'First rook as bait, second rook as executioner.', 'Rd8 plus check, Rxd8, Rxd8 mate. Deflection at full depth.'),
        drill('Break the chain', '4k3/8/8/2ppp3/8/8/8/K6R w - - 0 1', ['Re1'], 'Structural strike', 'The base of the chain is the target.', 'Re1. Positional pressure with concrete teeth.'),
      ],
    },
    {
      id: 'ms-19',
      n: 19,
      title: 'Practice arena: master tactics II',
      subtitle: 'Multi-motif, full depth.',
      minutes: 12,
      steps: [
        text(
          'One last rep set',
          [
            'Three more, deeper. Between drills, close your eyes and replay the line: visualization is the muscle being trained here.',
            'Then the graduation game. Bring everything.',
          ],
        ),
        drill('Discovery to mate', '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', ['Nd6+'], 'The double check that starts everything', 'The knight leaves, two lines open at once.', 'Nd6 plus double check. From here the attack writes itself.'),
        drill('The outpost empire', '4k3/2p1p3/8/8/8/8/8/1N2K3 w - - 0 1', ['Nc3', 'Kd7', 'Nd5'], 'Build the permanent advantage', 'c3, then the square no pawn can reach.', 'Nd5. The knight owns the center for the rest of the game.'),
        drill('Perpetual salvation', '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'], 'Find the draw', 'Rank checks, one rank at a time.', 'The queen polices the ranks. Half a point, fully earned.'),
      ],
    },
    {
      id: 'ms-20',
      n: 20,
      title: 'Master graduation',
      subtitle: 'One exam, one game against the machine.',
      minutes: 15,
      steps: [
        text(
          'The exam',
          [
            'Two questions, then a full game against the level 5 engine.',
            'Grandmaster tier is the summit of the curriculum: judgment, prophylaxis and technique at full depth.',
          ],
          'Prove it, then climb.',
        ),
        quiz('Doctrine check', 'Your opponent\u2019s best plan is a kingside attack. The master move is usually...', [
          right('The move that makes his attack impossible, even if quiet', 'Prophylaxis: kill the plan, then execute yours.'),
          wrong('A faster kingside attack of your own', 'Same-side races favor whoever was NOT behind in development. Know the board.'),
          wrong('Trading queens at any cost', 'Queens trade only when the resulting structure favors you.'),
        ]),
        quiz('Fortress recognition', 'You are up a rook but the enemy wall is perfect and nothing else exists on the board. The master decision is...', [
          right('Agree to or accept the draw: the fortress holds', 'Recognizing the wall saves the energy for winnable games.'),
          wrong('Keep playing: rooks always win', 'Rooks win positions, not game scores.'),
          wrong('Sacrifice the rook for a pawn attack', 'Sacrifices need follow-up. There is no follow-up against a fortress.'),
        ]),
        playout(
          'Graduation game',
          'Master the machine: 3 points of material within 20 moves against the level 5 engine.',
          START,
          'w',
          'Win 3 or more points of material within 20 moves',
          5,
          'material',
          20,
          'Master tier cleared. The Grandmaster tier is the last mountain.',
        ),
      ],
    },
  ],
}
