// Tier 4: Advanced. Calculation discipline, combinations, positional depth,
// and real endgame technique.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const advanced: Tier = {
  id: 'advanced',
  n: 4,
  title: 'Advanced',
  tagline: 'Calculation, combinations, positional play, endgame technique.',
  color: '#c98a2e',
  levels: [
    {
      id: 'adv-01',
      n: 1,
      title: 'Candidate moves',
      subtitle: 'Checks, captures, threats. In that order.',
      minutes: 9,
      steps: [
        text(
          'Discipline beats talent',
          [
            'Strong players do not look at every move. They shortlist candidates: every check, every capture, every threat, then the quiet moves that fit a plan. Three to five candidates, calculated honestly, beat twenty glances.',
            'The order matters. Forcing moves first: they leave the opponent the least choice, so their consequences are the most certain. Quiet moves get calculated only after the forcing ones are cleared.',
          ],
          'List candidates before looking at any of them. Checks, captures, threats.',
        ),
        demo(
          'Scan the forcing moves',
          ['A rook stares at the back rank. Before calculating anything fancy: is there a check? Is there a capture? Re8 answers both.'],
          '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
          { marks: [{ square: 'e8', color: 'green' }], caption: 'The first candidate you check is the last one you need' },
        ),
        drill('Check first, always', '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re8#'], 'One move ends the game. Find it the disciplined way.', 'Checks first: the rook has exactly one.', 'Re8 mate. The forcing-move scan found it instantly.'),
        quiz('Candidate order', 'Why do forcing moves get calculated first?', [
          right('They give the opponent the fewest replies, so the calculation is most reliable', 'Fewer branches, fewer surprises. Certainty is the whole point of calculation.'),
          wrong('They are always the best moves', 'Not always. They are always the most CALCULABLE moves.'),
          wrong('They look impressive', 'Beauty is a byproduct. Reliability is the goal.'),
        ]),
      ],
    },
    {
      id: 'adv-02',
      n: 2,
      title: 'The blunder check',
      subtitle: 'Before you move: what is his best reply?',
      minutes: 9,
      steps: [
        text(
          'Verify, then commit',
          [
            'Most rating points are lost not to deep tactics but to skipped verification. The habit: after choosing your move, before touching the piece, ask what is his BEST answer, not his most convenient one.',
            'The blunder check runs on every move, especially captures and trades. Captures change the geometry of the board, and geometry is where discoveries and deflections live.',
          ],
          'Best reply, not obvious reply. Every capture, every trade.',
        ),
        drill('Verify the recapture', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'White to move: the obvious capture looks tempting, but there is a check first. Find the forced mate.', 'Qd8+ offers the queen where only the bishop can take. Then the e-file is a highway.', 'Qd8 plus check, Bxd8 forced, Re8 mate. The blunder check found a mate where greedy hands would have grabbed pawns.'),
        quiz('Blunder check scope', 'When does the blunder check run?', [
          right('On every single move, especially captures', 'Captures rearrange the board. Every rearrangement hides a discovery or a deflection.'),
          wrong('Only when the position looks dangerous', 'Safe-looking positions are where the worst blunders live.'),
          wrong('Only when short on time', 'Time pressure makes it harder, not less necessary.'),
        ]),
        drill('Retreat with purpose', '4k3/8/8/2b5/3N4/8/8/4K3 w - - 0 1', ['Nb3'], 'The bishop on c5 attacks your knight. Move it to the square that also eyes d4.', 'b3 keeps the knight flexible and out of the bishop\u2019s diagonal.', 'Nb3. Safe AND aiming back at the center. Retreats should always have a second job.'),
      ],
    },
    {
      id: 'adv-03',
      n: 3,
      title: 'The attack is worth a piece',
      subtitle: 'Sacrifice material when the king cannot hide.',
      minutes: 9,
      steps: [
        text(
          'Counting differently',
          [
            'A sacrifice is material spent to buy one of three things: an open line, a tempo, or a stripped defender. Near a castled king, the currency exchange rate changes: a rook behind your pawn shield is worth more than a rook on the board.',
            'The verification discipline from the last level applies double: a sacrifice that ALMOST works loses material for nothing. Calculate to the mate, or to the clear win, or do not sacrifice.',
          ],
          'Sacrifice for lines, tempo, or defenders. Never for vibes.',
        ),
        demo('The queen as bait', ['Qd8+ strips the f8 king of his last defender. The bishop must take, and the e-file rook ends it.'], 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', {
          moves: ['Qd8+', 'Bxd8', 'Re8#'],
          caption: 'Queen for one defender, mate for the game',
        }),
        drill('Strip the defender', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Play the queen sacrifice to mate', 'The bishop on e7 guards e8. Remove him with interest.', 'Qd8 plus check, Bxd8 forced, Re8 mate. Three moves, one defender, zero king.'),
        quiz('Sacrifice checklist', 'Before sacrificing, which question is NOT optional?', [
          right('What exactly does the sacrifice buy, and can I calculate the follow-up?', 'Lines, tempo or defenders. If you cannot name it and calculate it, the sacrifice is gambling.'),
          wrong('Will it look brilliant', 'Brilliance is retrospective. Correctness is now.'),
          wrong('Is my rating at stake', 'Irrelevant to the position.'),
        ]),
      ],
    },
    {
      id: 'adv-04',
      n: 4,
      title: 'Storms and battering rams',
      subtitle: 'Opening the wall where the king hides.',
      minutes: 9,
      steps: [
        text(
          'Two ways in',
          [
            'Opposite-side castling turns the game into a race: both players throw pawns at the enemy king, and whoever opens the file first usually mates first. g4, g5, h4, h5: the pawns clear their own squares for rooks and evict the defenders.',
            'Same-side castling is slower: pawns storming at your own king is madness, so you open lines with piece pressure and one calculated pawn break, like f4-f5 or g4-g5 after careful preparation.',
          ],
          'Opposite wings: race. Same wing: prepare, then break.',
        ),
        demo('The race', ['White rolls h4-h5 while the pieces stay ready. Every tempo counts: the first opened file is usually the game.'], 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', {
          moves: ['h4', 'h5'],
          caption: 'Rolling pawns, saving tempi',
        }),
        drill('Roll the storm', 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', ['h4'], 'Start the pawn storm', 'The h-pawn goes first. The rook follows on h1.', 'h4. The race begins. Every storm is a sequence: pawns first, pieces through the gap.'),
        quiz('Storm priority', 'In an opposite-side castling race, what is the fastest route to the king?', [
          right('Pawn storm to force the defenders away, then heavy pieces on the opened file', 'Pawns clear the road; rooks and queen use it.'),
          wrong('Knight maneuvering in the center', 'The center can wait. The race has a clock.'),
          wrong('Trading queens early', 'Queens mate. Trading them usually calms the race down.'),
        ]),
      ],
    },
    {
      id: 'adv-05',
      n: 5,
      title: 'The counterattack',
      subtitle: 'When attacked, ask where THEY are weak.',
      minutes: 9,
      steps: [
        text(
          'Answer force with force',
          [
            'Against an attack, defense has three gears: trade (Intermediate tier), consolidate, and counterattack. The counterattack is the strongest: it makes the attacker spend tempi defending instead of pressing.',
            'The rule: a counterattack only works when it creates check or immediate material threat. Otherwise it is just a distraction that loses by one tempo.',
          ],
          'Counter only with checks or captures. Everything else is a handshake.',
        ),
        drill('Hit back with capture', '4k3/8/8/8/R2q4/8/8/4K3 w - - 0 1', ['Rxd4'], 'Your rook is attacked by the queen. Punch back.', 'The queen is on the same rank and nothing defends her.', 'Rxd4. The attack was answered with a capture. The queen left the board, and with her every threat.'),
        quiz('Counterattack condition', 'Your kingside is under attack. You spot a pawn grab on the queenside that wins a pawn in three quiet moves. Play it?', [
          right('No: it is too slow. Counterattacks must come with check or immediate threat', 'Three quiet moves is three tempi for the attacker. Dead on arrival.'),
          wrong('Yes: material is material', 'Not while your king is being opened up.'),
          wrong('Only if you are behind', 'The clock of the attack decides, not the scoreboard.'),
        ]),
        quiz('Defense first', 'Their attack has a queen and rook aimed at your king. Your dark-squared bishop is free. Where does it belong?', [
          right('Defending, until the attack is traded down', 'Defense first. Counterattacks come from stable positions.'),
          wrong('Joining a pawn storm on the other wing', 'Two races, one clock: theirs is faster.'),
          wrong('On its best attacking square anyway', 'Best square for WHO? The attacker’s threats set the agenda.'),
        ]),
      ],
    },
    {
      id: 'adv-06',
      n: 6,
      title: 'Weak color complexes',
      subtitle: 'When one color of squares goes dark.',
      minutes: 9,
      steps: [
        text(
          'Squares come in colors',
          [
            'Trade away your light-squared bishop and every light square in your camp gets nervous forever, because no pawn can ever cover them all.',
            'Attackers love this: pieces invade on the missing color, and the defender needs TWO pieces to watch what ONE used to hold. Fixing a weak color complex is impossible; you can only pile pieces on the entry squares and hope.',
          ],
          'The missing bishop leaves a permanent shadow. Attack into it.',
        ),
        demo(
          'Reading the shadows',
          ['After the g-pawn advances and the dark bishop is traded, the dark squares f3, h3 and g2? No: the entry points are the dark squares around the king. Mark them and remember: pawns cannot come back.'],
          'r1bq1rk1/ppp1bppp/2n2n2/8/8/2N2N2/PPPPBPPP/R1BQK2R w KQ - 8 7',
          {
            marks: [
              { square: 'f3', color: 'yellow' },
              { square: 'h3', color: 'yellow' },
              { square: 'd4', color: 'yellow' },
            ],
            caption: 'Yellow: squares the dark bishop used to police',
          },
        ),
        quiz('Color complex rule', 'Your opponent traded his dark-squared bishop. Where do your dark-squared pieces belong?', [
          right('Deep in his camp, on the dark squares his pawns can never cover', 'The missing color is a permanent invitation.'),
          wrong('Anywhere central', 'The center is fine, but the colored holes are better.'),
          wrong('Defending your own king', 'That is where you play when you have the weak color complex, not when you have the attacker.'),
        ]),
        quiz('Fixing shadows', 'Your own king sits on a weak color complex. Which fix is real?', [
          right('Trade the attacker that invades that color, and avoid giving up your remaining bishop of that color', 'You cannot repair the squares, but you can evict the tenants.'),
          wrong('Push pawns to cover the squares', 'Pawns cannot move backward. Pushing usually opens MORE squares of that color.'),
          wrong('Ignore it, color complexes are a myth', 'Tell that to every game lost on a light-square invasion.'),
        ]),
      ],
    },
    {
      id: 'adv-07',
      n: 7,
      title: 'Blockade and deep outposts',
      subtitle: 'Some squares are addresses, not stops.',
      minutes: 9,
      steps: [
        text(
          'The permanent residence',
          [
            'A knight on an outpost in the ENEMY half attacks pieces without ever being attacked back. The advanced version: an outpost supported by a pawn, from which the knight watches two targets and cannot be traded for a pawn.',
            'A blockade works the same way against pawns: park a knight (ideally) in front of an enemy passed pawn and the pawn becomes scenery. Nimzowitsch built a whole school on this one idea.',
          ],
          'Plant it where pawns cannot reach. Leave it there for the rest of the game.',
        ),
        demo('The knight as landlord', ['The knight on d5 collects rent forever: no black pawn can ever evict it, and it eyes c7, e7 and f6.'], '4k3/2p1p3/8/3N4/8/8/8/4K3 w - - 0 1', {
          marks: [
            { square: 'd5', color: 'green' },
            { square: 'c7', color: 'yellow' },
          ],
          caption: 'Green: home. Yellow: the rent it collects.',
        }),
        drill('Take the residence', '4k3/2p1p3/8/8/8/8/8/1N2K3 w - - 0 1', ['Nc3', 'Kd7', 'Nd5'], 'March the knight to its forever square', 'Two hops: c3, then the outpost.', 'Nd5. The knight now outvalues a rook in practical terms. Position first, arithmetic second.'),
        quiz('Blockade piece', 'Which piece blockades a passed pawn best?', [
          right('The knight', 'Knights blockade perfectly: they attack around the pawn and can never be pushed off by it.'),
          wrong('The bishop', 'Bishops sit on one color: a pawn on the wrong color is invisible to them.'),
          wrong('The queen', 'A blockading queen is a spectator. The strongest piece wastes its whole life watching one pawn.'),
        ]),
      ],
    },
    {
      id: 'adv-08',
      n: 8,
      title: 'Space and maneuvering',
      subtitle: 'More room, better pieces, no trades.',
      minutes: 9,
      steps: [
        text(
          'Room to breathe',
          [
            'A space advantage means your pieces can redeploy and his cannot. The plan: improve your worst piece, avoid trades, and slowly build pressure until the cramped side cracks or blunders.',
            'When YOU are cramped, the logic flips: trade pieces (not pawns), challenge the space-grabbing pawn, and free your game with a pawn break.',
          ],
          'With space: maneuver and refuse trades. Cramped: trade and break.',
        ),
        demo(
          'Measuring the room',
          ['White owns the center and the queenside files. Every white piece has four squares to improve to; every black piece has one.'],
          'r1bqk2r/pppp1ppp/2n5/8/3P4/2N5/PPP2PPP/R1BQKB1R w KQkq - 4 6',
          {
            marks: [
              { square: 'd4', color: 'green' },
              { square: 'd5', color: 'yellow' },
            ],
            caption: 'Green: your room. Yellow: his ceiling.',
          },
        ),
        quiz('Cramped side rule', 'You are badly cramped. What do you trade?', [
          right('Pieces. Fewer pieces fit into little space', 'Trades relieve congestion. Pawn trades open lines you cannot use yet.'),
          wrong('Pawns', 'Pawn trades give the opponent open files. You have no rooks ready for them.'),
          wrong('Nothing, hold everything', 'Passivity does not uncramp anything.'),
        ]),
        drill('Breathe out', 'r3k2r/ppp2ppp/2n5/8/3P4/8/PPP2PPP/RNBQKB1R w KQkq - 6 7', ['d5'], 'Your center pawn is ready to release the tension', 'd4-d5 frees the c1 bishop and opens lines while you are the one with space.', 'd5. The break: space converts into lines and tempo. Cramped positions hate exactly this.'),
      ],
    },
    {
      id: 'adv-09',
      n: 9,
      title: 'Pawn chains',
      subtitle: 'Attack the base. Know when to release.',
      minutes: 9,
      steps: [
        text(
          'Chains point where to play',
          [
            'A pawn chain has a head (most advanced) and a base (rearmost). The base is the only pawn in the chain nothing else can defend with a pawn. Attack the base; the whole structure strains.',
            'The golden rule from Nimzowitsch: play on the side where your chain POINTS. If your pawns point at the kingside (they are higher there), attack the kingside; the chain grants space there and locks your bishops in the other direction.',
          ],
          'Base gets attacked. Direction gets attacked. Both at once, if you can.',
        ),
        demo('Find the base', ['Three black pawns in a row. The base is the rearmost one: e5. Attack it and the chain bends.'], '4k3/8/8/2ppp3/8/8/8/R3K3 w - - 0 1', {
          marks: [
            { square: 'e5', color: 'red' },
            { square: 'c5', color: 'yellow' },
          ],
          caption: 'Red: the base. Yellow: the head.',
        }),
        drill('Hit the base', '4k3/8/8/2ppp3/8/8/8/K6R w - - 0 1', ['Re1'], 'Put the rook where it attacks the chain\u2019s base', 'The e-file leads straight to the rearmost pawn.', 'Re1. The base is under fire, and the black pieces must now babysit their own structure.'),
        quiz('Chain direction', 'Your pawn chain is tallest on the queenside (a4, b5 vs his a6, b7). Which side should you play on?', [
          right('The queenside, where your chain points and grants space', 'The chain direction rule: play where you have the room.'),
          wrong('The kingside, to keep them guessing', 'Guessing loses to geometry.'),
          wrong('The center, always', 'The center is a habit, not a rule.'),
        ]),
      ],
    },
    {
      id: 'adv-10',
      n: 10,
      title: 'Practice arena: calculation',
      subtitle: 'Forcing moves under pressure.',
      minutes: 10,
      steps: [
        text(
          'Calculate like it counts',
          [
            'Five rounds. For each, list candidates in your head BEFORE moving: checks, captures, threats.',
            'The drills reward the scan, not the memory. If you solve by recognition, good: that is the point of pattern training.',
          ],
        ),
        drill('Mate in one', '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re8#'], 'Checks first.', 'One rook check exists.', 'Re8 mate.'),
        drill('The full calculation', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Find the forced mate', 'Sacrifice, forced reply, open file.', 'Three forcing moves, one mate. That is calculation.'),
        drill('Hit the base', '4k3/8/8/2ppp3/8/8/8/K6R w - - 0 1', ['Re1'], 'Attack the chain where it hurts', 'Rearmost pawn first.', 'Re1. The base buckles.'),
        playout(
          'Calculation test',
          'Full game. Run the scan on every move.',
          START,
          'w',
          'Win at least 3 points of material within 20 moves',
          4,
          'material',
          20,
          'Discipline holds. On to structures and openings.',
        ),
      ],
    },
    {
      id: 'adv-11',
      n: 11,
      title: 'Openings with a purpose',
      subtitle: 'Repertoires are plans, not memorization.',
      minutes: 10,
      steps: [
        text(
          'Why you play what you play',
          [
            'A repertoire is a set of positions you UNDERSTAND. 1.e4 opens lines for pieces and leads to classical central tension: the Italian and Ruy Lopez families. 1.d4 grabs the center with pawns and leads to closed, strategic struggles.',
            'Pick by taste and by plan. Aggressive, open positions: 1.e4. Slow builds and structures: 1.d4. Then learn the IDEAS of your lines, five moves deep, instead of twenty moves shallow.',
          ],
          'Five moves of understanding beat twenty moves of memory.',
        ),
        demo('Two philosophies', ['The Italian: open lines, fast development, early tension. The Ruy: the same ideas with slower, tighter piece play. Both are lifetime openings.'], START, {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5', 'c3', 'd6', 'O-O', 'O-O'],
          caption: 'The Italian Game, fully developed',
        }),
        drill('Play the idea', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', ['Nf3'], 'Black took the center. Develop with a threat', 'The g1 knight attacks e5 on the way out.', 'Nf3. Development and tempo in one move: the whole point of 1.e4 openings.'),
        quiz('1.e4 vs 1.d4', 'Which first move leads most directly to open, tactical middlegames?', [
          right('1.e4', 'It frees the bishop and queen immediately and invites central tension.'),
          wrong('1.d4', 'Strong too, but the structures run slower and more closed.'),
          wrong('1.Nf3', 'Flexible, but it postpones the pawn decision rather than forcing open play.'),
        ]),
      ],
    },
    {
      id: 'adv-12',
      n: 12,
      title: 'Isolated queen\u2019s pawn',
      subtitle: 'The most debated pawn in chess.',
      minutes: 10,
      steps: [
        text(
          'Dynamic versus static',
          [
            'After 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.cxd5 exd5, Black owns an isolated pawn on d5. The holder gets space, open lines for pieces, and the beautiful d5 square OUTPOSTS nearby; the non-holder gets a permanent endgame target.',
            'The IQP side must play actively: piece pressure, the c-file, d5-d4 breaks when possible. Trading into an endgame with an isolated pawn is how the advantage changes owners. As the defender: blockading pieces, trades, and patience.',
          ],
          'IQP: activity now or pay later. Defender: trade and tighten.',
        ),
        demo(
          'The isolani on d5',
          ['Black\u2019s d5 pawn can never be defended by another pawn. White\u2019s pieces will spend the middlegame staring at it, and the endgame salivating.'],
          'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5',
          { marks: [{ square: 'd5', color: 'red' }], caption: 'Red: forever alone' },
        ),
        drill('Support the center', 'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5', ['e3'], 'White to move: complete the classical setup', 'The e-pawn supports d4 and frees the f1 bishop.', 'e3. Solid development. The middlegame plans come next: Re1, Bd3, pressure.'),
        quiz('IQP endgame rule', 'The player FACING an isolated pawn should generally...', [
          right('Trade pieces and reach an endgame where the pawn falls', 'Endgames are where the isolani stops being dynamic and starts being weak.'),
          wrong('Avoid all trades', 'Pieces matter in middlegames. Trades are the defender\u2019s friend here.'),
          wrong('Attack the enemy king immediately', 'The IQP holder is usually the better attacker. The defender trades.'),
        ]),
      ],
    },
    {
      id: 'adv-13',
      n: 13,
      title: 'Lucena: the bridge',
      subtitle: 'The most important winning position in rook endgames.',
      minutes: 10,
      steps: [
        text(
          'Build a bridge',
          [
            'King in front of his own 7th-rank pawn, rook nearby, enemy king cut off: this is Lucena, and it wins. The enemy rook checks your king from behind, so you build a BRIDGE: interpose your own rook on the checking file, sheltered by the pawn.',
            'Walk the king toward the checks (c7, b6, c6, b5 here), absorb them, then Rb4! The enemy rook must take, your king recaptures, and the pawn queens alone.',
          ],
          'King out, checks absorbed, rook interposes on the checking file.',
        ),
        demo('The full bridge', ['The classic Lucena march: four king steps, one rook lift, one capture, one promotion race won.'], '3K4/3P2k1/8/8/7R/8/6r1/8 w - - 0 1', {
          moves: ['Kc7', 'Rc2+', 'Kb6', 'Rb2+', 'Kc6', 'Rc2+', 'Kb5', 'Rb2+', 'Rb4', 'Rxb4+', 'Kxb4'],
          caption: 'The bridge is built, the win is book',
        }),
        drill('Build the bridge', '8/3P2k1/8/1K6/7R/8/1r6/8 w - - 0 1', ['Rb4', 'Rxb4+', 'Kxb4'], 'The black rook checks on the b-file. One move builds the shelter.', 'Interpose the rook where the checks land: b4, right next to your king.', 'Rb4! The bridge. After the trade the pawn walks to d8 alone. This position wins a hundred games a year.'),
        quiz('Lucena requirement', 'Lucena wins because...', [
          right('Your king shelters on the checking file behind your own rook', 'The bridge absorbs all rear checks. The pawn promotes unopposed.'),
          wrong('Your rook is stronger', 'Rooks are equal. The PAWN plus the bridge decides.'),
          wrong('The enemy king is far away', 'Distance helps but is not required. The bridge is the mechanism.'),
        ]),
      ],
    },
    {
      id: 'adv-14',
      n: 14,
      title: 'Philidor: rear checks',
      subtitle: 'The most important drawing position in rook endgames.',
      minutes: 10,
      steps: [
        text(
          'Checks from behind',
          [
            'Defending a rook endgame a pawn down: keep your rook BEHIND the enemy pawn on its promotion file, or on the rank in front of the enemy king. The famous Philidor defense: park the rook on the first rank, and the moment the pawn advances to the 6th, give endless rear checks.',
            'The king can never escape the checks, the rook never runs out of them, and the game is drawn. Miss this technique and every Lucena in history gets to win.',
          ],
          'Rook behind the pawn. Checks forever. Draw forever.',
        ),
        demo('The checks begin', ['White tries to make progress; the rook checks along every file the king visits, and the black king permanently guards the promotion square.'], '4k3/8/4K3/4P3/8/8/8/7r w - - 0 1', {
          moves: ['Kd6', 'Rd1+', 'Kc6', 'Rc1+'],
          caption: 'Checks forever. e7 is blockaded. Draw.',
        }),
        drill('Take the draw', '4k3/8/4K3/4P3/8/8/8/7r b - - 0 1', ['Rd1'], 'Black to move: park the rook on the checking file', 'The first rank is the patrol road. d1 watches the file the white king must cross.', 'Rd1. Rear-rank checks are now guaranteed forever. White can shuffle; so can you.'),
        quiz('Philidor rule', 'When does the defender\u2019s rook switch to rear checks?', [
          right('The moment the pawn steps onto the 6th rank (or its 3rd from Black\u2019s side)', 'Before that, the rook waits on the first rank. The timing is the whole technique.'),
          wrong('Immediately, always checking', 'Early checks let the king hide in front of the pawn. Patience first.'),
          wrong('Never, passivity draws', 'Passivity loses. The rear checks ARE the activity.'),
        ]),
      ],
    },
    {
      id: 'adv-15',
      n: 15,
      title: 'Rook activity',
      subtitle: 'Cutting off, behind passed pawns, the active king.',
      minutes: 10,
      steps: [
        text(
          'Three rook rules',
          [
            'Rule one: the rook belongs BEHIND passed pawns, yours or theirs. Behind your pawn: an escort. Behind theirs: a sheepdog.',
            'Rule two: cut the enemy king off. A rook on a file or rank the king cannot cross turns him into a bystander.',
            'Rule three: the king marches up and fights. In rook endgames the king is a fighting piece from move one of the ending.',
          ],
          'Behind pawns, across the king, king marches.',
        ),
        drill('Sheepdog duty', '4k3/8/8/3p4/8/8/8/R3K3 w - - 0 1', ['Rd1'], 'The black d-pawn is running. Herd it from behind.', 'The d-file: the rook sits behind the pawn and farms it.', 'Rd1. The pawn cannot run; the rook attacks from behind. This is where rook endgames are won.'),
        drill('Build the wall', '7k/8/8/8/8/8/8/R3K3 w - - 0 1', ['Ra5'], 'Cut the king out of the game', 'One rank is a whole border.', 'Ra5. The king is fenced. Your king walks up at total leisure.'),
        quiz('Active king', 'Rook endgame reached. Where does your king go?', [
          right('March to the center, immediately', 'King activity decides rook endings more than rook activity.'),
          wrong('Stay home defending pawns', 'That is how won rook endings become drawn ones.'),
          wrong('Hug the rook', 'They do not defend each other from enemy checks anyway.'),
        ]),
      ],
    },
    {
      id: 'adv-16',
      n: 16,
      title: 'Opposite bishops',
      subtitle: 'Drawish, until an outside passed pawn changes everything.',
      minutes: 10,
      steps: [
        text(
          'The missing color strikes',
          [
            'With bishops on opposite colors, neither can attack the other, and each defends its own color complex. A one-pawn edge is usually a draw: the defending bishop simply lives on the promotion color.',
            'The exception that wins: a SECOND passed pawn on the OPPOSITE color from the defending bishop\u2019s duties. The bishop stops one runner; the other, far away, promotes. Distance is the weapon.',
          ],
          'One runner is stopped. Two runners on both colors cannot be.',
        ),
        demo(
          'The outside runner',
          ['Opposite bishops, one white pawn on b2. The bishop will stop b2. Now imagine a second white pawn on h5: the bishop cannot be in two countries.'],
          '8/8/4k3/8/8/8/1P2B3/2B1K3 w - - 0 1',
          {
            marks: [
              { square: 'b2', color: 'green' },
              { square: 'h5', color: 'gold' },
            ],
            caption: 'Green: stoppable. Gold: unstoppable if it existed.',
          },
        ),
        drill('Run the pawn', '8/8/4k3/8/8/8/1P2B3/2B1K3 w - - 0 1', ['b4'], 'Push the passed pawn with the king\u2019s support nearby', 'The pawn walks; the king escorts; the bishop guards its color.', 'b4. One runner, but with correct technique it becomes a queen. The lesson: create a SECOND one on the other color to beat a real defender.'),
        quiz('Opposite bishop plan', 'You hold opposite bishops with an extra outside passed pawn. The winning recipe is...', [
          right('Sacrifice to win a second pawn on the other color complex', 'One bishop cannot police two colors.'),
          wrong('Trade bishops to race pawns', 'Without bishops the defense gets EASIER: king catches one runner.'),
          wrong('Push the passed pawn alone', 'One runner against a correct bishop is a draw. You need the second front.'),
        ]),
      ],
    },
    {
      id: 'adv-17',
      n: 17,
      title: 'Knight versus bishop',
      subtitle: 'The eternal argument, settled by structure.',
      minutes: 10,
      steps: [
        text(
          'Structure decides',
          [
            'The knight wins closed positions with outposts and fixed pawn structures: it jumps over walls the bishop only stares at. The bishop wins open positions with long diagonals, fast races and wing attacks.',
            'The verdict rule: count what the pawns promise. Locked center, pawns on both wings: knight. Open diagonals, pawns on one wing: bishop. In equal structures, bishops have the better long-range statistics, which is why the bishop pair is worth half a pawn.',
          ],
          'Closed: knight. Open: bishop. The pawns vote first.',
        ),
        demo('The gated community', ['The knight lives on d5 behind locked pawn doors. The enemy bishop, wherever it goes, watches walls.'], '4k3/2p1p3/8/3N4/8/8/8/4K3 w - - 0 1', {
          marks: [
            { square: 'd5', color: 'green' },
            { square: 'f6', color: 'yellow' },
          ],
          caption: 'Green: residence. Yellow: the next address.',
        }),
        drill('Expand the empire', '4k3/2p1p3/8/3N4/8/8/8/4K3 w - - 0 1', ['Nf6+'], 'The knight finds a second job from its outpost', 'From d5, one hop checks the king and looks at h7.', 'Nf6 plus check. After the king moves, the knight has e8, d7 and h7 in its web. The bishop never laid a glove on it.'),
        quiz('Knight vs bishop', 'Pawns are locked on both wings with a fixed center. Which minor piece is stronger?', [
          right('The knight', 'Closed structures give knights outposts and walls to jump over.'),
          wrong('The bishop', 'Open diagonals only exist where pawns are not. There are none here.'),
          wrong('They are identical in any structure', 'Structure is the entire verdict.'),
        ]),
      ],
    },
    {
      id: 'adv-18',
      n: 18,
      title: 'Queen endings',
      subtitle: 'Checks, forks, and the perpetual road.',
      minutes: 10,
      steps: [
        text(
          'Danger and salvation',
          [
            'Queen endings are the most tactical of all: two queens create forks, skewers and perpetual checks out of thin air. An extra pawn means little; checkmating patterns mean everything.',
            'For the defending side, the perpetual check is the lifeline: park your queen behind the enemy king and check along ranks or files until the attacker gives up or agrees to the draw.',
          ],
          'Queens see everything. Guard your king, or check his forever.',
        ),
        demo('The eternal checks', ['Qd8+ drives the king down the board, and the queen follows along the ranks, checking forever.'], '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', {
          moves: ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'],
          caption: 'And so on, forever. Draw.',
        }),
        drill('Run the checks', '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'], 'Drive the king with rank checks', 'Every check is one rank lower. The king never reaches shelter.', 'Four checks and counting. The queen owns the ranks. This is the road to half a point.'),
        playout(
          'Finish with the queen',
          'Queen and king against a lone king. Shrink the box, walk the king in, mate without stalemate.',
          '7k/8/8/8/8/8/8/K6Q w - - 0 1',
          'w',
          'Checkmate the black king',
          2,
          'checkmate',
          25,
          'Queen mate delivered. Watch the corner: stalemate is the only way to fail here.',
          'Reset. Queen a knight-move away, king escorts, no stalemate traps in the corner.',
        ),
      ],
    },
    {
      id: 'adv-19',
      n: 19,
      title: 'Converting winning endgames',
      subtitle: 'King centralization and simplification.',
      minutes: 10,
      steps: [
        text(
          'The conversion checklist',
          [
            'Up material in an endgame: centralize your king first (he is the best escort and the best attacker), keep pawns (they are the winning margin), trade pieces only when it kills counterplay.',
            'Then ask every move: does this reduce my opponent\u2019s activity? If yes, play it. Technique is the systematic removal of everything the opponent wanted to do.',
          ],
          'King up, pawns kept, counterplay deleted.',
        ),
        quiz('Conversion priorities', 'You are up a clean piece in a rook ending. Rank these: (1) trade pawns, (2) centralize the king, (3) trade rooks.', [
          right('2 first, then 3 when safe, never 1', 'King activity is the engine; rook trades reduce counterplay; pawns are the win itself.'),
          wrong('1 first: fewer pawns, less risk', 'Fewer pawns is literally less winning margin.'),
          wrong('3 immediately at any cost', 'Rook trades only help when your king is already active and the pawn structure is safe.'),
        ]),
        drill('Activate the king', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', ['Kd2'], 'The rook endgame starts now. Best first move?', 'The king marches to the center. Rook moves can wait.', 'Kd2. The king joins the fight immediately. This is what converting looks like.'),
        playout(
          'Full conversion',
          'Rook and king versus king. Centralize, cut off, mate. The full technique in one game.',
          '7k/8/8/8/8/8/8/R3K3 w - - 0 1',
          'w',
          'Checkmate the black king',
          2,
          'checkmate',
          25,
          'Converted with technique. This exact routine wins real tournament games.',
          'Reset: rook cuts a rank, king marches, repeat. Keep the rook at checking distance from the king.',
        ),
      ],
    },
    {
      id: 'adv-20',
      n: 20,
      title: 'Advanced graduation',
      subtitle: 'One exam, one game, tier cleared.',
      minutes: 15,
      steps: [
        text(
          'The exam',
          [
            'Two questions and a full game against the level 5 engine.',
            'The Master tier raises the stakes: imbalances, prophylaxis, and positions where judgment matters more than calculation.',
          ],
          'Prove the tier, then move up.',
        ),
        quiz('Lucena or Philidor', 'Your rook endgame: you are a pawn UP with king in front of your 7th-rank pawn. Which technique applies?', [
          right('Lucena: build the bridge and win', 'Winning setup: bridge, absorb checks, promote.'),
          wrong('Philidor: draw with rear checks', 'That is the DEFENDER\u2019S tool. You are winning.'),
          wrong('Neither, just push the pawn', 'The enemy rook would eat the bare pawn. The bridge exists for a reason.'),
        ]),
        quiz('IQP verdict', 'You hold an isolated queen\u2019s pawn in the middlegame with active pieces. Your plan?', [
          right('Attack with the pieces now; avoid simplification', 'The IQP earns its keep with activity. Endgames betray it.'),
          wrong('Trade pieces and go to an endgame', 'That is the opponent\u2019s plan, not yours.'),
          wrong('Defend passively behind the pawn', 'The pawn cannot be defended passively. It can only be avenged.'),
        ]),
        playout(
          'Graduation game',
          'Beat the level 5 engine on material within 20 moves.',
          START,
          'w',
          'Win 3 or more points of material within 20 moves',
          5,
          'material',
          20,
          'Advanced tier cleared. The Master tier is watching.',
        ),
      ],
    },
  ],
}
