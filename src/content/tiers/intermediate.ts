// Tier 3: Intermediate. Tactical weapons, positional fundamentals, first
// endgame technique.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const intermediate: Tier = {
  id: 'intermediate',
  n: 3,
  title: 'Intermediate',
  tagline: 'Tactical weapons, positional fundamentals, endgame technique.',
  color: '#3f8f8a',
  levels: [
    {
      id: 'int-01',
      n: 1,
      title: 'Double attack',
      subtitle: 'Any piece can hit two targets at once.',
      minutes: 8,
      steps: [
        text(
          'Two targets, one move',
          [
            'The fork is the knight\u2019s specialty, but every piece can attack two things in one move. A queen slides to a square that hits one piece on its rank and another on its file. A rook lands on a line that touches two loose pieces.',
            'The recipe is always the same: find two enemy pieces that are undefended or badly defended, then look for one square that attacks them both. Loose pieces drop off, so aim at loose ones first.',
          ],
          'One move, two victims: scan for pieces that share a line.',
        ),
        demo(
          'The shared rank',
          ['The rook on a5 and the bishop on g5 both stand on rank 5. The queen on d1 can reach the middle of that rank in one move.'],
          '6k1/8/8/r5b1/8/8/8/3QK3 w - - 0 1',
          { marks: [{ square: 'd5', color: 'green' }], caption: 'Qd5 hits both pieces at once' },
        ),
        drill('Hit them both', '6k1/8/8/r5b1/8/8/8/3QK3 w - - 0 1', ['Qd5+'], 'Attack the rook and the bishop in one move', 'The middle of rank 5 does the job.', 'Qd5 with check. Two loose pieces, one move. One of them falls next turn no matter what Black saves.'),
        drill('Rook double attack', '3r2k1/8/8/8/8/8/5K2/R6b w - - 0 1', ['Rd1'], 'The bishop on h1 and the rook on d8 are both in reach. Find the square.', 'd1 sits on the d-file and the first rank at the same time.', 'Rd1. The bishop on h1 and the rook on d8 are both under fire. Only one can be saved.'),
        quiz('Choosing targets', 'What makes the best double attack?', [
          right('Two targets that are both undefended or worth more than your attacker', 'Then whatever your opponent saves, you win material.'),
          wrong('Any two pieces anywhere', 'A double attack against two defended, cheap pieces usually wins nothing.'),
          wrong('Two attacks against the king', 'There is only one king. The second target should be material or a mating square.'),
        ]),
      ],
    },
    {
      id: 'int-02',
      n: 2,
      title: 'Discovered attack',
      subtitle: 'Move one piece, unleash the one behind it.',
      minutes: 8,
      steps: [
        text(
          'The hidden battery',
          [
            'When two of your pieces stand on the same line, the front one blocks the back one. Move the front piece and the back piece suddenly attacks: that is a discovered attack.',
            'If the line points at the king, the moving piece delivers check and a threat at the same time, and your opponent can only parry one. Discovered check is one of the most violent weapons in chess.',
          ],
          'Two pieces on one line: every move of the front piece is a threat.',
        ),
        demo(
          'Double check',
          ['The knight on e4 shields the rook on e1 from the king on e8. Nd6 opens the file AND jumps next to the king: double check.'],
          '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1',
          { moves: ['Nd6+'], caption: 'The rook checks, the knight checks: nothing blocks a double check' },
        ),
        drill('Open the file', '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', ['Nd6+'], 'Attack the king with the rook by moving the knight', 'The e-file is the line. The knight must land somewhere useful on its way out.', 'Nd6 plus check, twice over. The king must run; the knight also eyes e8.'),
        drill('Unleash the bishop', 'k7/6pp/8/4N3/8/8/8/1B4K1 w - - 0 1', ['Nf7'], 'The bishop on b2 is tired of waiting behind the knight', 'Any knight move opens the b2 to g7 diagonal. Choose one that also helps.', 'Nf7. The knight hops toward the king side while the bishop suddenly stares at g7. The pawn is doomed.'),
        quiz('Blocking a check', 'Your opponent delivers a double check (two pieces checking at once). Your options are...', [
          right('Move the king. That is all.', 'Against a double check, blocking and capturing are impossible: two different attackers must both be stopped.'),
          wrong('Block with a piece', 'You would need to block two lines at once. Impossible with one piece.'),
          wrong('Capture the piece that moved', 'The other checker still checks. Only the king move survives.'),
        ]),
      ],
    },
    {
      id: 'int-03',
      n: 3,
      title: 'The zwischenzug',
      subtitle: 'Before recapturing, ask: is there something stronger?',
      minutes: 8,
      steps: [
        text(
          'The move in between',
          [
            'A zwischenzug (German for intermediate move) is the habit of refusing the obvious reply. Before recapturing, check whether a check, a threat or a bigger capture comes first.',
            'The most famous beginner trap in chess works because of a zwischenzug: after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4?! 4.Nxe5??, Black does NOT recapture. Qg5 hits the knight on e5 and the g2 pawn at the same time. White grabs material and loses the queen.',
          ],
          'Capture, then pause: what is stronger than my recapture?',
        ),
        demo('The famous refusal', ['Instead of recapturing the knight, Black inserts Qg5: attacking the knight on e5 and the g2 pawn together. Watch the whole trap unfold.'], START, {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+'],
          caption: 'Black never recaptured, and won the queen',
        }),
        drill('Refuse the recapture', 'r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4', ['Qg5'], 'Your knight on d4 was just traded? No: White took the e5 pawn with the knight. Do NOT take the knight.', 'Find the square that attacks the knight on e5 and the pawn on g2 at once.', 'Qg5. The zwischenzug. White must lose material because he was greedy on move four.'),
        quiz('Zwischenzug trigger', 'When is the zwischenzug most likely to work?', [
          right('Right after a capture or exchange, when attention drops', 'Exchanges are the moment everyone plays automatically. That is where the extra check or threat lands.'),
          wrong('Only in the opening', 'It happens in every phase, especially in tactics-rich middlegames.'),
          wrong('Only when you are losing', 'It wins material at any score.'),
        ]),
      ],
    },
    {
      id: 'int-04',
      n: 4,
      title: 'Deflection',
      subtitle: 'Pull the defender away, then strike.',
      minutes: 8,
      steps: [
        text(
          'Fire the bodyguard',
          [
            'A defender can guard only one duty at a time. Deflection attacks the defender, forcing it to abandon its post.',
            'The classic form: the enemy rook guards the back rank. You offer your queen on the same rank as the rook. The rook must capture, and now your other rook ends the game on the opened line.',
          ],
          'Attack the guard, not the king. The king falls after.',
        ),
        demo('Back rank deflection', ['R1d8+ pulls the a8 rook to d8. The second rook recaptures with mate: the back rank never had a second defender.'], 'r5k1/5ppp/8/8/8/8/3R4/3R2K1 w - - 0 1', {
          moves: ['Rd8+', 'Rxd8', 'Rxd8#'],
          caption: 'The rook was bait. The twin rook finished.',
        }),
        drill('Bait the rook', 'r5k1/5ppp/8/8/8/8/3R4/3R2K1 w - - 0 1', ['Rd8+', 'Rxd8', 'Rxd8#'], 'Mate in three by deflecting the a8 rook', 'Offer the first rook on the back rank with check. The twin rook is waiting behind it.', 'Rd8 plus check, rook takes, rook recaptures: mate. This is deflection in its purest form.'),
        quiz('Spotting deflection', 'An enemy rook guards both its king on the back rank and a knight on b2. What is the plan?', [
          right('Attack one duty so hard the rook must abandon the other', 'Deflection wins wherever a piece has two jobs.'),
          wrong('Attack the king directly', 'The rook guards it. Remove the guard first.'),
          wrong('Trade everything off', 'Trading the defender\u2019s enemies helps the defender.'),
        ]),
      ],
    },
    {
      id: 'int-05',
      n: 5,
      title: 'Decoy and clearance',
      subtitle: 'Lure to a doomed square, sweep the road behind you.',
      minutes: 8,
      steps: [
        text(
          'Two ways to move the enemy',
          [
            'A decoy forces an enemy piece onto a square where a tactic kills it: check the king onto a line, offer a capture onto a fork square.',
            'Clearance is the mirror image with your own pieces: a capture or pawn push empties a square or line so a bigger force can use it. The pawn that captures on f6 and vanishes from the e-file has just opened a rook highway.',
          ],
          'Decoy: pull them in. Clearance: push your own out of the way.',
        ),
        demo('Open the e-file', ['exf6 captures a pawn AND clears the e-file. The rook on e1 now stares at the rook on e8.'], '4r1k1/5p2/5p2/4P3/8/8/8/4R1K1 w - - 0 1', {
          moves: ['exf6', 'Rd8'],
          caption: 'One capture, two jobs: material and an open file',
        }),
        drill('Clear with tempo', '4r1k1/5p2/5p2/4P3/8/8/8/4R1K1 w - - 0 1', ['exf6', 'Rd8'], 'Open the e-file by capturing', 'The pawn takes f6 and stops blocking the rook behind it.', 'exf6. The e-file is open and the pawn attacks g7 as a bonus. Clearance moves that also threaten are gold.'),
        quiz('Decoy target', 'Which square is the classic decoy destination for a king?', [
          right('A square where a knight fork or a mating net is waiting', 'Lure the king to the geometry that kills him.'),
          wrong('The center, always', 'The center is often the SAFEST place for a king in an endgame.'),
          wrong('A defended square', 'A decoy must move the king somewhere WORSE. Defended squares rarely qualify.'),
        ]),
      ],
    },
    {
      id: 'int-06',
      n: 6,
      title: 'Outposts and weak squares',
      subtitle: 'Plant a knight where it can never be evicted.',
      minutes: 8,
      steps: [
        text(
          'A square with a no-eviction notice',
          [
            'An outpost is a square on the enemy half that their pawns can never attack. A knight planted there dominates the board: it attacks pieces without ever being chased.',
            'Weak squares are born from pawn moves. Every pawn push gives up control of two squares forever. When the c- and e-pawns advance, the d5 square becomes a no man\u2019s land.',
          ],
          'Find the square their pawns abandoned. Park a knight there.',
        ),
        demo('The perfect parking spot', ['No black pawn can ever attack e5. The knight travels there for a lifetime appointment.'], 'r1bqk2r/pppp1ppp/8/8/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6', {
          moves: ['Ne5'],
          caption: 'e5: an outpost with a view',
        }),
        drill('Establish the outpost', 'r1bqk2r/pppp1ppp/8/8/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 6', ['Ne5'], 'Plant the knight on the square Black can never attack', 'The c3 knight hops to the center outpost.', 'Ne5. Untouchable by pawns, attacking c6 and g6. The knight grows a point in value just by standing there.'),
        quiz('Outpost definition', 'What makes a square an outpost?', [
          right('No enemy pawn can ever attack it, and a piece can safely sit there', 'Pawn-proof squares are real estate. Pieces on them outperform their value.'),
          wrong('Any central square', 'The center matters, but a central square attacked by a pawn is a trap, not an outpost.'),
          wrong('A square next to the enemy king', 'Attack squares matter, but outposts are about permanence.'),
        ]),
      ],
    },
    {
      id: 'int-07',
      n: 7,
      title: 'Open files and the 7th rank',
      subtitle: 'Rooks need roads. Give them the best one.',
      minutes: 8,
      steps: [
        text(
          'Rook real estate',
          [
            'An open file (no pawns) or half-open file (only enemy pawns) is a rook highway. The first player to occupy it with a rook usually controls the game\u2019s rhythm.',
            'The 7th rank is the prize destination. Two rooks on the 7th eat every enemy pawn and lock the enemy king out of his own camp. Even one rook on the 7th is worth about a pawn on its own.',
          ],
          'Open the file, double the rooks, invade the 7th.',
        ),
        demo('Take the 7th', ['Rook to h7, rook to a7: the entire 7th rank is White\u2019s property.'], '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', {
          moves: ['Rh7', 'Kd8', 'Raa7'],
          caption: 'Two rooks own the 7th rank',
        }),
        drill('Seize the rank', '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', ['Rh7'], 'Invade the 7th rank with a rook', 'The h-file is clear all the way up.', 'Rh7. The rook is deep in enemy territory. The second rook would make it a feast.'),
        quiz('Rook value', 'When does a rook feel like a piece and a half?', [
          right('On an open file, ideally reaching the 7th rank', 'Activity, not the piece itself, decides rook value.'),
          wrong('Behind its own pawns on a closed file', 'That rook is watching a wall.'),
          wrong('Defending a corner', 'Passive rooks lose endgames by themselves.'),
        ]),
      ],
    },
    {
      id: 'int-08',
      n: 8,
      title: 'Pawn structure sins',
      subtitle: 'Doubled, isolated, backward: know what you create.',
      minutes: 8,
      steps: [
        text(
          'Pawns do not go back',
          [
            'Doubled pawns (two on one file) cannot defend each other. Sometimes their open file compensates; usually they are a long-term hangover.',
            'An isolated pawn has no neighbors, so no pawn can ever defend it. It must be guarded by pieces, and the square IN FRONT of it becomes an enemy outpost. That is the real cost: the isolani is a target AND a parking spot for the opponent.',
            'A backward pawn trails its neighbors and gets parked on. It blocks the file behind it too.',
          ],
          'Every pawn move trades a square for a weakness. Choose consciously.',
        ),
        demo('The isolani problem', ['The black d-pawn is alone. No black pawn can ever defend it, and d5/d6 in front of it is White\u2019s future outpost.'], '4k3/8/8/3p4/8/8/8/R3K3 w - - 0 1', {
          marks: [
            { square: 'd5', color: 'red' },
            { square: 'd6', color: 'yellow' },
          ],
          caption: 'Red: the target. Yellow: the enemy parking lot.',
        }),
        drill('Attack the isolani', '3k4/8/8/3p4/8/8/8/R3K3 w - - 0 1', ['Rd1', 'Kd7'], 'Attack the isolated pawn with the rook', 'The d-file is the direct road.', 'Rd1 hits the pawn. Black\u2019s king must baby-sit it forever, and the rook owns the file.'),
        quiz('Weakest structure', 'Which pawn is usually the most enduring weakness?', [
          right('The isolated pawn', 'Nothing can ever defend it with a pawn. Pieces get tied down for the whole game.'),
          wrong('A healthy majority pawn', 'A supported passed pawn is an asset, not a weakness.'),
          wrong('A doubled pawn on an open file', 'It can hurt, but the open file sometimes pays the rent.'),
        ]),
      ],
    },
    {
      id: 'int-09',
      n: 9,
      title: 'Good and bad bishops',
      subtitle: 'Same piece, wildly different jobs.',
      minutes: 8,
      steps: [
        text(
          'Ask what the pawns are doing',
          [
            'A bishop is good when its pawns sit on the opposite color, leaving its diagonals open. A bishop is bad when its own pawns block every diagonal it has.',
            'The bishop pair is a long-term bonus: with one bishop of each color you cover the whole board, and the pair often earns a half-point better practical results.',
            'Fixing a bad bishop: trade it, reroute it outside the pawn chain, or unblock the pawns. Letting it rot behind its own wall is how equal endgames are lost.',
          ],
          'Bishop quality = pawn structure. Check the color of your pawns.',
        ),
        demo('The walled-in bishop', ['The light-squared bishop has nothing to do: its own pawns stand on light squares. It is a tall pawn.'], '4k3/8/8/8/8/1p6/1P1B4/4K3 w - - 0 1', {
          marks: [
            { square: 'd2', color: 'red' },
            { square: 'b2', color: 'yellow' },
          ],
          caption: 'Red: the bad bishop. Yellow: its jailer.',
        }),
        drill('Free the prisoner', '4k3/8/8/8/8/1p6/1P1B4/4K3 w - - 0 1', ['Bg5'], 'Activate the bishop to its best diagonal', 'The long dark diagonal is waiting.', 'Bg5. The bishop is out of jail and eyeing the whole kingside.'),
        quiz('Bishop pair', 'Why is owning both bishops an advantage?', [
          right('Together they cover every square color on the board', 'One of them always has a target: no pawn structure can wall in both at once.'),
          wrong('Two bishops are worth more than a rook', 'Two bishops (6) usually still lose to a rook plus support. The pair is a positional, not material, edge.'),
          wrong('Bishops can jump', 'No piece jumps except the knight.'),
        ]),
      ],
    },
    {
      id: 'int-10',
      n: 10,
      title: 'Practice arena: weapons',
      subtitle: 'Mixed drills from the whole arsenal.',
      minutes: 10,
      steps: [
        text(
          'Everything you own',
          [
            'Five rounds, no new theory. Name the tactic before you move: double attack, discovery, zwischenzug, clearance.',
            'If one repeats an earlier position, that is the point: retrieval practice is what makes patterns permanent.',
          ],
        ),
        drill('Double attack', '6k1/8/8/r5b1/8/8/8/3QK3 w - - 0 1', ['Qd5+'], 'Hit two pieces with one move', 'Rank 5 is the shared line.', 'Qd5 with check. Same weapon, second rep.'),
        drill('Discovered check', '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', ['Nd6+'], 'Open the e-file with a bang', 'The knight leaves, the rook fires.', 'Nd6 plus double check. Unstoppable by definition.'),
        drill('Zwischenzug', 'r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4', ['Qg5'], 'Do not recapture. Do something stronger.', 'Two targets, one diagonal.', 'Qg5. The trap that eats greedy knights.'),
        drill('Clearance', '4r1k1/5p2/5p2/4P3/8/8/8/4R1K1 w - - 0 1', ['exf6', 'Rd8'], 'Open the line with tempo', 'Capture, clear, threaten.', 'exf6. Rook road opened, g7 harassed.'),
        playout(
          'Weapons test',
          'Full position, engine opponent. Use everything: forks, discoveries, loose piece hunting.',
          START,
          'w',
          'Win at least 3 points of material within 20 moves',
          3,
          'material',
          20,
          'Arsenal proven. Next: king attacks and endgame technique.',
        ),
      ],
    },
    {
      id: 'int-11',
      n: 11,
      title: 'Attacking the castled king',
      subtitle: 'Storm the walls where they are thinnest.',
      minutes: 9,
      steps: [
        text(
          'Storms and breakers',
          [
            'A castled king hides behind three pawns. To reach him, either march pawns at him (a pawn storm, best when kings are castled on opposite sides) or break the wall with piece pressure (best against a slow, undeveloped attacker\u2019s defense).',
            'The g- and h-pawns lead the storm: g4-g5 chases the f6 knight, the last defender of the kingside. Once the defender moves, the wall has a door.',
            'Every attacking piece should arrive with tempo. An attack with two pieces loses to a defense with four.',
          ],
          'Storm with pawns, break with pieces, arrive with tempo.',
        ),
        demo('The storm gathers', ['h4 and h5 march at the king while the pieces stay flexible. Black must react to the pawn wave.'], 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', {
          moves: ['h4', 'h5'],
          caption: 'The pawn wave rolls forward',
        }),
        drill('Roll the wave', 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', ['h4'], 'Start the kingside storm', 'The h-pawn leads the assault.', 'h4. Every storm starts with a single pawn step. h5 comes next, then the pieces.'),
        quiz('Storm timing', 'A pawn storm works best when...', [
          right('The kings are castled on opposite wings', 'Then your pawn storm races the opponent\u2019s, and whoever opens the wall first usually wins the race.'),
          wrong('Both kings castled on the same side', 'Same-side storms strengthen the enemy wall in front of your own king too. Slow builds are better there.'),
          wrong('You are behind in development', 'Pawns cannot attack alone. Pieces follow the storm.'),
        ]),
      ],
    },
    {
      id: 'int-12',
      n: 12,
      title: 'Defense technique',
      subtitle: 'Trade the attacker, hold the line, hit back.',
      minutes: 9,
      steps: [
        text(
          'Three tools of the defender',
          [
            'Tool one: TRADE the attacker. An attack with one piece is a nuisance; with none, it is nothing. Offer trades whenever the enemy attack has few pieces.',
            'Tool two: CONSOLIDATE. Bring your last piece back to defend, make luft, guard the weak square. Boring moves save games.',
            'Tool three: COUNTERATTACK. If their attack ignores your threats, hit somewhere else. Defense does not mean waiting; it means spending tempo where it counts.',
          ],
          'Trade, consolidate, counter. In that order of desperation.',
        ),
        drill('Trade the attacker', '4k3/8/8/8/8/2r5/8/2R1K3 w - - 0 1', ['Rxc3'], 'The black rook is the attacker. Remove it.', 'Two rooks, one file. Take.', 'Rxc3. The attack is gone. Defense by simplification.'),
        drill('Counterattack', '4k3/8/8/8/R2q4/8/8/4K3 w - - 0 1', ['Rxd4'], 'Your rook on a4 is attacked by the queen. Answer with force.', 'The queen is on the same rank, undefended by anything but her pride.', 'Rxd4. The best defense here is a capture. Nine points of attacker, gone.'),
        quiz('Defensive trade', 'You are under attack by a queen and a knight. What is the best defensive move usually?', [
          right('Offer a trade of one of the attackers', 'Each trade shrinks the attack until it is harmless.'),
          wrong('Push more pawns', 'Pawns do not defend an attack. They open lines FOR it.'),
          wrong('Ignore it and attack too', 'Sometimes right, but only when your counterattack comes FIRST. Otherwise trade.'),
        ]),
      ],
    },
    {
      id: 'int-13',
      n: 13,
      title: 'Two weaknesses',
      subtitle: 'One defense can hold. Two collapse.',
      minutes: 8,
      steps: [
        text(
          'Stretch the defense',
          [
            'A single weakness is easy to guard: park a piece nearby and it is safe forever. Two weaknesses on opposite wings are deadly, because the defense cannot be in two places.',
            'When your main attack stalls, do not push harder against the same wall. Open a second front: a pawn break on the other side, a knight jumping to a new outpost, a rook invasion on a fresh file.',
          ],
          'One front is a fight. Two fronts are a win.',
        ),
        demo('Two fronts', ['The d5 pawn is a target on one side; the h5 pawn is a second target far away. The black pieces cannot guard both roads.'], '4k3/8/8/2pp4/8/8/8/R3K3 w - - 0 1', {
          marks: [
            { square: 'd5', color: 'red' },
            { square: 'h5', color: 'yellow' },
          ],
          caption: 'Red and yellow: the defense must split',
        }),
        quiz('Creating the second front', 'Your kingside attack has stalled. Where does the second weakness usually come from?', [
          right('A pawn break or invasion on the opposite side of the board', 'Distance is the whole weapon: the defense cannot teleport.'),
          wrong('Doubling pieces behind the same pawn', 'More force against one weakness still loses to one defender.'),
          wrong('Trading queens', 'Fewer pieces means fewer attacking options. Sometimes right in endgames, rarely in an attack.'),
        ]),
        playout(
          'Fight on two fronts',
          'Win material by using more than one threat. When one door closes, knock on another.',
          START,
          'w',
          'Win at least 3 points of material within 20 moves',
          3,
          'material',
          20,
          'Two fronts, one win. That is intermediate chess.',
        ),
      ],
    },
    {
      id: 'int-14',
      n: 14,
      title: 'King activity and opposition',
      subtitle: 'In the endgame, the king is a fighting piece.',
      minutes: 9,
      steps: [
        text(
          'The king walks out',
          [
            'Once the queens are off, the king marches to the center. In endgames, king activity is worth more than a pawn in most positions.',
            'Opposition: when kings face each other with exactly one square between, the side NOT to move controls the squares the other king wants. Taking the opposition is how you push a pawn through or win the key squares.',
          ],
          'Centralize the king, win the opposition, promote the pawn.',
        ),
        demo('Face to face', ['The kings stand in direct opposition on the e-file. Whoever must move steps aside, and the pawn escorts his king through.'], '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1', {
          marks: [
            { square: 'e5', color: 'red' },
            { square: 'e3', color: 'green' },
          ],
          caption: 'Direct opposition: one square between',
        }),
        drill('Take the opposition', '8/8/8/3k4/8/8/3K4/8 w - - 0 1', ['Kd3'], 'Face the black king with one square between', 'The d-file connects the kings. Step to the square that opposes him.', 'Kd3. Direct opposition. If Black steps aside, your king eats the key squares.'),
        quiz('Opposition rule', 'Kings face each other with one square between. Who is in control?', [
          right('The side NOT to move', 'The side to move must give way. The other side owns the opposition.'),
          wrong('The side to move', 'Moving is exactly the problem: you must step aside first.'),
          wrong('Nobody, kings are equal', 'The turn decides everything in king duels.'),
        ]),
      ],
    },
    {
      id: 'int-15',
      n: 15,
      title: 'Pawn endings',
      subtitle: 'The square rule and the pawn race.',
      minutes: 9,
      steps: [
        text(
          'Geometry of the runner',
          [
            'The square rule: a pawn that starts running can be caught only if the defending king can step into its square, the box from the pawn to its promotion square. Inside the square: catch it. Outside: it queens.',
            'In pawn races, count tempi before anything else. One tempo decides whether the race is won, lost, or drawn by the first player promoting and then stopping the other pawn.',
          ],
          'Draw the square in your head before every king move.',
        ),
        demo('The square', ['The black pawn on d5 runs to d1. The gold square is its escape box. A king outside cannot catch it; a king inside always can.'], '8/8/8/3p4/8/8/6K1/7k w - - 0 1', {
          marks: [
            { square: 'd1', color: 'gold' },
            { square: 'd2', color: 'gold' },
            { square: 'd3', color: 'gold' },
            { square: 'd4', color: 'gold' },
          ],
          caption: 'The square of the pawn',
        }),
        drill('Catch the runner', '8/8/8/3p4/8/8/6K1/7k w - - 0 1', ['Kf3'], 'Step into the square and stop the pawn', 'The king on g2 is outside the box. One step toward the center enters it.', 'Kf3. Inside the square now. The pawn cannot run away from you anymore.'),
        quiz('Square rule', 'A black pawn on a5 runs to a1. The white king stands on e4. Can he catch it?', [
          right('Yes, e4 is inside the square of the a5 pawn', 'The square reaches from a5 down to a1 and across to e4. The king is inside, so he catches the pawn.'),
          wrong('No, the pawn is too fast', 'Distance from e4 to a1 is 3 moves; the pawn needs 4. The king wins the race.'),
          wrong('Only with the white king on e3', 'e4 already works. The square rule is generous to the side with the better king position.'),
        ]),
      ],
    },
    {
      id: 'int-16',
      n: 16,
      title: 'Rook endings basics',
      subtitle: 'Cut the king off, keep the rook active.',
      minutes: 9,
      steps: [
        text(
          'The active rook wins',
          [
            'In rook endgames the attacking rook belongs BEHIND a passed pawn (yours or theirs). Behind your own pawn it pushes it; behind theirs it farms it from the side.',
            'Cutting off: park the rook on a rank or file in front of the enemy king and he is locked out of the game. A cut-off king cannot defend pawns or fight for promotion squares.',
          ],
          'Rook behind the pawn, king out of the game.',
        ),
        demo('The wall goes up', ['Ra5 draws a line across the 5th rank. The black king on h8 can never cross it while the rook patrols.'], '7k/8/8/8/8/8/8/R3K3 w - - 0 1', {
          moves: ['Ra5'],
          caption: 'The king is cut off from the lower ranks',
        }),
        drill('Build the wall', '7k/8/8/8/8/8/8/R3K3 w - - 0 1', ['Ra5'], 'Cut the black king off with the rook', 'The 5th rank is the fence.', 'Ra5. The king is a spectator now. Your own king walks in freely and takes over.'),
        quiz('Rook placement', 'Where does the attacking rook belong relative to a passed pawn?', [
          right('Behind it, whoever the pawn belongs to', 'Behind your pawn it escorts. Behind theirs it herds.'),
          wrong('In front of it, blocking', 'A rook in front of its OWN pawn blocks it. In front of theirs, it gets attacked by the king.'),
          wrong('On the first rank, defending', 'Passive rooks lose rook endgames. Activity is the whole story.'),
        ]),
      ],
    },
    {
      id: 'int-17',
      n: 17,
      title: 'Converting an advantage',
      subtitle: 'Winning won positions is its own skill.',
      minutes: 9,
      steps: [
        text(
          'Trade pieces, keep tension',
          [
            'When you are up material, trade PIECES, not pawns. Fewer enemy pieces means less counterplay; keeping pawns means more winning chances later.',
            'Kill counterplay first. Ask every move: what does my opponent want? Deny it, then improve your worst piece. Technique is patience with a plan.',
            'The king joins the attack in the endgame. Centralize him, escort the passed pawn, and the point takes care of itself.',
          ],
          'Simplify pieces, multiply pawns, deactivate their plans.',
        ),
        demo('Rook and king finish it', ['Up a rook, the win is technique: rook cuts the king, your king approaches, mate follows.'], '7k/8/8/8/8/8/8/R3K3 w - - 0 1', {
          marks: [{ square: 'a5', color: 'green' }],
          caption: 'Ra5 first, then the king walks up',
        }),
        quiz('Conversion rule', 'You are up a whole rook in a middlegame. What do you trade?', [
          right('Pieces, not pawns', 'Fewer enemy pieces means less counterplay. Pawns are your winning margin.'),
          wrong('Pawns, not pieces', 'Trading pawns opens lines for the enemy pieces to swarm you.'),
          wrong('Nothing, sit on the material', 'Passive defense invites attacks. Simplify and activate.'),
        ]),
        playout(
          'Technique test',
          'Rook against a lone king: the classic conversion. Box the king with the rook, bring your king, mate.',
          '7k/8/8/8/8/8/8/R3K3 w - - 0 1',
          'w',
          'Checkmate the black king',
          1,
          'checkmate',
          25,
          'Converted. Rook mate is the first technique every tournament player owns.',
          'Reset and try the ladder: rook cuts a rank, your king approaches, repeat. Never let the king touch your rook.',
        ),
      ],
    },
    {
      id: 'int-18',
      n: 18,
      title: 'Practice arena: endgames',
      subtitle: 'Kings, pawns and rooks under pressure.',
      minutes: 10,
      steps: [
        text(
          'Endgame reps',
          [
            'Four drills from the endgame levels, then a playable pawn ending.',
            'In every drill, ask about the kings first. Endgames are king duels with pawns as the stakes.',
          ],
        ),
        drill('Opposition rep', '8/8/8/3k4/8/8/3K4/8 w - - 0 1', ['Kd3'], 'Take the direct opposition', 'One square between the kings.', 'Kd3. The opposition is yours.'),
        drill('Square rule rep', '8/8/8/3p4/8/8/6K1/7k w - - 0 1', ['Kf3'], 'Catch the running pawn', 'Enter the square.', 'Kf3. Caught. Geometry beats hope.'),
        drill('Cut off rep', '7k/8/8/8/8/8/8/R3K3 w - - 0 1', ['Ra5'], 'Fence the king out', 'One rank, one wall.', 'Ra5. The wall holds.'),
        playout(
          'Pawn ending duel',
          'King and pawn against king and king. Push the pawn with the king in front. Win material or promote.',
          '8/8/8/3k4/8/3K4/4P3/8 w - - 0 1',
          'w',
          'Win the pawn race or promote within 15 moves',
          2,
          'material',
          15,
          'King activity, opposition, promotion: the full pawn-ending toolkit in one game.',
        ),
      ],
    },
    {
      id: 'int-19',
      n: 19,
      title: 'Practice arena: mixed',
      subtitle: 'Tactics and technique, shuffled.',
      minutes: 10,
      steps: [
        text(
          'Interleaving test',
          [
            'Mixed reps: you will not be told which skill each drill needs. Recognizing WHICH tool applies is the actual skill.',
            'Scan order: checks first, then captures, then threats.',
          ],
        ),
        drill('Unknown 1', '6k1/8/8/r5b1/8/8/8/3QK3 w - - 0 1', ['Qd5+'], 'White to move: find the strong move', 'Two black pieces share a rank.', 'Qd5 with check. Double attack.'),
        drill('Unknown 2', '4k3/8/8/8/R2q4/8/8/4K3 w - - 0 1', ['Rxd4'], 'White to move: deal with the queen', 'The rook is attacked. So is she.', 'Rxd4. Counterattack by capture.'),
        drill('Unknown 3', 'r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4', ['Qg5'], 'Black to move: the knight on e5 looks tasty to capture', 'Is there something better than recapturing?', 'Qg5. The zwischenzug strikes again.'),
        playout(
          'Final mixed game',
          'Everything you have learned in one game.',
          START,
          'w',
          'Win at least 3 points of material within 20 moves',
          4,
          'material',
          20,
          'Intermediate tier nearly done. One level left.',
        ),
      ],
    },
    {
      id: 'int-20',
      n: 20,
      title: 'Intermediate graduation',
      subtitle: 'One exam, one game, one tier down.',
      minutes: 15,
      steps: [
        text(
          'The exam',
          [
            'Three questions and a full game against a stronger engine.',
            'Passing means the tactics are automatic and the endgame toolkit is loaded. The Advanced tier will raise the ceiling: calculation discipline and positional depth.',
          ],
          'Pass the quiz, win the game.',
        ),
        quiz('Tool selection', 'Your opponent recaptured a piece and left his queen hanging to a knight fork. You were thinking about your own recapture. What saved you?', [
          right('Running the scan: checks, captures, threats, every move', 'The scan finds forks before they cost material.'),
          wrong('Luck', 'Not a strategy.'),
          wrong('Deep opening preparation', 'The fork happens on move 30, not move 10.'),
        ]),
        quiz('Endgame priority', 'Kings and pawns only. Your first priority every move is...', [
          right('King position: activity and opposition', 'The king is the strongest piece in pawn endings.'),
          wrong('Pawn storms at the enemy king', 'There is no attack without pieces. The king walks, not storms.'),
          wrong('Rook activity', 'No rooks on the board in a pawn ending.'),
        ]),
        playout(
          'Graduation game',
          'Beat the level 4 engine on material within 20 moves.',
          START,
          'w',
          'Win 3 or more points of material within 20 moves',
          4,
          'material',
          20,
          'Intermediate tier cleared. Advanced tier awaits.',
        ),
      ],
    },
  ],
}
