// Tier 1: Newbie. First contact with the game: the board, the pieces, the
// rules, and the very first ways to win material and mate.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const newbie: Tier = {
  id: 'newbie',
  n: 1,
  title: 'Newbie',
  tagline: 'The board, the pieces, and the moves that end games.',
  color: '#8fbf5a',
  levels: [
    {
      id: 'nb-01',
      n: 1,
      title: 'The board',
      subtitle: '64 squares, a naming system, and the two center squares everyone fights for.',
      minutes: 6,
      steps: [
        text(
          'A map of the battlefield',
          [
            'The board is 8 columns (files a to h) by 8 rows (ranks 1 to 8). Every square has a name: the file letter first, then the rank number, like e4 or a1.',
            'White starts on ranks 1 and 2. Black starts on ranks 7 and 8. The bottom-right square from your own side is always light colored. If it is not, the board is turned around.',
            'Once you can name squares, you can read chess books, follow streamers, and understand every exercise in this course.',
          ],
          'Square name = file letter + rank number. e4 is file e, rank 4.',
        ),
        demo(
          'Key squares to know',
          [
            'e4 and d4 are the center squares White fights for first. e5 and d5 are their black twins.',
            'f7 and f2 are the weak spots in front of each king. Remember them. They decide a lot of beginner games.',
          ],
          START,
          {
            marks: [
              { square: 'e4', color: 'green' },
              { square: 'd4', color: 'green' },
              { square: 'e5', color: 'red' },
              { square: 'd5', color: 'red' },
              { square: 'f7', color: 'yellow' },
              { square: 'f2', color: 'yellow' },
            ],
            caption: 'The starting position',
          },
        ),
        quiz('Name that square', 'Which square is directly in front of the white king at the start of the game?', [
          right('e2', 'The king starts on e1, so the square in front of him is e2.'),
          wrong('d2', 'd2 is in front of the queen. The king sits on e1.'),
          wrong('e1', 'e1 is where the king stands, not the square in front of him.'),
        ]),
        drill(
          'Your very first move',
          START,
          ['e4'],
          'Push the king pawn two squares',
          'Find the pawn on e2. Click it, then click e4, two squares straight ahead.',
          'That is the most popular first move in chess history. The pawn grabs center space and frees the bishop and queen.',
        ),
      ],
    },
    {
      id: 'nb-02',
      n: 2,
      title: 'The pawn',
      subtitle: 'Forward only, captures sideways, and never back.',
      minutes: 7,
      steps: [
        text(
          'The smallest piece, the biggest personality',
          [
            'Pawns move one square straight ahead. From their starting square they may move two. They capture one square diagonally forward.',
            'They can never move backward. Every pawn move changes the position forever, so push with care.',
            'Pawns are worth about 1 point each. Alone they look harmless, but pawn chains decide where the rest of the army is allowed to go.',
          ],
          'Pawns move straight and capture diagonally. Never backward.',
        ),
        demo(
          'The two-square push',
          ['On its first move a pawn may jump two squares. This pawn on e2 is heading for the center.'],
          '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
          { moves: ['e4'], caption: 'The e-pawn uses its two-square option' },
        ),
        demo(
          'The diagonal capture',
          [
            'Same pawn, now on e4. The black pawn on d5 stands one square diagonally ahead. That means it can be taken.',
            'Pawns are the only pieces that move one way and capture another.',
          ],
          '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
          { moves: ['exd5'], caption: 'exd5: the pawn takes diagonally' },
        ),
        drill('Take the pawn', '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', ['exd5'], 'Capture the pawn on d5', 'Pawns capture one square diagonally forward. Your pawn is on e4.', 'Exactly. You just won a pawn.'),
        quiz('Pawn captures', 'A white pawn sits on e4. Which squares can it capture on?', [
          right('d5 and f5', 'One square diagonally forward is the only way pawns capture.'),
          wrong('d4 and f4', 'Those are sideways. Pawns never capture sideways.'),
          wrong('e5 only', 'e5 is where it moves. Captures are diagonal.'),
        ]),
      ],
    },
    {
      id: 'nb-03',
      n: 3,
      title: 'The knight',
      subtitle: 'The only piece that jumps.',
      minutes: 7,
      steps: [
        text(
          'Two up, one across',
          [
            'The knight moves in an L shape: two squares in one direction, then one square sideways. It is the only piece that can jump over anything in its path.',
            'From the center a knight attacks up to 8 squares. On the edge it attacks 4 or fewer. The saying goes: a knight on the rim is dim.',
          ],
          'The knight jumps. No other piece can.',
        ),
        demo(
          'The L-shaped hop',
          ['Watch the knight on d4 leap to c6. Nothing standing in its path can stop it.'],
          '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1',
          { moves: ['Nc6'], caption: 'Straight over the wall' },
        ),
        drill(
          'Jump the wall',
          '4k3/8/8/5p2/3N4/4p1p1/8/4K3 w - - 0 1',
          ['Nxf5'],
          'Capture the pawn on f5',
          'From d4, think of the L shape: two squares toward the f-file, then one across.',
          'Over the wall. That is exactly why knights are so hard to trap.',
        ),
        quiz('Which piece jumps?', 'Which is the only piece that can jump over other pieces?', [
          right('The knight', 'Only the knight ignores blockers on its way to its destination.'),
          wrong('The bishop', 'Bishops slide along clear diagonals. Blockers stop them.'),
          wrong('The queen', 'The queen slides too. Blockers stop her.'),
        ]),
      ],
    },
    {
      id: 'nb-04',
      n: 4,
      title: 'The bishop',
      subtitle: 'One color of squares for its whole life.',
      minutes: 6,
      steps: [
        text(
          'Diagonals forever',
          [
            'Bishops slide any distance along diagonals. Each bishop stays on one square color its entire life.',
            'A bishop on a blocked diagonal is like a tall pawn. Open diagonals are what make bishops strong.',
          ],
          'Bishops live on one color forever.',
        ),
        demo(
          'The long diagonal',
          ['The bishop on c1 sweeps to h6 in one move, capturing the pawn on the way.'],
          '4k3/8/7p/8/8/8/8/2B1K3 w - - 0 1',
          { moves: ['Bxh6'], caption: 'c1 to h6, one clean diagonal' },
        ),
        drill('Diagonal strike', '4k3/8/8/3n4/2B5/8/8/4K3 w - - 0 1', ['Bxd5'], 'Capture the knight on d5', 'The bishop on c4 looks along the c4-d5-e6 diagonal.', 'Clean capture. The bishop never left its color.'),
        quiz('Same color forever', 'A bishop starts on f1. Which square can it NEVER reach?', [
          right('e5', 'e5 is a dark square. A bishop that starts on light squares stays on them forever.'),
          wrong('d3', 'd3 is light, same color as f1. Reachable.'),
          wrong('g2', 'g2 is light too. It can get there.'),
        ]),
      ],
    },
    {
      id: 'nb-05',
      n: 5,
      title: 'The rook',
      subtitle: 'Straight lines, open files, and the last rank.',
      minutes: 6,
      steps: [
        text(
          'Ranks and files',
          [
            'Rooks slide along ranks and files, straight lines only. They love open files and the 7th rank.',
            'In the starting position the rooks are the hardest pieces to activate. That is one big reason castling matters: it connects them.',
          ],
          'Rooks need open lines. Give them files with no pawns.',
        ),
        demo('Sweep the file', ['The rook on a1 owns the whole a-file. One move takes it deep into enemy territory.'], '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', { moves: ['Ra7'], caption: 'One move, almost the whole file' }),
        drill('Grab and check', 'n3k3/8/8/8/8/8/8/R3K3 w - - 0 1', ['Rxa8+'], 'Capture the knight on a8 with check', 'The rook on a1 drives straight up the a-file.', 'Rxa8 plus check down the 8th rank. Rooks on open files do exactly this.'),
        quiz('Rook vision', 'A rook stands on d1 with nothing between it and d8. What does it attack?', [
          right('The whole d-file', 'Rooks see along entire open files and ranks.'),
          wrong('Only d4 and d5', 'Rooks are not short range. They slide any distance.'),
          wrong('The diagonals d2 and e2', 'Rooks never move diagonally. That is bishop and queen territory.'),
        ]),
      ],
    },
    {
      id: 'nb-06',
      n: 6,
      title: 'The queen',
      subtitle: 'Rook and bishop in one very strong piece.',
      minutes: 6,
      steps: [
        text(
          'The strongest piece',
          [
            'The queen moves like a rook and a bishop combined: any number of squares in any straight direction. She is worth about 9 pawns.',
            'Bring her out too early, though, and she gets chased around while your opponent develops pieces for free. In the opening, the queen comes out after the minor pieces.',
          ],
          'Queen = rook + bishop. Worth about 9 pawns.',
        ),
        demo('Rank and file', ['From a1 the queen slides up the file, across the rank, and along diagonals. Here she goes to a8 with check.'], '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', { moves: ['Qa8+'], caption: 'The queen does both jobs' }),
        drill('Win the bishop', '4k3/8/8/7b/8/8/8/3QK3 w - - 0 1', ['Qxh5+'], 'Capture the bishop on h5, with check', 'The d1 to h5 diagonal is wide open: e2, f3, g4, then the bishop.', 'Qxh5 plus check. The queen hit two targets with one move.'),
        quiz('Piece values', 'Roughly how many pawns is a knight or bishop worth?', [
          right('About 3', 'Minor pieces are worth about 3 pawns, rooks about 5, the queen about 9.'),
          wrong('About 5', '5 is a rook. Knights and bishops are a step below.'),
          wrong('About 1', 'That is a pawn. Minor pieces are far stronger.'),
        ]),
      ],
    },
    {
      id: 'nb-07',
      n: 7,
      title: 'The king',
      subtitle: 'Slow in the opening, decisive at the end.',
      minutes: 5,
      steps: [
        text(
          'One careful step at a time',
          [
            'The king moves one square in any direction, but never onto a square attacked by the enemy.',
            'He is slow in the opening and decisive in the endgame. Once the queens are off the board, an active king wins games. Keep him safe first, use him later.',
          ],
          'The king never steps into danger. Protect him.',
        ),
        demo('One step', ['The king on e1 steps toward the center. In endgames, kings walk out and fight.'], '4k3/8/8/8/8/8/8/4K3 w - - 0 1', { moves: ['Kd2'], caption: 'A careful step' }),
        drill('King steps out', '7k/8/8/8/8/8/8/6K1 w - - 0 1', ['Kf2'], 'Move the king toward the center', 'The king on g1 has three safe squares. Take the one that heads toward the middle.', 'Every endgame starts with exactly this kind of walk.'),
        quiz('The priceless piece', 'Which piece never gets captured because the game ends before it could be?', [
          right('The king', 'The king is never captured. Checkmate ends the game first.'),
          wrong('The queen', 'Queens get captured all the time. The game keeps going.'),
          wrong('The rook', 'Rooks fall too. Only the king is special.'),
        ]),
      ],
    },
    {
      id: 'nb-08',
      n: 8,
      title: 'Check',
      subtitle: 'The king is attacked. Three ways out.',
      minutes: 7,
      steps: [
        text(
          'What check means',
          [
            'Check means the king is attacked. You must answer it this very move, in exactly one of three ways.',
            'Move the king to a safe square. Block the attack with another piece. Capture the attacker.',
            'If none of the three exists, it is checkmate and the game is over.',
          ],
          'Three answers to check: move, block, capture. Nothing else.',
        ),
        quiz('Answering check', 'Your king is in check. Which of these is NOT a legal response?', [
          right('Castling', 'You may never castle while in check, through it, or into it.'),
          wrong('Blocking with a piece', 'Blocking works against checks from sliding pieces along a line.'),
          wrong('Capturing the attacker', 'Removing the attacker always ends the check.'),
        ]),
        drill('Capture the attacker', 'k7/8/8/8/8/8/5PPP/3Rr1K1 w - - 0 1', ['Rxe1'], 'Black checked you with the rook. Remove it.', 'The king cannot run: every square is covered. Can one of your pieces reach the attacker?', 'Rxe1. Your rook removed the attacker, the simplest and best answer to check.'),
        demo('Block the line', ['The rook on e8 checks the king on e1. The bishop slides to e2 and shuts the door.'], '4r2k/8/8/8/8/8/8/4KB2 w - - 0 1', { moves: ['Be2'], caption: 'Blocking the check' }),
        drill('Block the check', '4r2k/8/8/8/8/8/8/4KB2 w - - 0 1', ['Be2'], 'Stop the check by blocking', 'A sliding check can be blocked by any piece that reaches the line between attacker and king.', 'Be2. The bishop parks on the e-file and the check is gone.'),
      ],
    },
    {
      id: 'nb-09',
      n: 9,
      title: 'Checkmate: the back rank',
      subtitle: 'The most common mate in beginner chess.',
      minutes: 7,
      steps: [
        text(
          'Trapped behind his own pawns',
          [
            'A king boxed in by his own pawns on the last rank can be mated by a single rook or queen sliding to that rank.',
            'The cure, played before it happens: make a little escape hatch with a pawn move like h3 or g3. Players call it making luft.',
          ],
          'Back rank mate: one rook, one rank, no escape squares.',
        ),
        demo('The back rank mate', ['The black king is sealed behind f7, g7 and h7. One rook lift to e8 ends everything.'], '6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1', { moves: ['Re8#'], caption: 'Re8, mate on the back rank' }),
        drill('Break through', '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['Rxd8#'], 'Mate in one', 'Black has one defender on the back rank. Remove it, with tempo.', 'You captured the defender and mated on the same move. This combination wins countless beginner games.'),
        quiz('The escape hatch', 'Your king is stuck behind f2, g2, h2 with no moves on the last rank. What prevents back rank mates?', [
          right('Playing h3 or g3 once, to make an escape square', 'One little pawn move creates luft, an exit for the king.'),
          wrong('Never castling', 'Castling lands the king exactly there. The hatch is the cure, not avoiding castling.'),
          wrong('Keeping all pawns home', 'Pawns on f2, g2, h2 are exactly what seals the king in.'),
        ]),
      ],
    },
    {
      id: 'nb-10',
      n: 10,
      title: 'Castling',
      subtitle: 'King and rook move together, once per game.',
      minutes: 7,
      steps: [
        text(
          'The two-piece move',
          [
            'Once per game, king and rook can move together. The king slides two squares toward the rook and the rook hops over: that is castling.',
            'Four conditions must ALL hold: neither king nor rook has moved; no pieces stand between them; the king is not in check; and the king does not pass through or land on an attacked square.',
            'Castling does two jobs at once: it hides the king behind a pawn wall and brings a rook toward the center.',
          ],
          'Castle early. A king stuck in the center loses games.',
        ),
        demo('Short castle', ['Both sides kept the squares between king and rook clear. White plays 0-0: king e1 to g1, rook h1 to f1.'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { moves: ['O-O'], caption: 'Short castling' }),
        demo('Long castle', ['The long way: 0-0-0 sends the king from e1 to c1, and the a1 rook lands on d1.'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { moves: ['O-O-O'], caption: 'Long castling' }),
        drill('Castle now', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', ['O-O'], 'Get the king to safety', 'f1 and g1 are empty and nothing attacks them. Make the two-piece move.', 'King safe, rook active. This is what a good opening move looks like.'),
        quiz('Illegal castling', 'In which case is castling NOT allowed?', [
          right('The king is in check', 'You cannot castle out of check. Deal with the check first.'),
          wrong('A rook stands on an open file', 'Open files do not matter. Only movement, blockers, and attacked squares do.'),
          wrong('A pawn has just been captured', 'Captures elsewhere are irrelevant. Castling only cares about king and rook.'),
        ]),
      ],
    },
    {
      id: 'nb-11',
      n: 11,
      title: 'En passant',
      subtitle: 'The strange pawn capture everyone discovers late.',
      minutes: 5,
      steps: [
        text(
          'The capture that looks illegal',
          [
            'When an enemy pawn makes its two-square jump and lands right beside your pawn, you may capture it as if it had moved only one square.',
            'The catch: only immediately, on your very next move. Wait one move and the chance is gone forever.',
          ],
          'En passant: capture the jumper now, or never.',
        ),
        demo('En passant in action', ['The black pawn just jumped d7 to d5, landing beside your pawn on e5. You take as if it had stopped on d6.'], '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', { moves: ['exd6'], caption: 'exd6 en passant: the black pawn disappears' }),
        drill('Catch it in time', '4k3/8/8/1pP5/8/8/8/4K3 w - b6 0 2', ['cxb6'], 'Black just played b7 to b5. Punish it now.', 'Take as if the b-pawn had only moved one square.', 'The only chance you will ever get, and you took it.'),
        quiz('En passant window', 'Your opponent plays g7 to g5 beside your pawn on f5. When can you capture en passant?', [
          right('Only on your very next move', 'The en passant right expires immediately after the jump.'),
          wrong('For the rest of the game', 'No. One move. Then the chance is gone.'),
          wrong('Only if you are winning', 'Material has nothing to do with it. Timing is everything.'),
        ]),
      ],
    },
    {
      id: 'nb-12',
      n: 12,
      title: 'Promotion',
      subtitle: 'A pawn reaches the last rank and becomes something huge.',
      minutes: 6,
      steps: [
        text(
          'The pawn grows up',
          [
            'A pawn that reaches the last rank stops being a pawn: it becomes a queen, rook, bishop, or knight, your choice.',
            'Almost always take the queen. Promotions decide more endgames than any other factor.',
          ],
          'Pawn to the last rank = a new queen, almost always.',
        ),
        demo('A new queen', ['The b-pawn has one square to go. It lands on b8 and reappears as a queen.'], '8/1P6/8/8/4k3/8/8/4K3 w - - 0 1', { moves: ['b8=Q'], caption: 'A new queen enters the board' }),
        drill('Promote with mate', 'k7/2P5/1K6/8/8/8/8/8 w - - 0 1', ['c8=Q#'], 'Mate in one by promoting', 'Promote on c8. The black king on a8 will have nowhere to run.', 'c8=Q. Promotion and checkmate in a single move, the dream endgame finish.'),
        quiz('Underpromotion', 'When might you promote to something other than a queen?', [
          right('When a knight would fork or mate where a queen would not', 'Knight promotions create mate patterns or forks a queen cannot copy. Rare but real.'),
          wrong('To avoid a threefold repetition', 'Promotion choice has nothing to do with repetition.'),
          wrong('Never, always take the queen', 'Not quite. Famous positions exist where a knight promotion is the only win or mate.'),
        ]),
      ],
    },
    {
      id: 'nb-13',
      n: 13,
      title: 'Stalemate and draws',
      subtitle: 'Games do not always end in a mate.',
      minutes: 7,
      steps: [
        text(
          'Five ways to draw',
          [
            'Stalemate: the side to move is not in check but has no legal move. The game is a draw, no matter how much material the other side has.',
            'Threefold repetition: the same position occurs three times. The fifty-move rule: fifty moves each with no capture and no pawn move. Insufficient material: king versus king cannot be won. Agreement: both players call it a draw.',
            'Winning by stalemate is impossible. Watch for it whenever you are far ahead.',
          ],
          'Stalemate is a draw. Ahead by a mile? Check that the enemy king still has a move.',
        ),
        demo('The trap to avoid', ['Qd5 would be stalemate: the king is not in check but has no moves. Qa8 keeps the check on and takes every escape square.'], '7k/8/6K1/Q7/8/8/8/8 w - - 0 1', { marks: [{ square: 'd5', color: 'red' }, { square: 'a8', color: 'green' }], caption: 'Red: stalemate. Green: mate.' }),
        drill('Do not throw away the win', '7k/8/6K1/Q7/8/8/8/8 w - - 0 1', ['Qa8#'], 'Mate in one, and avoid the stalemate trap', 'Pin the king to the last rank with a check along the 8th.', 'Mate. Qd5 instead would have been stalemate, the classic way to throw away a completely won game.'),
        quiz('Stalemate or mate?', 'Black to move: king on h8, White has king g6 and queen f7. What is the result?', [
          right('Stalemate, the game is drawn', 'Black is not in check but has no legal move. A draw, even though White is up a queen.'),
          wrong('Checkmate for White', 'The king is not attacked. Without check there is no mate.'),
          wrong('Black must play Kg8', 'g8 is covered by the queen on f7. Black has no moves at all.'),
        ]),
      ],
    },
    {
      id: 'nb-14',
      n: 14,
      title: 'Values and trades',
      subtitle: 'Know what your pieces are worth before you swap.',
      minutes: 6,
      steps: [
        text(
          'The scoreboard of material',
          [
            'Pawn 1, knight 3, bishop 3, rook 5, queen 9. The king has no price: he is never traded.',
            'Trades are the arithmetic of chess. If you swap your bishop (3) for a rook (5), you just won 2 points of material. Losing your queen for a knight is usually fatal.',
            'Values are a guide, not a law. In specific positions a well-placed knight can beat a distant rook. Learn the numbers first, learn the exceptions later.',
          ],
          '1, 3, 3, 5, 9. Count before you capture.',
        ),
        quiz('Trade decision', 'You can capture a knight with your bishop, and the knight is defended by a rook. Your bishop will be recaptured. Net result?', [
          right('An even trade, 3 for 3', 'Bishop for knight is an equal swap. Fine when you want trades, bad when you are behind.'),
          wrong('You win material', 'Equal for equal changes nothing on the scoreboard.'),
          wrong('You lose material', 'Nothing is lost. The rook recaptures bishop for knight, an even deal.'),
        ]),
        drill('Free rook', '4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1', ['Qxd5'], 'The black rook is undefended. Take it.', 'The queen on d1 looks straight down the d-file.', 'Qxd5. Five free points. Always ask: is the piece I want to capture defended?'),
        quiz('Count defenders', 'Before capturing a defended piece, what must you compare?', [
          right('The total value of attackers against defenders', 'A capture is good when what you win outweighs what you will lose in return.'),
          wrong('Only the number of attackers', 'Two attackers of pawns can still lose to one defended rook. Values matter.'),
          wrong('Nothing, always capture', 'Capturing without counting is how games are thrown away.'),
        ]),
      ],
    },
    {
      id: 'nb-15',
      n: 15,
      title: 'Attacked or defended?',
      subtitle: 'The one question that prevents most beginner blunders.',
      minutes: 7,
      steps: [
        text(
          'Look before you leap',
          [
            'Before every single move, ask two things: what does my opponent threaten, and is the piece I am about to move or capture safe?',
            'A piece is loose when nothing defends it. Loose pieces are free food. Most beginner games are decided by whoever notices loose pieces first.',
            'Habits beat talent here. Strong players scan for checks, captures and threats on every move. Start building that scan now.',
          ],
          'Every move: what is attacked, what is defended?',
        ),
        drill('The loose knight', '4k3/8/8/3n4/2B5/8/8/4K3 w - - 0 1', ['Bxd5'], 'The knight on d5 has no bodyguard. Collect it.', 'The bishop on c4 looks along the c4-d5-e6 diagonal.', 'Bxd5. Nothing recaptured, because nothing defended it.'),
        drill('The poisoned pawn', '4k3/p7/4p3/3p4/8/8/8/R3K3 w - - 0 1', ['Rxa7'], 'Two black pawns are reachable. Take the good one, skip the poisoned one.', 'The d5 pawn is guarded by its neighbor on e6. The a7 pawn is on its own.', 'Rxa7. One pawn was free; the other would have cost a rook for a pawn.'),
        quiz('Is it safe?', 'Your queen can capture a pawn, but that pawn is defended by a rook and your queen would be recaptured. What happened?', [
          right('You would lose the queen (9) for a pawn (1)', 'Nine for one is a disaster, no matter how tasty the pawn looked.'),
          wrong('An even trade', 'A queen is not a pawn. Count the values before capturing.'),
          wrong('You win material', 'Winning material means giving up less than you take. Here you give far more.'),
        ]),
      ],
    },
    {
      id: 'nb-16',
      n: 16,
      title: 'Practice arena I',
      subtitle: 'Capture drills: spot the free pieces.',
      minutes: 8,
      steps: [
        text(
          'Training, not testing',
          [
            'Three quick drills, no new theory. For each one, find the best capture.',
            'Say the attacker and defender count out loud before you move. Building that habit now is worth more than any opening you will ever learn.',
          ],
        ),
        drill('Knight grabs', '4k3/8/8/8/3p4/5N2/8/4K3 w - - 0 1', ['Nxd4'], 'Take the pawn with the knight', 'From f3 the knight attacks d4 with its L shape.', 'Nxd4. The pawn was undefended.'),
        drill('Rook grabs', '4k3/p7/8/8/8/8/8/R3K3 w - - 0 1', ['Rxa7'], 'Win the pawn on a7', 'The a-file is open all the way to a7, and nothing defends the pawn.', 'Rxa7. Rooks feast on open files.'),
        drill('Queen grabs', '4k3/8/8/8/8/5b2/8/3QK3 w - - 0 1', ['Qxf3'], 'Capture the bishop on f3', 'The queen moves like a rook and bishop combined. The d1 to f3 diagonal is clear.', 'Qxf3, three free points.'),
        quiz('Best capture', 'You can capture a knight (3), a rook (5) or a pawn (1) this move. All are undefended. Which do you take?', [
          right('The rook', 'Always take the biggest undefended prize first, unless another capture mates.'),
          wrong('The knight', 'Good piece, but the rook is worth 2 points more.'),
          wrong('The pawn', 'One point is the smallest prize on the board.'),
        ]),
      ],
    },
    {
      id: 'nb-17',
      n: 17,
      title: 'Practice arena II',
      subtitle: 'Give check. Escape check. Stay sharp.',
      minutes: 8,
      steps: [
        text(
          'Checks cut both ways',
          [
            'A check forces your opponent to respond, which makes checks powerful for attack and essential to notice for defense.',
            'First two drills: deliver check. Third drill: get out of check.',
          ],
        ),
        drill('Knight check', '7k/8/8/6N1/8/8/8/4K3 w - - 0 1', ['Nf7+'], 'Check the king on h8', 'The knight on g5 wants to jump to f7, right next to the king.', 'Nf7 plus check. The king must react.'),
        drill('Rook check', '2k5/8/8/8/8/8/8/R3K3 w - - 0 1', ['Ra8+'], 'Check along the 8th rank', 'The a-file is open. Land the rook on a8 and the rank does the rest.', 'Ra8 plus check. The rook sees all of rank 8.'),
        drill('The only escape', '4k3/8/8/8/8/8/4r3/3RK3 w - - 0 1', ['Kf1'], 'Your king is checked by the rook. Exactly one square is safe.', 'd1 is occupied by your own rook and rank 2 is watched. Think f-file.', 'Kf1. Off the e-file, out of danger.'),
      ],
    },
    {
      id: 'nb-18',
      n: 18,
      title: 'Practice arena III',
      subtitle: 'Review: castling, en passant, promotion.',
      minutes: 8,
      steps: [
        text(
          'Mixed review',
          [
            'Spaced repetition is how skills stick. These three drills revisit rules from earlier levels.',
            'If one feels shaky, redo the level it came from. There is no shame in review, only in pretending.',
          ],
        ),
        drill('Castle in a real position', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', ['O-O'], 'Castle kingside', 'Squares f1 and g1 are clear and safe.', 'Castled. King safe, rook connected.'),
        drill('En passant again', '4k3/8/8/1pP5/8/8/8/4K3 w - b6 0 2', ['cxb6'], 'Black just jumped past your pawn. Capture en passant.', 'The right expires after this move.', 'cxb6. Second look, same reward.'),
        drill('Promote and mate', 'k7/2P5/1K6/8/8/8/8/8 w - - 0 1', ['c8=Q#'], 'Promote with mate in one', 'The c-file leads straight to the 8th rank.', 'c8=Q. Third time is a habit.'),
      ],
    },
    {
      id: 'nb-19',
      n: 19,
      title: 'The opening plan',
      subtitle: 'Center, develop, castle. Three jobs, first ten moves.',
      minutes: 7,
      steps: [
        text(
          'What to do at the start',
          [
            'Job one: fight for the center with a pawn, usually e4 or d4.',
            'Job two: develop your knights and bishops toward the center, one piece per move, and avoid moving the same piece twice.',
            'Job three: castle, usually by move 8 to 10. Then connect your rooks. That is a complete opening plan, and it beats most memorized tricks at beginner level.',
          ],
          'Center first, pieces second, king safety third.',
        ),
        demo('A model opening', ['e4 grabs the center, Nf3 and Bc4 develop with tempo. Nothing fancy, everything sound.'], START, {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
          caption: 'The Italian Game, a model beginner opening',
        }),
        quiz('First move', 'Which first move fights for the center most directly?', [
          right('e4 or d4', 'Both open lines for pieces and grab central space immediately.'),
          wrong('h4', 'A flank pawn does nothing for the center and wastes tempo.'),
          wrong('Na3', 'Na3 puts the knight on the rim where it attacks few squares.'),
        ]),
        drill('Open with the best', START, ['e4'], 'Play the strongest standard first move', 'The king pawn, two squares.', 'e4. The classic. From here the plan writes itself: develop and castle.'),
      ],
    },
    {
      id: 'nb-20',
      n: 20,
      title: 'Newbie graduation',
      subtitle: 'Play a real game with your new tools.',
      minutes: 15,
      steps: [
        text(
          'You know every rule now',
          [
            'Board, pieces, check, mate, castling, en passant, promotion, draws, values. That is the complete rulebook of chess.',
            'One last quiz, then your first full game. Go slow, ask what is threatened before every move, and hunt loose pieces.',
          ],
          'You have the rules. The next tier gives you the plans.',
        ),
        quiz('Rule check', 'You pushed a pawn two squares and it landed beside an enemy pawn. What can your opponent do right now?', [
          right('Capture it en passant, this move only', 'The en passant right exists for exactly one move.'),
          wrong('Nothing, the pawn is safe', 'No, the enemy pawn may take it as if it had stopped one square earlier.'),
          wrong('Capture it with any pawn', 'Only the pawn that was beside the landing square, and only immediately.'),
        ]),
        drill('One last back rank', '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re8#'], 'Mate in one to finish the tier', 'The king is sealed behind his three pawns. The rook knows the way.', 'Re8. Tier complete.'),
        playout(
          'Your first full game',
          'Play White against the gentlest bot in the app. Win material or survive 20 moves, either counts.',
          START,
          'w',
          'Win at least 3 points of material, or hold on for 20 moves',
          1,
          'material',
          20,
          'You played a full game with real rules. The Beginner tier will turn this into actual plans.',
        ),
      ],
    },
  ],
}
