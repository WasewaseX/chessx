// Tier 2: Beginner. Opening plans, the first tactical weapons, and the
// basic checkmates every player must own.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const beginner: Tier = {
  id: 'beginner',
  n: 2,
  title: 'Beginner',
  tagline: 'Opening plans, forks, pins, and the mates you must know.',
  color: '#5aa06d',
  levels: [
    {
      id: 'bg-01',
      n: 1,
      title: 'The center is gold',
      subtitle: 'Why e4 and d4 beat h4 and a4 every time.',
      minutes: 7,
      steps: [
        text(
          'Four squares, whole game',
          [
            'The center is the four squares d4, d5, e4 and e5. A piece standing there attacks more squares than anywhere else on the board.',
            'A knight on e5 reaches 8 squares. The same knight on a1 reaches 2. The center is the high ground, and whoever owns it usually dictates the game.',
            'This is why almost every good opening starts with a center pawn: e4 or d4.',
          ],
          'Control the center and your pieces are worth more.',
        ),
        demo(
          'Central influence',
          [
            'Both knights and bishops point at the center in the starting position. Compare the reach of a knight on g1 heading for f3 or e4, against one wandering to a3.',
          ],
          START,
          {
            marks: [
              { square: 'd4', color: 'green' },
              { square: 'e4', color: 'green' },
              { square: 'd5', color: 'green' },
              { square: 'e5', color: 'green' },
            ],
            caption: 'The four center squares',
          },
        ),
        quiz('Knight placement', 'Where does a knight have the biggest influence?', [
          right('In the center, like e5 or d5', 'Central squares give a knight up to 8 destinations.'),
          wrong('On the rim, like a3 or h6', 'A knight on the rim attacks at most 4 squares. A knight on the rim is dim.'),
          wrong('In the corner', 'A corner knight attacks almost nothing. It is decoration.'),
        ]),
        drill('Claim the center', START, ['e4'], 'Open with a center pawn', 'The king pawn, two squares forward.', 'e4. Space for the bishop and queen, a grip on d5, and a first step toward castling.'),
      ],
    },
    {
      id: 'bg-02',
      n: 2,
      title: 'Develop your pieces',
      subtitle: 'Knights and bishops out, one move each.',
      minutes: 7,
      steps: [
        text(
          'Every move, a new piece',
          [
            'Development means bringing knights and bishops off the back rank toward the center. Each move should activate something new.',
            'Two classic beginner sins: moving the same piece twice for no reason, and pulling the queen out too early. Both let your opponent finish developing while you shuffle.',
            'A good rule: knights before bishops, both toward the center, and no piece moves twice in the opening unless it wins material.',
          ],
          'One move, one new piece into the game.',
        ),
        demo('Natural development', ['Nf3 attacks e5, Nc6 defends it, Bc4 points at f7. Every move has a job.'], START, {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
          caption: 'Developing with purpose',
        }),
        drill('Develop with tempo', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', ['Nf3'], 'Black grabbed the center too. Develop a piece that hits back.', 'The knight on g1 attacks e5 the moment it lands on f3.', 'Nf3. Development with tempo: it attacks e5 while coming out.'),
        quiz('Opening sin', 'You have played Nf3 and your opponent developed a knight. You now play Ng1 back and then Nf3 again. What did you lose?', [
          right('Two tempi, while your opponent developed two pieces', 'Tempo is time. Wasting it in the opening means you get attacked first.'),
          wrong('Nothing, the position is the same', 'The pieces are the same, the clock of development is not.'),
          wrong('A pawn', 'No pawn fell. Time did.'),
        ]),
      ],
    },
    {
      id: 'bg-03',
      n: 3,
      title: 'Castle early',
      subtitle: 'The king walks in, the rook joins the game.',
      minutes: 6,
      steps: [
        text(
          'King safety is development too',
          [
            'Castling is not just a rule from the Newbie tier. It is a strategic goal: usually by move 8 to 10.',
            'A castled king sits behind three healthy pawns. An uncastled king sits on an open road in the middle of the board, and open roads attract rooks.',
            'After castling, your rook is connected to its twin. Connected rooks defend each other and can double up on open files.',
          ],
          'Castled by move 10, or you are gambling.',
        ),
        drill('Castle as Black', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 6 5', ['O-O'], 'Black has developed three pieces. Finish the job.', 'f8 and g8 are clear and unattacked. The two-piece move works for Black too.', 'Castled. Black is fully in the game with a safe king.'),
        demo('What you are aiming for', ['Both kings castled, both sides developed. This symmetric position is a perfectly healthy result of good opening play.'], 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 2 7', {
          marks: [
            { square: 'g1', color: 'green' },
            { square: 'g8', color: 'green' },
          ],
          caption: 'Both kings safe behind their pawn walls',
        }),
        demo('What you are aiming for', ['Both kings castled, both sides developed. This symmetric position is a perfectly healthy result of good opening play.'], 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 2 7', {
          marks: [
            { square: 'g1', color: 'green' },
            { square: 'g8', color: 'green' },
          ],
          caption: 'Both kings safe behind their pawn walls',
        }),
        quiz('Castle timing', 'What is the usual deadline for castling?', [
          right('Around move 8 to 10', 'Early castling prevents most attacks on an uncastled king.'),
          wrong('After move 20', 'By then the center is open and your king is a target.'),
          wrong('Only when under attack', 'Then it is usually too late: the attackers arrive first.'),
        ]),
      ],
    },
    {
      id: 'bg-04',
      n: 4,
      title: 'Do not hang pieces',
      subtitle: 'The blunder check that saves hundreds of points.',
      minutes: 7,
      steps: [
        text(
          'The blunder scan',
          [
            'A hung piece is one left where an enemy piece can take it for free or for less than it is worth. Most beginner games are lost this way, not to deep strategy.',
            'Before every move, run a three-second scan: after my move, what attacks my pieces? After my move, what does my opponent threaten?',
            'Moving a attacked piece is not cowardice. It is math. A knight that retreats can fight later. A knight that hangs feeds the enemy.',
          ],
          'Scan after every move: what did I leave undefended?',
        ),
        drill('Save the knight', '4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1', ['Nb1'], 'The pawn on b4 attacks your knight. Get it out.', 'Head home to b1, far from the pawn.', 'Saved. Retreating is not losing. Hanging is.'),
        drill('Save the rook', '4k3/8/8/8/8/2r5/8/2R1K3 w - - 0 1', ['Rxc3'], 'The black rook attacked yours. Answer the threat.', 'Two rooks face each other on the c-file. When a stronger piece attacks, taking is better than running.', 'Rxc3. Even trade, danger gone. Counting attackers early would have avoided the scare.'),
        drill('Save the bishop', '4k3/8/8/6n1/8/5B2/8/4K3 w - - 0 1', ['Be2'], 'The knight on g5 attacks your bishop. Retreat it to safety.', 'e2 is far outside the knight\u2019s L-shaped reach.', 'Be2. Out of danger, still in the game.'),
        quiz('The scan', 'What question belongs in your pre-move scan?', [
          right('What does my opponent threaten after my move?', 'Anticipating the reply is what prevents hanging pieces and missed shots.'),
          wrong('Nothing, I plan only my own ideas', 'Chess is played against a thinking opponent.'),
          wrong('Only what my opponent did last move', 'Threats change every move. The scan runs every move.'),
        ]),
      ],
    },
    {
      id: 'bg-05',
      n: 5,
      title: 'The fork',
      subtitle: 'One piece, two victims.',
      minutes: 8,
      steps: [
        text(
          'Double trouble',
          [
            'A fork attacks two pieces at once. The defender can save only one, so you win the other.',
            'Knights are the fork champions because their L-shaped attack surprises the eye. Royal forks hit king and queen together and decide games instantly.',
            'Fork radar: look for enemy pieces that stand a knight move apart, especially on the same rank or file with the king.',
          ],
          'Two targets, one attacker: the defender saves only one.',
        ),
        demo('The royal fork', ['Nc7+ hits the king and the rook on a8 at the same time. The king moves, the rook falls.'], 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', {
          moves: ['Nc7+', 'Kd8', 'Nxa8'],
          caption: 'Knight fork: king and rook',
        }),
        drill('Find the fork', 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['Nc7+'], 'Fork the king and the rook', 'The knight on b5 wants to jump to c7, checking the king and attacking a8.', 'Nc7 plus check. The rook on a8 is a goner.'),
        quiz('Fork victims', 'Which pair makes the juiciest fork?', [
          right('King and queen', 'The royal fork: check plus the biggest prize.'),
          wrong('Two pawns', 'Two pawns are 2 points. Often not worth a knight trip.'),
          wrong('Two rooks is better than king and queen', 'Rooks are 10 together, but a check means the defender gets ZERO choice on the queen.'),
        ]),
      ],
    },
    {
      id: 'bg-06',
      n: 6,
      title: 'The pin',
      subtitle: 'A piece frozen in front of its own king.',
      minutes: 8,
      steps: [
        text(
          'Pinned means paralyzed',
          [
            'A pin attacks a piece that stands between your attacker and a more valuable piece behind it, usually the king. The pinned piece legally cannot move.',
            'Pinned pieces are overloaded guards: they defend nothing while they shield the king. Pile onto a pin and the front piece cracks.',
            'The classic tool: a bishop landing on the long diagonal in front of a castled king.',
          ],
          'A pinned piece is a prisoner. Attack it with everything.',
        ),
        demo('Freeze the knight', ['Bb5 lands on the diagonal to e8. The knight on c6 now protects the king and cannot budge.'], 'r1b1k3/pppp1ppp/2n5/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQ - 4 4', {
          moves: ['Bb5'],
          caption: 'The knight on c6 is pinned to the king',
        }),
        drill('Apply the pin', 'r1b1k3/pppp1ppp/2n5/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQ - 4 4', ['Bb5'], 'Pin the knight on c6', 'The b5 square sits on the b5 to c6 to d7 to e8 diagonal.', 'Bb5. The knight is glued to its king.'),
        quiz('Pinned pieces', 'Your knight is pinned against your king by a bishop. What is true?', [
          right('It cannot legally move at all', 'Moving it would expose the king to check. Illegal.'),
          wrong('It can move but it is risky', 'Against a true pin to the king, moving is illegal, not just risky.'),
          wrong('It can still defend other squares', 'A pinned piece still attacks squares but cannot leave. It defends nothing it did before? No: it attacks squares, but its defense is frozen in place.'),
        ]),
      ],
    },
    {
      id: 'bg-07',
      n: 7,
      title: 'The skewer',
      subtitle: 'The pin in reverse: the king moves, the prize falls.',
      minutes: 7,
      steps: [
        text(
          'Through the king',
          [
            'A skewer attacks the king (or a big piece) with something valuable standing behind it on the same line.',
            'The king must step aside. Then you take what was hiding behind him.',
            'Skewers love open files and long diagonals. Rooks and bishops are the natural snipers.',
          ],
          'Attack through the king, collect what hides behind.',
        ),
        demo('Skewer step by step', ['Re1 checks through the king on e5. The king steps off the file, and the queen on e8 is a goner.'], '4q3/8/8/4k3/8/8/8/3R2K1 w - - 0 1', {
          moves: ['Re1+', 'Kf6', 'Rxe8'],
          caption: 'Check first, capture second',
        }),
        drill('Run the skewer', '3q4/8/8/3k4/8/8/8/KR6 w - - 0 1', ['Rd1+', 'Kc4', 'Rxd8'], 'Win the queen with a skewer', 'First bring the rook to the d-file with check. Then collect what stands behind the king.', 'Rd1 plus check, the king steps aside, Rxd8. The queen could not hide.'),
        quiz('Pin or skewer?', 'A bishop checks a king, and a rook stands on the same diagonal behind the king. What is this?', [
          right('A skewer: the king moves and the rook is captured', 'The more valuable piece is BEHIND, so it falls after the king moves.'),
          wrong('A pin', 'In a pin the valuable piece is BEHIND a piece that cannot move. Here the front piece is the king himself.'),
          wrong('A fork', 'A fork attacks two things at once. Here the attack is a line through the king.'),
        ]),
      ],
    },
    {
      id: 'bg-08',
      n: 8,
      title: 'Loose pieces drop off',
      subtitle: 'LPDO: the mnemonic that wins games.',
      minutes: 7,
      steps: [
        text(
          'Undefended equals edible',
          [
            'LPDO: Loose Pieces Drop Off. Any piece with no defender is a target for a cheap tactic.',
            'When pieces of your opponent stand undefended near each other, look for a move that attacks two of them at once. One falls.',
            'Same habit on defense: every move, check which of your pieces are loose. Defend them or move them.',
          ],
          'Loose Pieces Drop Off. Count your unguarded pieces every move.',
        ),
        drill('Dinner is served', '4k3/8/8/3b4/8/8/8/3Q1K2 w - - 0 1', ['Qxd5'], 'The bishop on d5 has no bodyguard.', 'The queen on d1 looks straight down the file.', 'Qxd5. Three points for free. Nobody recaptured because nobody could.'),
        quiz('Spot the loose piece', 'Your opponent has a knight on c5 defended by a pawn, and a bishop on e3 defended by nothing. What is the target?', [
          right('The bishop on e3', 'Undefended pieces are the natural targets, regardless of color.'),
          wrong('The knight on c5', 'It is defended. Capturing it trades or loses material.'),
          wrong('Neither, wait for a better moment', 'Free material does not usually get freer. Take the loose piece.'),
        ]),
        drill('Attack the loose pair', '4k3/8/8/8/R2n1n2/8/8/4K3 w - - 0 1', ['Rxd4'], 'Two knights stand side by side on the open rank. One rook, two victims.', 'The rook on a1 sees the whole 4th rank. Both knights are loose: take one.', 'Rxc4. Two loose pieces on one line is a recipe. The rook ate well and runs no risk: the other knight cannot recapture.'),
      ],
    },
    {
      id: 'bg-09',
      n: 9,
      title: 'Counting attackers and defenders',
      subtitle: 'When is a capture safe? Do the math.',
      minutes: 8,
      steps: [
        text(
          'The exchange count',
          [
            'Before any capture on a defended square, count: how many of my pieces attack it, how many of theirs defend it, and what are the values?',
            'If you capture with equal or more attackers than defenders and your cheapest attacker goes in first, the math usually works.',
            'Botched counting is where most of the pain in club chess comes from. Slow down and count. Every time.',
          ],
          'Attackers, defenders, values. Then capture.',
        ),
        drill('The even trade', '4k3/pp3ppp/2n5/1B6/8/8/PPP2PPP/4K3 w - - 0 1', ['Bxc6+', 'bxc6'], 'Trade bishop for knight. Both are defended.', 'Bishop takes knight, checking the king; the b7 pawn takes back. Count the values first.', 'An even trade, 3 for 3. Fine when trades help you.'),
        quiz('Favorable counting', 'Your knight (3) and your rook (5) both attack an enemy rook (5). It is defended by one pawn (1). You capture knight first, pawn recaptures, then your rook takes the pawn? No: rethink. What is the final count?', [
          right('You win a rook for a knight: plus 2', 'Cheapest attacker goes first, you collect the 5 and lose only the 3.'),
          wrong('Even trade', 'The pawn recapture does not restore the rook. The arithmetic favors you.'),
          wrong('You lose material', 'Count again: 5 gained, 3 lost.'),
        ]),
        quiz('Count and decide', 'Your rook attacks a defended pawn. The pawn is defended by another pawn. Capturing costs you what?', [
          right('Rook (5) for pawn (1): you lose 4', 'Never eat a small bite that bites back four points harder.'),
          wrong('An even trade', 'A pawn does not equal a rook. The values make it a loss.'),
          wrong('You gain a pawn', 'You GAIN a pawn once, then LOSE the rook. Net: minus 4.'),
        ]),
      ],
    },
    {
      id: 'bg-10',
      n: 10,
      title: 'Removing the defender',
      subtitle: 'Break the bodyguard first, then collect.',
      minutes: 8,
      steps: [
        text(
          'Cut the support',
          [
            'When a valuable piece is defended, attacking it directly fails. The trick: capture or chase the defender first.',
            'Once the bodyguard is gone, the guarded piece becomes loose, and loose pieces drop off.',
            'Look for defenders that are themselves undefended, pinned, or overloaded. Those are the ones that can be removed cheaply.',
          ],
          'Take the bodyguard, then take the prize.',
        ),
        demo('Bodyguard down', ['The knight on c6 guards the rook on d8. The bishop eats the knight first. Now the rook is loose.'], '3r1k2/8/2n2B2/8/8/8/8/4K3 w - - 0 1', {
          moves: ['Bxd8', 'Nxd8'],
          caption: 'Bishop for rook: the defender was the rook, the knight takes back',
        }),
        drill('Remove and collect', '3r1k2/8/2n2B2/8/8/8/8/4K3 w - - 0 1', ['Bxd8', 'Nxd8'], 'The knight defends the rook. Trade your bishop for the rook anyway.', 'Capture on d8 first. Even after the knight recaptures, count the values.', 'Bishop (3) takes rook (5), knight recaptures. Net: plus 2. Removing the bodyguard paid.'),
        quiz('Who to remove', 'A strong enemy queen is defended by a knight AND a bishop. Your best removal target is usually the one that is...', [
          right('Cheapest to capture or undefended itself', 'Removing a defender should not cost more than the prize it guards.'),
          wrong('The strongest piece', 'You do not remove the queen. You remove her bodyguard.'),
          wrong('Any of them, it makes no difference', 'The cost of removal decides whether the combination works.'),
        ]),
      ],
    },
    {
      id: 'bg-11',
      n: 11,
      title: 'Back-rank defense',
      subtitle: 'Make luft before the rook arrives.',
      minutes: 6,
      steps: [
        text(
          'One pawn move, one exit',
          [
            'You learned back-rank mate in the Newbie tier. Now learn the cure before it costs you a game.',
            'A single pawn move like h3 or g3 creates an escape square for the king. Players call it making luft, German for air.',
            'Timing matters: make luft when your rook has left the back rank and the opponent has no immediate check. Do not do it when it just weakens your king for nothing.',
          ],
          'Luft: one pawn move that takes away every back-rank idea.',
        ),
        demo('The incoming rook', ['The black rook eyes the open first rank. The red square marks where the mate would land: your first rank, with no exit for your king.'], '3r2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1', {
          marks: [{ square: 'd1', color: 'red' }],
          caption: 'One rook check away from disaster',
        }),
        drill('Make luft', '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', ['h3'], 'A black rook may soon hit the back rank. Give your king an exit.', 'Push the h-pawn one square.', 'h3. The king now has h2. Every back-rank threat just evaporated.'),
        quiz('Luft timing', 'When is the best moment to play h3?', [
          right('Before the back rank is under attack, when the move costs nothing', 'Prevention is one tempo. Repair under fire is usually too slow.'),
          wrong('Never, pawns must stay home', 'Pawns can move. Kings cannot fly.'),
          wrong('Only after you are already getting mated', 'After the check lands it is often mate, not luft, that you are playing.'),
        ]),
      ],
    },
    {
      id: 'bg-12',
      n: 12,
      title: 'The two-rook ladder',
      subtitle: 'The easiest mate in chess, done with a ladder.',
      minutes: 8,
      steps: [
        text(
          'Rooks climb, king runs out of board',
          [
            'With two rooks, you mate a lone king by climbing ranks like a ladder: one rook cuts off a rank, the other checks the king to the next rank, repeat.',
            'No support from your king is needed. Watch for one trap: keep the rooks far from the enemy king so he cannot capture them.',
          ],
          'Cut with one rook, check with the other. Up the board.',
        ),
        demo('Climbing the ladder', ['Rb7 cuts the 7th rank. The king is stuck on the 8th. Ra8 is mate.'], '3k4/8/8/8/8/8/1R6/R3K3 w - - 0 1', {
          moves: ['Rb7', 'Ke8', 'Ra8#'],
          caption: 'One rook fences, the other finishes',
        }),
        drill('First rung', '3k4/8/8/8/8/8/1R6/R3K3 w - - 0 1', ['Rb7'], 'Cut off the king with the rook from b2', 'Land on the 7th rank, right in front of the king territory.', 'Rb7. The king is fenced onto the 8th rank. One check remains.'),
        quiz('Ladder safety', 'When climbing with two rooks, what must you always watch for?', [
          right('The king attacking a rook that came too close', 'Keep the rooks at a distance where the king can never capture one.'),
          wrong('Stalemate is possible with two rooks', 'With two rooks cutting ranks, stalemate almost never happens if you keep checks coming sensibly.'),
          wrong('The fifty-move rule resets', 'Checks and captures reset nothing. Distance and patience are the real concerns.'),
        ]),
      ],
    },
    {
      id: 'bg-13',
      n: 13,
      title: 'Queen and king: the box mate',
      subtitle: 'Shrink the box, call your king over, mate.',
      minutes: 10,
      steps: [
        text(
          'Herding with the queen',
          [
            'Queen against a lone king wins by shrinking the box: use the queen a knight-move away from the enemy king to cut off ranks and files.',
            'Then bring YOUR king over to support the final mate. The queen alone cannot mate; she needs her king beside her at the end.',
            'Careful in the corner: a stalemated king is a draw. One extra tempo with the queen fixes that.',
          ],
          'Cut the box, walk the king in, mate with support.',
        ),
        quiz('The corner rule', 'Your queen has the enemy king in the corner, but after your planned move the king would have no moves and no check. What happened?', [
          right('That move is stalemate. Choose a different queen square', 'One queen tempo back, then bring the king. The mate is restored.'),
          wrong('It is checkmate, the game ended', 'No check means no mate. The game would be drawn.'),
          wrong('Stalemate only matters when you are behind', 'Stalemate is a draw for whoever cannot move. Ahead or behind.'),
        ]),
        demo('Shrink the box', ['Qb7 fences rank 7. Qe7 keeps the king on the 8th. Now the white king crosses the board to help deliver mate.'], '7k/8/8/8/8/8/8/K6Q w - - 0 1', {
          moves: ['Qb7', 'Kg8', 'Qe7', 'Kh8'],
          caption: 'The box shrinks, the king walks over',
        }),
        playout(
          'Finish the mate',
          'You have queen and king against a lone king. Mate him. Take your time, shrink the box, bring your king.',
          '7k/8/8/8/8/8/8/K6Q w - - 0 1',
          'w',
          'Checkmate the black king',
          1,
          'checkmate',
          25,
          'Mated. This ending appears in half of all beginner tournaments. Now you own it.',
          'Not this time. Reset and try again: queen a knight move away from the king, then bring your own king up.',
        ),
      ],
    },
    {
      id: 'bg-14',
      n: 14,
      title: 'Passed pawns',
      subtitle: 'No enemy pawns in the way: run or push.',
      minutes: 8,
      steps: [
        text(
          'The runner on the board',
          [
            'A pawn with no enemy pawns on its file or neighboring files is passed. Nobody can stop it with a pawn; it must be stopped with pieces.',
            'In endgames passed pawns are money. Push them, support them with the king, and trade the pieces that chase them.',
            'The farther a passed pawn walks, the more valuable it is: a pawn on the 7th rank is worth more than a rook in many positions.',
          ],
          'Passed pawns must be pushed.',
        ),
        demo(
          'Passed or not?',
          [
            'The white d-pawn is passed: no black pawn on d, c or e files can ever block or capture it. The white a-pawn is blocked for life.',
          ],
          '4k3/p7/8/3P4/8/8/8/4K3 w - - 0 1',
          {
            marks: [
              { square: 'd5', color: 'green' },
              { square: 'a4', color: 'red' },
            ],
            caption: 'Green is passed. Red is stopped.',
          },
        ),
        quiz('Spot the passed pawn', 'White pawns: e4. Black pawns: d5 and f5. Is e4 passed?', [
          right('No, it is blocked by enemy pawns on both sides', 'Enemy pawns on d5 and f5 stop it from ever moving safely forward.'),
          wrong('Yes, nothing stands on e5', 'Passed means no enemy pawns on the file OR the neighboring files ahead.'),
          wrong('Pawns are never passed until the endgame', 'Passed pawns exist in the middlegame too. Watch for them early.'),
        ]),
        playout(
          'Push the majority',
          'You have a healthy pawn majority. Push it, use your king, and win material or promote.',
          '4k3/pp6/8/8/8/8/PP6/4K3 w - - 0 1',
          'w',
          'Win at least 3 points of material within 12 moves',
          2,
          'material',
          12,
          'Majority converted. This is exactly how endgames are won.',
        ),
      ],
    },
    {
      id: 'bg-15',
      n: 15,
      title: 'Practice arena: tactics I',
      subtitle: 'Fork, pin, skewer, mixed.',
      minutes: 9,
      steps: [
        text(
          'Weapons out',
          [
            'Review arena. Forks, pins and skewers from the past levels, new shapes.',
            'Name the tactic out loud before you move. Naming builds pattern memory.',
          ],
        ),
        drill('Royal fork again', 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['Nc7+'], 'Check the king, win the rook', 'c7 is the magic square.', 'Nc7 plus check. Second serving, same taste.'),
        drill('Freeze and win', 'r1b1k3/pppp1ppp/2n5/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQ - 4 4', ['Bb5'], 'Pin the c6 knight', 'The long diagonal toward e8.', 'Bb5. The knight is in jail.'),
        drill('Skewer practice', '3q4/8/8/3k4/8/8/8/KR6 w - - 0 1', ['Rd1+', 'Kc4', 'Rxd8'], 'Win the queen', 'Check on the d-file first.', 'Three moves, one queen. The skewer works.'),
      ],
    },
    {
      id: 'bg-16',
      n: 16,
      title: 'Practice arena: tactics II',
      subtitle: 'Loose pieces, counting, defense.',
      minutes: 9,
      steps: [
        text(
          'Defense counts too',
          [
            'Second review arena. This time half the drills are defensive: save a piece, make luft, refuse a poisoned capture.',
            'Strong defense is what turns equal positions into wins.',
          ],
        ),
        drill('LPDO strike', '4k3/8/8/3b4/8/8/8/3Q1K2 w - - 0 1', ['Qxd5'], 'The bishop is loose', 'The d-file is open.', 'Qxd5. Loose pieces drop off.'),
        drill('Luft under pressure', '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', ['h3'], 'Make an escape square before it is too late', 'One little pawn step.', 'h3. Sleep well tonight.'),
        drill('Poisoned pawn', '4k3/p7/4p3/3p4/8/8/8/R3K3 w - - 0 1', ['Rxa7'], 'Two pawns, one is a trap', 'e6 guards d5. Nobody guards a7.', 'Rxa7. Discipline: you took the free one and refused the poisoned one.'),
      ],
    },
    {
      id: 'bg-17',
      n: 17,
      title: 'Your first opening: the Italian',
      subtitle: 'A complete, honest opening you can play forever.',
      minutes: 9,
      steps: [
        text(
          'The Italian Game',
          [
            '1.e4 e5 2.Nf3 Nc6 3.Bc4 is the Italian Game: the oldest opening in chess and still a mainstay at every level.',
            'The plan is the opening plan you already know, applied perfectly: center pawn, developed pieces, fast castling, then a healthy pawn break with c3 and d4.',
            'You do not need memorized theory as a beginner. You need the IDEAS: put pieces on good squares, castle, and only then start pawn storms.',
          ],
          'e4, Nf3, Bc4, c3, d3 or d4, O-O. Ideas over memorization.',
        ),
        demo('The Italian setup', ['A full model line: both sides develop, White castles, and the game begins for real.'], START, {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O'],
          caption: 'The Italian Game, a lifetime repertoire in 11 moves',
        }),
        drill('Castle in the Italian', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', ['O-O'], 'Complete development the Italian way', 'f1 and g1 are free and safe.', 'Castled. Your first opening is now a complete plan.'),
        quiz('Italian idea', 'After 1.e4 e5 2.Nf3 Nc6 3.Bc4, what is the bishop pointing at?', [
          right('f7, the weakest square in the black camp', 'f7 is defended only by the king. The Italian bishop stares at it all game.'),
          wrong('a6, to chase the knight', 'Wrong diagonal, wrong idea.'),
          wrong('Nothing yet, bishops point later', 'Bishops always point somewhere. Good players know where.'),
        ]),
      ],
    },
    {
      id: 'bg-18',
      n: 18,
      title: 'Play a development game',
      subtitle: 'Full game, one goal: castle by move 12.',
      minutes: 15,
      steps: [
        text(
          'Plan over pieces',
          [
            'A full game with one measurable goal: get castled by move 12 while hanging nothing.',
            'Count your development as you go. Center pawn, knight, bishop, castle. If the bot offers you free material on the way, take it, but the plan comes first.',
          ],
          'Development first, tactics second, tricks never.',
        ),
        quiz('Development order', 'Which is NOT part of the classic opening plan?', [
          right('Launching a pawn storm at the enemy king on move 5', 'Attacks come after development. Storms on move 5 usually backfire.'),
          wrong('Fighting for the center with a pawn', 'Move one of the opening plan.'),
          wrong('Castling by move 10', 'Also part of the plan. King safety is not optional.'),
        ]),
        drill('Start the plan', START, ['e4'], 'Open the game the classic way', 'The king pawn, two squares.', 'e4. The plan is rolling: develop next, castle after.'),
        playout(
          'Development game',
          'Play from the starting position. Castle by move 12 and stay at least even in material.',
          START,
          'w',
          'Get castled and finish even or better in material',
          2,
          'castle',
          12,
          'Developed, castled, and safe. That is what real opening play looks like.',
          'The plan slipped. Reset: center, develop, castle. In that order.',
        ),
      ],
    },
    {
      id: 'bg-19',
      n: 19,
      title: 'Beginner exam',
      subtitle: 'One quiz, one mate, one trap to punish.',
      minutes: 9,
      steps: [
        text(
          'Prove it',
          [
            'The Beginner exam: theory, tactics and a famous punishment.',
            'If anything here stings, that is the exam working. Revisit the level it came from.',
          ],
        ),
        quiz('Values in a fork', 'A knight forks your king and your rook. You move the king. What did you lose?', [
          right('The rook, 5 points', 'The fork guarantees the second target falls.'),
          wrong('Nothing if I move well', 'One target always dies. That is the whole point of a fork.'),
          wrong('The knight takes my king', 'Kings are never captured. The check is answered by moving.'),
        ]),
        drill('Punish the mistake', 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 6 4', ['Qxf7#'], 'Black just played Nf6?? attacking your queen. Make him pay.', 'The queen and bishop both look at f7. Count attackers: two. Defenders: one.', 'Qxf7 mate. That is Scholar\u2019s Mate, the most famous lesson in chess: watch the f7 square before you attack queens.'),
        quiz('Draw knowledge', 'You are up a queen but the enemy king has no moves and is NOT in check. Result?', [
          right('Stalemate: a draw', 'No legal moves plus no check equals stalemate, no matter the material.'),
          wrong('You win, you have a queen', 'Material never overrides stalemate. Check first, then box him in.'),
          wrong('You keep playing', 'The game ends immediately. Draw.'),
        ]),
      ],
    },
    {
      id: 'bg-20',
      n: 20,
      title: 'Beginner graduation',
      subtitle: 'One more game, one tier down.',
      minutes: 15,
      steps: [
        text(
          'Where you stand now',
          [
            'You have an opening with a plan, three tactical weapons, a defense checklist, and two real checkmate techniques.',
            'The Intermediate tier goes deeper: discovered attacks, pawn structures, endgame technique and positional ideas.',
            'Last step of the tier: play the strongest beginner bot and win material.',
          ],
          'See you in Intermediate.',
        ),
        quiz('Skewer check', 'A skewer differs from a pin because...', [
          right('In a skewer the valuable piece stands BEHIND the king, and falls after he moves', 'The pin freezes a piece in front; the skewer shoots through the king to what hides behind.'),
          wrong('A skewer uses only knights', 'Skewers are the work of rooks, bishops and queens. Knights cannot pin or skewer.'),
          wrong('There is no difference', 'The direction of the pieces is the whole difference.'),
        ]),
        drill('Final weapon check', 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['Nc7+'], 'One more royal fork before you graduate', 'The knight on b5 has one spectacular destination.', 'Nc7 plus check. The rook falls next move. Tier cleared.'),
        playout(
          'Graduation game',
          'Win at least 3 points of material against a real opponent.',
          START,
          'w',
          'Win 3 or more points of material within 20 moves',
          3,
          'material',
          20,
          'Beginner tier cleared. The board is starting to speak to you.',
        ),
      ],
    },
  ],
}
