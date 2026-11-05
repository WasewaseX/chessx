// Tier 7: How to Win at Chess. The complete method from Levy Rozman's book
// "How to Win at Chess: The Ultimate Guide for Beginners and Beyond",
// rebuilt as playable levels that follow the book's own order: rules,
// notation, how to practice, how games are won, openings (White then Black),
// endgames, tactics, draws, then the intermediate part: openings, gambits,
// endgame technique, and the thinking method that holds it all together.
// Every FEN and line below passes src/content/validate.ts.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, exercise, right, wrong, playout } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const ITALIAN =
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

export const howtowin: Tier = {
  id: 'howtowin',
  n: 7,
  title: 'How to Win at Chess',
  tagline: "Levy Rozman's method from the book, rebuilt as playable levels: rules to rating 1200.",
  color: '#c1502e',
  levels: [
    /* ------------------------------------------------ hw-01: chapters 1-2 */
    {
      id: 'hw-01',
      n: 1,
      title: 'The board, the pieces, the moves',
      subtitle: 'Piece values, the three special moves, and how to read chess notation.',
      minutes: 10,
      concepts: ['center', 'castlingSafety', 'promotion'],
      steps: [
        text(
          'What every piece is worth',
          [
            'The book starts with values because every trade you will ever consider starts here: pawn 1, knight 3, bishop 3, rook 5, queen 9. The king is priceless: lose him and the game is over.',
            'Knight and bishop are both worth about 3 points. Rooks are worth one knight plus two pawns. A queen is worth two rooks, or a rook, a minor piece and a pawn.',
          ],
          'Pawn 1, knight 3, bishop 3, rook 5, queen 9. Count these points before you ever trade.',
        ),
        quiz('The queen price tag', 'How many pawns is a queen worth in the standard point system?', [
          wrong('5', '5 is the rook. The queen is stronger still.'),
          right('9', 'Queen 9. That is why giving your queen away must win at least a rook and more.'),
          wrong('3', '3 is a knight or a bishop. The queen is worth three of them.'),
        ]),
        text(
          'The three special moves',
          [
            'Castling: the king slides two squares toward a rook and the rook hops over. Both the king and that rook must not have moved yet, no piece may stand between them, and the king may not pass through or land on an attacked square.',
            'En passant: a pawn that has just advanced two squares can be captured by an enemy pawn as if it had moved only one. The chance lasts exactly one move.',
            'Promotion: a pawn that reaches the far rank becomes a queen (almost always), rook, bishop or knight.',
          ],
          'Castling, en passant, promotion. Every other move follows the plain rules.',
        ),
        demo(
          'Castling: two squares, one hop',
          [
            'Kingside castling sends the king from e1 to g1 and the rook from h1 to f1 in one move, written O-O.',
            'Queenside castling sends the king to c1 and the rook from a1 to d1, written O-O-O.',
            'The king gets safe, the rook gets into the game: two jobs, one move.',
          ],
          START,
          {
            marks: [
              { square: 'g1', color: 'green' },
              { square: 'c1', color: 'green' },
            ],
            caption: 'Kingside lands on g1, queenside on c1',
          },
        ),
        quiz('Write the castle', 'White castles kingside. How is that move written?', [
          right('O-O', 'O-O is kingside, O-O-O is queenside. You will read both a thousand times.'),
          wrong('Kg1', 'The king and the rook move together, so castling gets its own notation.'),
          wrong('O-O-O', 'Three O\'s means queenside: the king travels the longer way.'),
        ]),
        demo(
          'En passant: the one-move window',
          [
            'This position comes from 1.e4 e6 2.e5 d5. The black pawn just jumped to d5 and now sits beside your pawn on e5.',
            'Your e5 pawn may capture it as if it had stopped on d4: exd6, and the black pawn disappears. Next move the chance is gone forever.',
          ],
          'rnbqkbnr/ppp2ppp/4p3/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
          {
            marks: [
              { square: 'd5', color: 'red' },
              { square: 'd6', color: 'green' },
            ],
            caption: 'White to play exd6',
          },
        ),
        drill(
          'Take it en passant',
          'rnbqkbnr/ppp2ppp/4p3/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
          ['exd6'],
          'Capture the d5 pawn as if it had moved one square',
          'Your e5 pawn captures diagonally: click it, then click the empty d6 square.',
          'The black pawn is captured on d6, not on d5. That is what en passant means: in passing.',
        ),
        drill(
          'Promote with a capture',
          'rnbqkbnr/pPpppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 5',
          ['bxa8=Q'],
          'Your b7 pawn has reached the seventh rank. Make it a queen.',
          'The b8 square is blocked, but pawns capture diagonally: take the rook on a8 and promote.',
          'bxa8=Q: the pawn becomes a queen on a8. Written with =Q. Promoting to a queen is right 99 percent of the time.',
        ),
        quiz('Read the record', 'A scoresheet shows "Rh8#". What happened?', [
          wrong('A rook moved to h8, game continues', 'The little mark at the end means more than that.'),
          right('A rook moved to h8 and delivered checkmate', '# means checkmate, + means check, x means a capture.'),
          wrong('A rook captured on h8', 'A capture would be written Rxh8. The # is the news.'),
        ]),
      ],
    },

    /* --------------------------------------------- hw-02: chapters 3 and 4 */
    {
      id: 'hw-02',
      n: 2,
      title: 'How games are won and how to practice',
      subtitle: 'Checkmate, resignation, the clock, and the practice loop that actually raises rating.',
      minutes: 10,
      concepts: ['mate', 'calculation'],
      steps: [
        text(
          'The four ways a game ends in your favor',
          [
            'Checkmate: the king is attacked and has no escape. This is the only way to force a win on the board.',
            'Resignation: the opponent quits. Good players resign lost positions to save time; at beginner level the book says almost never, because blunders come back.',
            'Winning on time: the opponent\'s clock runs out. If you have no material to mate with, a timeout is only a draw.',
            'Abandonment: the opponent simply stops showing up.',
          ],
          'Learn to deliver mate. Every other win is the opponent handing you the game.',
        ),
        text(
          'The fastest mates, so they never happen to you',
          [
            "Fool's Mate ends in two moves: 1.f3 e5 2.g4 Qh4 checkmate. It works only because White tore open the king's diagonal with two pawn moves and developed nothing.",
            "Scholar's Mate stalks f7 in four moves: 1.e4 e5 2.Qh5 Nc6 3.Bc4 and then Qxf7, because f7 is guarded by the king alone.",
            'The cure for both is the same: center pawns, develop pieces, castle early, and never panic-move to chase an early queen.',
          ],
          'The fastest mates need the victim\'s help. Principled development beats them automatically.',
        ),
        demo(
          "Fool's Mate, the two-move knockout",
          [
            'Watch the whole disaster: f3 opens the king\'s diagonal, g4 opens it wider, and the black queen rides to h4 with checkmate.',
            'Note what White never did: a single developing move.',
          ],
          START,
          { moves: ['f3', 'e5', 'g4', 'Qh4#'], caption: 'Checkmate on move two' },
        ),
        drill(
          'Stop Scholar\'s Mate cold',
          'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
          ['g6'],
          "The queen on h5 and bishop on c4 both aim at f7. Defend the right way.",
          'What attacks the queen on h5? One pawn move does the whole job.',
          'g6 kicks the queen and blunts the diagonal toward f7. One move answers two problems: that is principled defense.',
        ),
        text(
          'The practice loop the book teaches',
          [
            'Play real games: rapid time controls (10 minutes or longer) teach more than blitz, because you have time to think.',
            'Solve puzzles: tactics decide beginner games, and puzzles train you to spot forks, pins and mates before the opponent does.',
            'Analyze every game with the engine or a coach and find the FIRST mistake, not the last one. Fixing the first mistake is what stops the pattern.',
            'Repeat. Rating is the slow output of that loop, never the goal itself.',
          ],
          'Games, puzzles, analysis, repeat. That is the whole improvement machine.',
        ),
        quiz('Best time control to improve', 'Which time control does the book recommend for learning?', [
          right('10 minutes or longer per side', 'Longer games give you time to run the thinking method. Blitz teaches speed, not chess.'),
          wrong('3-minute blitz', 'Fast and fun, but habits form badly when there is no time to think.'),
          wrong('Puzzle rush only', 'Puzzles are one third of the loop. Games and analysis are the other two.'),
        ]),
        quiz('Timeout, no mating material', 'Your opponent\'s clock expires, but you only have a king and a knight left. Result?', [
          wrong('You win on time', 'Not with a bare king and knight: you cannot even force mate.'),
          right('Draw', 'Timeout with insufficient mating material is a draw, not a win. Know this before you shuffle pieces.'),
          wrong('Loss for both', 'Nobody loses here. The rules call it a draw.'),
        ]),
      ],
    },

    /* ------------------------------------------- hw-03: chapter 5, part 1 */
    {
      id: 'hw-03',
      n: 3,
      title: 'The golden rules of the opening',
      subtitle: 'Three principles, one job each: center, development, king safety.',
      minutes: 10,
      concepts: ['center', 'development', 'castlingSafety'],
      steps: [
        text(
          'Rule 1: fight for the center',
          [
            'e4 and d4 grab space, free two pieces, and give every piece you develop more squares to live on.',
            'A piece in the center sees the whole board. A piece on the rim sees one side.',
          ],
          'Open with a center pawn. e4 or d4, almost every game.',
        ),
        text(
          'Rule 2: develop a new piece every move',
          [
            'Knights before bishops is the beginner shortcut, because knights know where they want to go (f3, c3, f6, c6).',
            'Never move the same piece twice in the opening without a reason: every repeat move hands the opponent a free tempo.',
            'Keep the queen home early. She is the strongest piece, which means she is the easiest to chase while your undeveloped pieces watch.',
          ],
          'One new piece per move, knights first, queen stays home.',
        ),
        text(
          'Rule 3: castle early',
          [
            'Castling does two jobs in one move: hides the king behind a pawn wall and brings a rook toward the center.',
            'The book\'s target: be castled before move ten, and know that games between beginners are decided by whose king is safer.',
          ],
          'Castle before move ten. King safety beats one extra pawn.',
        ),
        quiz('Which first move fights for the center', 'You are White. Which move is the book\'s model opening move?', [
          right('e4', 'A pawn to the center, two pieces freed. This is move one in most chess history.'),
          wrong('h3', 'A rim pawn develops nothing and helps nothing.'),
          wrong('Qh5', 'The queen out on move one gets chased and loses time.'),
        ]),
        quiz('The repeated-move sin', 'You played Nf3, then moved the knight again to g5 before developing anything else. What did you waste?', [
          right('A tempo: one free move for the opponent', 'Moving the same piece twice without purpose hands the opponent a free developing move.'),
          wrong('Nothing, the knight is stronger on g5', 'Maybe later. In the opening, speed of development is the currency.'),
          wrong('Castling rights', 'Castling rights survive. The cost is time, and time is development.'),
        ]),
        exercise(
          'Play the principled line',
          [
            'You are White. Follow the three rules one move at a time and Black will answer with the same plan.',
          ],
          START,
          ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
          'Center, develop, aim at the weakest square in Black\'s camp.',
          'e4 takes the center. Nf3 develops a knight. Bc4 is a new piece aiming at f7.',
          '1.e4 e5 2.Nf3 Nc6 3.Bc4: three principles, three moves, zero wasted time.',
        ),
        exercise(
          'Finish the job: castle',
          [
            'The Italian position: both sides developed, both kings still in the center. Your move.',
          ],
          ITALIAN,
          ['O-O'],
          'Do both jobs at once: king safety and a rook for the center.',
          'Click the king: two squares toward the kingside rook.',
          'O-O: king safe behind the pawn wall, rook ready to swing to the center or the open file.',
        ),
        playout(
          'Castle before move ten',
          'You are White against a sparring partner. Develop with purpose and get castled by move ten, without losing material.',
          START,
          'w',
          'Develop center, knights, bishops; castle early and survive the opening even.',
          2,
          'castle',
          16,
          'Castled, developed, and still level: that is a winning opening routine.',
          'The opening punished a wasted move somewhere. Find the first one and try again.',
          'Rules in order: center pawn, knights before bishops, castle. Do not move the same piece twice.',
        ),
      ],
    },

    /* ------------------------------------------- hw-04: chapter 5, part 2 */
    {
      id: 'hw-04',
      n: 4,
      title: 'The Italian Game',
      subtitle: "The book's first opening for White: build a battery against f7.",
      minutes: 11,
      concepts: ['development', 'center', 'castlingSafety'],
      steps: [
        text(
          'Why the Italian',
          [
            '1.e4 e5 2.Nf3 Nc6 3.Bc4: every move follows a golden rule, and the bishop lands on its best diagonal at once.',
            'From c4 the bishop stares at f7, the one square only the king defends at the start of the game.',
            'Add the knight on g5 later and f7 is hit twice: this is how the Italian turns principles into direct threats.',
          ],
          'The Italian is the golden rules turned into a weapon: bishop to c4, aim at f7.',
        ),
        demo(
          'The Italian in five moves',
          [
            'e4: center. Nf3: knight before bishop, attacking e5. Bc4: the f7 battery begins.',
            'Watch the marked square: f7 is defended exactly once, by the king.',
          ],
          START,
          {
            moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
            marks: [{ square: 'f7', color: 'red' }],
            caption: 'The bishop already aims at f7',
          },
        ),
        quiz('The weakest square', 'At the start of the game, which square does the Italian attack because only the king defends it?', [
          right('f7', 'Only the black king guards f7 in the opening. Everything the Italian does feeds this weakness.'),
          wrong('e5', 'e5 is attacked early, but it has a pawn and defenders. f7 is the special one.'),
          wrong('h7', 'h7 waits behind the castled king. f7 is the opening\'s soft spot.'),
        ]),
        text(
          'The classic central strike',
          [
            'After 3...Bc5 4.c3 the plan is d4: pawn to the center, gain a tempo on the bishop, open lines for everything.',
            'This is the Italian\'s middlegame engine: strike the center, then use the f7 battery while Black is busy.',
          ],
          'c3 prepares d4. The center strike is not a rule-break: it is the point of the whole opening.',
        ),
        drill(
          'Strike the center',
          'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq - 1 5',
          ['d4'],
          'White\'s c3 is played and the knight on f6 came out. Time for the central pawn break.',
          'Which pawn can advance two squares and hit the c5 bishop at the same time?',
          'd4 attacks the c5 bishop and challenges e5: Black must spend a move responding, and your pieces take over the center.',
        ),
        quiz('What NOT to do', 'In the Italian, your bishop sits on c4 aiming at f7. Black plays Nd4 hitting your f3 knight. What is the principled answer?', [
          wrong('Bxf7+ right away', 'Tempting, but f7 is defended by the king: you give the bishop for two pawns and lose the battery.'),
          right('Keep developing; if the knight takes your knight, recapture toward the center', 'Do not abandon development to chase a small fight. The plans keep flowing.'),
          wrong('Move the knight again to g5 immediately', 'That is the same piece twice, and Nd4 does not yet force anything.'),
        ]),
        playout(
          'Play the Italian for real',
          'From the starting position, get the bishop to c4, castle, and fight for the center with d4 when the time is right.',
          START,
          'w',
          'Reach a castled Italian position with at least three pieces developed.',
          2,
          'castle',
          16,
          'Castled Italian: principles on the board, threat on f7, game on.',
          'Something drifted. Ask yourself after each loss: which golden rule did I skip?',
          'e4, Nf3, Bc4, c3, d4, O-O. The order can flex; the plan cannot.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-05: chapter 6 */
    {
      id: 'hw-05',
      n: 5,
      title: 'Starting as Black',
      subtitle: 'Match, build, or set up: three honest ways to answer anything.',
      minutes: 11,
      concepts: ['center', 'development', 'pawnStructure'],
      steps: [
        text(
          'Way 1: match (1...e5)',
          [
            'Answer 1.e4 with 1...e5 and you mirror the golden rules: your own center pawn, and a free path for the f8 bishop and g8 knight.',
            'After 2.Nf3 Nc6 you have the same healthy position White wanted from the Italian, just one tempo behind. Nothing to fix.',
          ],
          '1...e5 is the classical answer: claim your center, develop fast, castle.',
        ),
        text(
          'Way 2: building blocks (Caro-Kann, French, QGD)',
          [
            'The building-block idea: support a center pawn with another pawn before it is attacked.',
            '1...c6 plans ...d5 with the pawn PROTECTED by the c6 pawn, not just attacked by pieces. The Queen\'s Gambit Declined does the same versus d4: ...d5 and ...e6, a rock under a rock.',
          ],
          'Buildings have foundations: pawn supports pawn, and the center survives.',
        ),
        text(
          'Way 3: setups (King\'s Indian, Pirc)',
          [
            'A setup opening is the same moves against nearly anything: ...d6, ...g6, ...Bg7, ...Nf6, castle. Learn it once, play it forever.',
            'The tradeoff: you concede some space early to guarantee a position you understand.',
          ],
          'Setups trade a little space for a lot of comfort. Perfect while learning.',
        ),
        quiz('The classical answer', 'White plays 1.e4. What is the classical, golden-rule reply?', [
          right('e5', 'Match the center. Every principle White enjoys, you get too.'),
          wrong('h6', 'A rim pawn that weakens your own king and develops nothing.'),
          wrong('Qh4?? no wait, that is White\'s trap move', 'Exactly the kind of early queen raid the golden rules warn about.'),
        ]),
        quiz('The building-block point', 'In the Caro-Kann, why does Black play 1...c6 before 1...d5?', [
          right('So the d5 pawn is protected by a pawn, not just attacked by pieces', 'Pawns defend pawns forever. Pieces defending pawns can be chased or traded away.'),
          wrong('To free the light-squared bishop immediately', 'The c8 bishop stays in jail for a while; c6 is about the pawn chain.'),
          wrong('To set up a quick queen sortie', 'The Caro-Kann is the opposite of a quick raid: it is a fortress.'),
        ]),
        exercise(
          'The classical Black setup',
          [
            'White opened 1.e4. Play the classical answer and develop naturally against it.',
          ],
          AFTER_E4,
          ['e5', 'Nf3', 'Nc6'],
          'Claim your center, then develop a knight to defend the pawn you just played.',
          '1...e5 matches the center. After Nf3, 2...Nc6 defends e5 and develops.',
          'e5, Nc6: the same healthy structure as the Italian, colors reversed.',
        ),
        exercise(
          'The Pirc setup in three moves',
          [
            'White tries 1.e4. Play the setup defense: fianchetto the bishop and get ready to castle.',
          ],
          AFTER_E4,
          ['d6', 'd4', 'g6', 'Nc3', 'Bg7'],
          'Small center, big diagonal: the g7 bishop becomes the engine of your defense.',
          'd6 keeps the center flexible, g6 opens the bishop\'s diagonal, Bg7 finishes the fianchetto.',
          'd6, g6, Bg7: the same three moves in every Pirc game. Comfort through repetition.',
        ),
        quiz('Which fits you', 'You want ONE response to 1.e4 that you will understand deeply, solid rather than sharp. The book\'s building-block pick is:', [
          right('The Caro-Kann: 1...c6', 'Solid pawn chain, clear plans, and the book\'s own favorite for Black at every level.'),
          wrong('Always 1...Nf6', 'That allows 2.e5 pushing you back; it is a system, but not the solid pick.'),
          wrong('Memorize twenty lines of the Sicilian', 'The Sicilian is sharp and theory-heavy: wrong tool for learning principles.'),
        ]),
      ],
    },

    /* ---------------------------------------------- hw-06: chapter 7, part 1 */
    {
      id: 'hw-06',
      n: 6,
      title: 'Endgames I: the ladder mate',
      subtitle: 'Two rooks, one staircase: the most reliable checkmate in chess.',
      minutes: 10,
      concepts: ['mate', 'endgame', 'technique'],
      steps: [
        text(
          'The staircase idea',
          [
            'With two rooks (or queen plus rook), you checkmate by pushing the enemy king up a staircase: one rook cuts off the rank the king stands on, the other checks and forces it one step further.',
            'Then the rooks swap jobs and climb again. The king walks to the edge of the board and runs out of board.',
            'Keep the working rook FAR from the king: a rook one square away can be captured; a rook across the board is untouchable.',
          ],
          'One rook cuts, one rook checks, repeat. Keep your distance and the king cannot fight back.',
        ),
        demo(
          'Mate in one, ladder finish',
          [
            'The rook on a7 already cuts rank 7: the black king cannot step down.',
            'The rook on b6 finishes: Rb8 is checkmate, because every escape square is owned.',
          ],
          '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1',
          { moves: ['Rb8#'], caption: 'The staircase ends on rank 8' },
        ),
        quiz('Why keep distance', 'Your rook is about to check the enemy king along a rank. Why give the check from far away?', [
          right('A close rook can be captured; a far rook is safe', 'The ladder only works while both rooks are untouchable.'),
          wrong('Close checks are faster', 'Close checks let the king approach and eat your rooks. Distance is safety.'),
          wrong('It does not matter', 'It matters: half of lost two-rook endings are a rook eaten at close range.'),
        ]),
        exercise(
          'Climb the whole staircase',
          [
            'Black king in the middle, two rooks ready. Push the ladder all the way to mate.',
            'After each check the king must step back; your rooks leapfrog one rank at a time.',
          ],
          '8/8/8/3k4/R7/1R6/8/6K1 w - - 0 1',
          ['Rb5+', 'Kd6', 'Ra6+', 'Kd7', 'Rb7+', 'Kd8', 'Ra8#'],
          'Check with one rook on the king\'s rank; the other rook already cuts the rank behind.',
          'Rb5+ checks along rank 5. Then the a4 rook jumps to a6, the b5 rook to b7, and the staircase finishes.',
          'Rb5+, Ra6+, Rb7+, Ra8#: four checks, one staircase, textbook mate.',
        ),
        playout(
          'Ladder mate against a live opponent',
          'The engine king will shuffle and stall. Build the staircase: cut a rank, check the king\'s rank, climb, repeat.',
          '7k/8/8/8/8/8/1R6/R5K1 w - - 0 1',
          'w',
          'Deliver checkmate with your two rooks.',
          1,
          'checkmate',
          25,
          'Staircase complete. This mate is now yours for life.',
          'The king slipped away or ate a rook. Keep the working rook FAR from the king.',
          'Cut one rank with a distant rook, check with the other from far away, and climb.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-07: chapter 7, part 2 */
    {
      id: 'hw-07',
      n: 7,
      title: 'Endgames I: queen and rook mates',
      subtitle: 'The box method with the queen, and the careful king-and-rook finish.',
      minutes: 12,
      concepts: ['mate', 'endgame', 'technique'],
      steps: [
        text(
          'Queen versus king: build a box, shrink the box',
          [
            'Put the queen a knight\'s move away from the enemy king: she builds a box the king cannot leave.',
            'Every move, shrink the box. When the box is tiny, bring YOUR king closer, then mate.',
            'Watch for stalemate: when the king has no moves but is not in check, the game is a draw. Always leave the king one square of air until you are mating.',
          ],
          'Knight-distance box, shrink it, walk your king in, mate. And count the stalemate squares.',
        ),
        text(
          'King and rook: the slow, certain method',
          [
            'The rook cuts the board in two (a whole rank or file between it and the enemy king) while your king walks up.',
            'Kings face off: opposition. When your king stands across from the enemy king with one square between, the side NOT to move holds the position.',
            'Finally the rook checks along the back rank while your king guards every escape: mate.',
          ],
          'Rook cuts, king walks, opposition locks, rook mates. Four ideas, one result.',
        ),
        drill(
          'Queen mate in one',
          '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
          ['Qf8#'],
          'Your king already guards the escape squares. Finish it.',
          'Which queen move attacks the h8 king while your king covers g7 and h7?',
          'Qf8#: the king has no square. Notice how much work your king had already done.',
        ),
        drill(
          'Rook mate in one',
          '4k3/8/4K3/8/8/8/8/6R1 w - - 0 1',
          ['Rg8#'],
          'The kings stand in perfect opposition on the e-file. Deliver the back-rank mate.',
          'Any rook move to rank 8 that keeps distance from the king works geometrically: pick the mate.',
          'Rg8#: cut rank 8 with check while the white king owns every square on rank 7.',
        ),
        quiz('The draw you must avoid', 'You are winning with queen against king. Suddenly the enemy king has NO legal moves but is NOT in check. What happened?', [
          right('Stalemate: the game is a draw', 'The most painful half point in chess. Leave the king breathing room until the final check.'),
          wrong('You are winning as planned', 'No: no legal moves without check is stalemate, and stalemate is a draw.'),
          wrong('The game continues', 'It does not. The position is dead: a draw.'),
        ]),
        quiz('Can a lone bishop mate?', 'King plus bishop versus king: can you ever force checkmate?', [
          right('No: it is a draw by insufficient material', 'Only king plus queen or king plus rook can FORCE mate. Bishop and knight alone cannot.'),
          wrong('Yes, in the corner', 'A corner mate needs the enemy\'s cooperation. Forced mate is impossible.'),
          wrong('Yes, if you have time', 'Time does not help. The rules agree: insufficient material.'),
        ]),
        playout(
          'Queen versus king, for real',
          'Build the box a knight\'s move from the king, shrink it every move, walk your king up, and mate. Engine level 1 defends patiently. Take your time; you have plenty of moves.',
          '8/8/8/4k3/8/6K1/8/5Q2 w - - 0 1',
          'w',
          'Checkmate with king and queen.',
          1,
          'checkmate',
          40,
          'Box built, box shrunk, king arrived, mate delivered.',
          'Watch for stalemate before every queen move: does the enemy king still have a square?',
          'Queen a knight\'s move from their king, shrink the box, bring your king, then mate.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-08: chapter 8 */
    {
      id: 'hw-08',
      n: 8,
      title: 'Middlegame checkmates',
      subtitle: 'Back rank, luft, smothered mate, and batteries.',
      minutes: 11,
      concepts: ['mate', 'kingSafety'],
      steps: [
        text(
          'The back-rank mate',
          [
            'A castled king trapped behind its own pawns (f7, g7, h7 and friends) can be mated by one rook or queen reaching the last rank.',
            'It happens because nobody spent one move making luft: an escape square like h3 or h6.',
            'Count back-rank weakness as a running checklist item, for both kings, every middlegame.',
          ],
          'Back-rank mates are a one-move fix (h3 or h6) applied one move too late.',
        ),
        demo(
          'The classic back rank',
          [
            'Black\'s king is walled in by his own pawns. One rook check and the wall becomes a cage.',
          ],
          '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
          { moves: ['Ra8#'], caption: 'The pawns that never moved now cost the game' },
        ),
        text(
          'The smothered mate',
          [
            'The most elegant mate in chess: a knight checks a king that is trapped by its OWN pieces.',
            'It usually follows a queen sacrifice: the queen lands next to the king, the rook is forced to capture, and the knight delivers mate on the square the rook just vacated.',
          ],
          'Smothered mate: their own army is the cage, your knight is the key.',
        ),
        drill(
          'Smother it',
          '5rkq/5ppp/2N5/8/8/8/8/6K1 w - - 0 1',
          ['Ne7#'],
          'The black king is boxed in by his own rook, queen and pawns. One knight move ends it.',
          'Which square does a knight attack the g8 king from, without being capturable?',
          'Ne7#: knight check, king fenced in by his own army. The pattern is worth a hundred blitz games.',
        ),
        text(
          'Batteries',
          [
            'A battery is two of your pieces lined up on one target: queen in front, rook or bishop behind.',
            'The front piece pressures the target; the back piece makes the front piece almost untouchable.',
            'Build batteries on open files toward the enemy king; they are the cheapest way to turn development into direct threats.',
          ],
          'Two pieces on one line: the front one threatens, the back one protects.',
        ),
        quiz('Battery building blocks', 'Which pair forms the classic battery against a castled king?', [
          right('Queen in front, rook behind on the same file', 'The rook backs the queen: capture the queen and the rook recaptures with the same threat.'),
          wrong('Two knights on adjacent squares', 'Knights never line up on one line; batteries are about lines.'),
          wrong('King behind pawn wall', 'That is shelter, not a battery: batteries attack.'),
        ]),
      ],
    },

    /* ---------------------------------------------- hw-09: chapter 9 */
    {
      id: 'hw-09',
      n: 9,
      title: 'Draws and the never-resign rule',
      subtitle: 'Stalemate traps, repetition, the fifty-move rule, and why beginners never quit.',
      minutes: 10,
      concepts: ['endgame', 'defense', 'technique'],
      steps: [
        text(
          'The five ways to draw',
          [
            'Agreement: both players accept the half point.',
            'Threefold repetition: the same position appears three times (claim it, or it happens automatically in fivefold form).',
            'Stalemate: the side to move has no legal move and is not in check.',
            'The fifty-move rule: fifty moves each with no capture and no pawn move.',
            'Insufficient material: king versus king, king plus minor piece versus king, and similar dead ends.',
          ],
          'Know all five: half points are won by players who recognize them.',
        ),
        demo(
          'The most painful stalemate',
          [
            'White is up a queen. But the queen on f7 takes every square from the h8 king while never giving check.',
            'Black to move: no legal move, no check. STALEMATE. Draw. One careless queen placement erased the whole win.',
          ],
          '7k/5Q2/8/8/8/8/8/6K1 b - - 0 1',
          { caption: 'Black to move: the game is a draw' },
        ),
        quiz('Who made the mistake', 'In the stalemate position shown, whose carelessness caused the draw?', [
          right('The winning side: the queen hogged every square without giving check', 'Before every queen move in a won ending, ask: does the enemy king still have a move?'),
          wrong('Black, for being mated soon', 'Black did nothing wrong: the position IS a draw the moment he has no move.'),
          wrong('Nobody, draws just happen', 'They do not just happen: they are engineered, usually by the winning side.'),
        ]),
        quiz('The insufficient pair', 'Which ending can NEVER be won by force?', [
          right('King and bishop versus king', 'No forcing mate exists. Shaking hands is the honest result.'),
          wrong('King and queen versus king', 'With technique this always wins: box, shrink, king, mate.'),
          wrong('King and two rooks versus king', 'The ladder mate wins every time.'),
        ]),
        drill(
          'Convert it cleanly',
          '4k3/8/4K3/8/8/8/8/6R1 w - - 0 1',
          ['Rg8#'],
          'King opposition is set. Find the ONE move that mates instead of stalemating.',
          'Check that every king move you consider still leaves the enemy king a square, until the final check.',
          'Rg8#: mate, not stalemate. The difference between a point and a half point is exactly this kind of care.',
        ),
        text(
          'Never resign (at this level)',
          [
            'The book is blunt: under about 1200, almost every "lost" position comes back, because blunders rain from both sides.',
            'Down a rook? Play for stalemate tricks, repetition, or a counter-fork. The opponent must still CONVERT the win.',
            'Resign only when the position is mate-in-short or the material difference is hopeless AND you have seen it with the engine.',
          ],
          'Make them prove the win. Half your "lost" games will come back on their own.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-10: chapter 10, part 1 */
    {
      id: 'hw-10',
      n: 10,
      title: 'Forks and pins',
      subtitle: 'The two tactics that decide most beginner games.',
      minutes: 11,
      concepts: ['fork', 'pin', 'winningMaterial'],
      steps: [
        text(
          'The fork',
          [
            'A fork is one piece attacking two or more targets at once. The victim can only save one.',
            'Knights are the fork champions: their jump ignores pawns and lands on squares nobody watches. Pawns fork too, and every pawn fork is cheap.',
            'The royal fork hits king and queen together: after the king steps aside, you take the queen.',
          ],
          'One attacker, two targets. Forks are found by scanning what your moves attack.',
        ),
        drill(
          'The royal fork',
          '4q1k1/p4ppp/8/8/6N1/8/PPP2PPP/6K1 w - - 0 1',
          ['Nf6+'],
          'One knight move forks the king and the queen at once.',
          'Find the square that attacks g8 AND e8. Nothing on f6 can be captured.',
          'Nf6+: check to the king, attack on the queen. He moves, you take the queen. That is material conversion.',
        ),
        text(
          'The pin',
          [
            'A pin freezes a piece because something more valuable stands behind it on the same line.',
            'Absolute pin: the king is behind. The pinned piece may NOT move (it would be illegal).',
            'Relative pin: a queen or rook is behind. Moving is legal, but loses the bigger piece. Pinned pieces are sitting ducks: pile more attackers on them.',
          ],
          'Pin it, then attack it again. A pinned piece defends nothing well.',
        ),
        demo(
          'The famous pin',
          [
            'After 1.e4 e5 2.Nf3 Nc6 3.Bb5 the c6 knight is pinned to the king: the bishop\'s diagonal runs b5-c6-d7-e8.',
            'Moving the knight would be illegal. That is the Ruy Lopez, the oldest opening idea still played at world championship level.',
          ],
          START,
          {
            moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
            marks: [{ square: 'c6', color: 'red' }],
            caption: 'The c6 knight is frozen to the king',
          },
        ),
        quiz('Absolute or relative', 'A bishop pins a knight to a QUEEN standing behind it. Can the knight legally move?', [
          right('Yes, but it loses the queen: a relative pin', 'Legal but costly. Attack the pinned piece and the bill comes due.'),
          wrong('No, the king is behind it', 'The queen is behind it: relative pin, move is legal.'),
          wrong('No pins allow movement', 'Only absolute pins (king behind) make movement illegal.'),
        ]),
        drill(
          'Hunt the pinned knight',
          '5r1k/5p1p/5n2/6B1/8/8/PPP2PPP/6K1 w - - 0 1',
          ['Bxf6+'],
          'The f6 knight is absolutely pinned by your bishop: g5-f6-g7-h8. Collect it.',
          'Who can recapture on f6? Check every defender carefully.',
          'Bxf6+ wins a whole knight with check: the rook on f8 is blocked by its own f7 pawn, and nothing else recaptures. Pinned pieces die twice.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-11: chapter 10, part 2 */
    {
      id: 'hw-11',
      n: 11,
      title: 'Skewers and discovered attacks',
      subtitle: 'Reverse pins, and the move that fires two pieces at once.',
      minutes: 11,
      concepts: ['skewer', 'discoveredAttack', 'doubleAttack'],
      steps: [
        text(
          'The skewer: a pin in reverse',
          [
            'A skewer attacks the BIG piece first: it must move, and you collect whatever stood behind it.',
            'Same geometry as a pin, reversed priorities: king in front, dinner behind.',
          ],
          'Check the king along a line where his own army is queued behind him.',
        ),
        demo(
          'Skewer: check first, dinner second',
          [
            'The bishop moves to c2 with check along the long diagonal. The king must step off the line.',
            'Then the bishop takes the queen that was hiding behind the king the whole time.',
          ],
          '8/7q/6k1/8/8/8/7P/3B3K w - - 0 1',
          { moves: ['Bc2+', 'Kh5', 'Bxh7'], caption: 'King moves, queen falls' },
        ),
        demo(
          'Rook skewer on a file',
          [
            'The rook checks down the d-file. The king steps aside, and the rook runs the file to take the queen on d8.',
          ],
          '3q4/8/8/3k4/8/8/8/4R1K1 w - - 0 1',
          { moves: ['Rd1+', 'Kc5', 'Rxd8'], caption: 'The file does the work' },
        ),
        text(
          'The discovered attack',
          [
            'Two of your pieces on one line: the front piece moves, and the back piece fires for free.',
            'Best case: the front piece ALSO makes a threat, so the opponent must answer two problems with one move and fails.',
            'Discovered CHECK is the sharpest version: the king must deal with the bishop while your knight loots the position.',
          ],
          'Move the front piece, fire the back piece. Look for your own aligned batteries.',
        ),
        demo(
          'The knight steps aside',
          [
            'The d4 knight blocks the b2 bishop\'s aim at h8. One knight move later: check from the bishop, out of nowhere.',
          ],
          '7k/8/8/8/3N4/8/1B6/6K1 w - - 0 1',
          { moves: ['Nf5+'], caption: 'Discovered check from b2' },
        ),
        drill(
          'Check and loot',
          '7k/8/8/8/3N3q/8/1B6/6K1 w - - 0 1',
          ['Nf3+'],
          'The knight on d4 stands on the bishop\'s diagonal. Move it somewhere that ALSO attacks the queen.',
          'Where does the knight attack h4 while unmasking the bishop\'s check to h8?',
          'Nf3+: discovered check from b2 AND the knight attacks h4. He saves the king, you take the queen.',
        ),
        quiz('Skewer or pin', 'A bishop attacks a KING with a knight standing on the same diagonal directly behind the king. The geometry is a:', [
          right('Skewer: the king moves, the knight falls', 'Big piece in front, target behind: skewer. A pin would freeze the front piece.'),
          wrong('Pin: the king cannot move', 'Kings are never pinned: they are checked, and here the check wins material.'),
          wrong('Fork', 'Forks need ONE attacker hitting TWO pieces. Here one line does the work.'),
        ]),
      ],
    },

    /* ---------------------------------------------- hw-12: chapter 11 */
    {
      id: 'hw-12',
      n: 12,
      title: 'Beginner strategy',
      subtitle: 'Rooks on open files, attacks built properly, and no unprotected pieces.',
      minutes: 10,
      concepts: ['pieceActivity', 'openFiles', 'kingSafety'],
      steps: [
        text(
          'Rooks wake up on open files',
          [
            'A rook in the corner defends nothing and attacks nothing. A rook on an open file (no pawns on it) controls the whole line and invades the seventh rank.',
            'Open files are MADE by pawn trades in the center: this is why the center strikes from the Italian lesson matter.',
          ],
          'Every rook you own belongs on a file, preferably an open one.',
        ),
        text(
          'Attack the castled king with a crowd',
          [
            'Two attackers versus two defenders gains nothing. The math of an attack: bring MORE attackers than there are defenders, usually pawns plus two or three pieces.',
            'Pawn storms: against a castled king, your pawns (g4, h4, then g5 or h5) dig the trench while pieces fire over it.',
            'Every piece you attack with must be defended, or the counterattack eats you.',
          ],
          'Attacks are built, not wished: count attackers and defenders like points.',
        ),
        demo(
          'Make an open file',
          [
            'The center trade 3.d4 exd4 4.Nxd4 opens the d-file the moment anything leaves it.',
            'Whoever plants a rook there first usually controls the middlegame.',
          ],
          START,
          {
            moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'],
            marks: [{ square: 'd4', color: 'green' }],
            caption: 'The d-file is opening',
          },
        ),
        quiz('The loose piece habit', 'What is an "unprotected piece", and why does the book obsess over it?', [
          right('A piece with zero defenders: it can be captured for free or traded at a profit', 'Loose pieces drop off. Scan both armies for them before every move.'),
          wrong('A piece on its starting square', 'Undeveloped is not unprotected. The danger is having no defender.'),
          wrong('A piece on the rim', 'Rim pieces are often weak, but the fatal issue is defense, not the rim.'),
        ]),
        quiz('Before you attack', 'Your gut says "attack the castled king". What does the book demand first?', [
          right('Count: do I have more attackers than he has defenders near the king?', 'Two versus two is a trade-fest, not an attack. Build the crowd first.'),
          wrong('Play the fastest pawn move toward his king', 'Pawn storms work with pieces behind them. Pawns alone just die.'),
          wrong('Trade queens to make it safer', 'Trading queens usually KILLS your attack: the queen is the main attacker.'),
        ]),
      ],
    },

    /* ---------------------------------------------- hw-13: chapter 12 */
    {
      id: 'hw-13',
      n: 13,
      title: 'Choosing your openings',
      subtitle: 'Consistency beats variety: one system for White, one defense for Black.',
      minutes: 9,
      concepts: ['development', 'pawnStructure', 'tradeDecisions'],
      steps: [
        text(
          'The one-opening rule',
          [
            'You grow by playing the SAME opening twenty times and fixing your earliest mistake each game, not by collecting names.',
            'For White the book offers three roads: 1.e4 (principled, lots of variety), 1.d4 (system-friendly, the London road), 1.c4 (the English, positional and sneaky).',
            'For Black: versus e4 the two big worlds are 1...e5 (classical, principled) and the solid defenses (Caro-Kann, Scandinavian). Versus d4: the Queen\'s Gambit Declined, or a setup like the King\'s Indian.',
          ],
          'Pick one road per color. Depth in one opening beats shallow memories of ten.',
        ),
        quiz('Why d4 systems feel easier', 'Why do system openings like the London cost less study time than open games?', [
          right('The same setup works against almost anything Black does', 'One plan, repeated, means deep understanding sooner. Comfort is a rating strategy.'),
          wrong('d4 openings have no theory', 'They have plenty. It is just REUSED: the same moves versus many defenses.'),
          wrong('d4 wins more often', 'No opening wins by name. Systems win because you know your plan better than they know theirs.'),
        ]),
        quiz('The memory trap', 'What is the most common way beginners waste opening study time?', [
          right('Memorizing twenty deep moves instead of learning the opening\'s plans', 'Openings are ideas: center, development, pawn structure. Plans transfer; move lists do not.'),
          wrong('Playing the opening in real games', 'That is exactly how openings stick. Play, review, repeat.'),
          wrong('Using an opening trainer', 'Trainers drill the RIGHT moves. The trap is memorizing without understanding.'),
        ]),
        text(
          'How to actually learn your pick',
          [
            'Learn the first four moves and the IDEA behind each one. That covers 90 percent of beginner games.',
            'After each game, find the first move that left book logic (usually a premature attack or a wasted tempo) and fix it next game.',
            'Use the Opening Training tab here in ChessX: drill the line until the moves come without thinking.',
          ],
          'Four moves, one idea, twenty repetitions. Then the opening is yours.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-14: chapter 13, part 1 */
    {
      id: 'hw-14',
      n: 14,
      title: 'The London System',
      subtitle: 'One setup, every defense: d4, Bf4, e3, Bd3, castle.',
      minutes: 11,
      concepts: ['pawnStructure', 'development', 'castlingSafety'],
      steps: [
        text(
          'The setup, in order',
          [
            '1.d4, then bishop to f4 EARLY (before e3 blocks it in), then e3, knight f3, bishop d3, knight d2, castle. Every game, almost regardless of what Black does.',
            'The dark-squared bishop lives happily on f4 outside the pawn chain: that is the whole system\'s secret.',
            'Black must find a plan against your solid wall every single game; you already know yours.',
          ],
          'd4, Bf4, e3, Nf3, Bd3, Nbd2, O-O. Same castle, same wall, same plans.',
        ),
        demo(
          'The London, move by move',
          [
            'Watch the order: Bf4 comes before e3, so the bishop exits before the pawn seals it in.',
            'The final picture: bishop d3 aiming at h7, pawns c3-d4-e3, king castled, rooks connected.',
          ],
          START,
          {
            moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Bd3', 'Be7', 'Nbd2', 'O-O', 'O-O'],
            caption: 'The full London setup',
          },
        ),
        quiz('The move order that matters', 'Why must Bf4 be played BEFORE e3 in the London?', [
          right('e3 blocks the c1 bishop\'s diagonal; the bishop must escape first', 'The classic London mistake is Bf4 AFTER e3, wasting two moves reorganizing.'),
          wrong('It does not matter: same squares', 'Order is the whole system: Bf4 first is one tempo, Bf4 later is three.'),
          wrong('Because d5 must be met by Bf4', 'Bf4 does not address d5. The order is about the bishop\'s exit route.'),
        ]),
        text(
          'The trap to know: the Englund',
          [
            'Against the London, Black sometimes springs 1...e5?! offering the Englund Gambit.',
            'The answer is calm: take the free pawn with 2.dxe5. If the queen ever grabs d4, Nf3 hits her while c3 and the bishop build a net.',
            'One rule covers it: when Black offers an early pawn with no development, count what protects it. Usually: nothing.',
          ],
          'dxe5, then develop. Greed loses games; free pawns with a safe path win them.',
        ),
        quiz('Free pawn discipline', 'After 1.d4 e5?! you took the pawn with 2.dxe5. What is the correct next move, and why?', [
          right('Develop with tempo, e.g. Nf3 or Bf4: keep the extra pawn behind your wall', 'Up a pawn with better development is the healthiest winning position in chess.'),
          wrong(' immediately push e4 to grab more space', 'Every extra pawn push weakens something. Develop first, push later.'),
          wrong('Give the pawn back for fast development', 'No need: development and the pawn are compatible here.'),
        ]),
        playout(
          'Play the whole London',
          'Get castled with the full setup: d4, Bf4, e3, Nf3, Bd3, Nbd2, O-O. Do not drift into aimless moves.',
          START,
          'w',
          'Complete the London setup and reach safety with an even game.',
          2,
          'castle',
          16,
          'The wall stands, the bishop aims, the rooks are connected: this is the London.',
          'Watch the order: Bf4 before e3, Bd3 before Nbd2, castle when it is safe.',
          'd4, Bf4, e3, Nf3, Bd3, Nbd2, O-O. Memorize the order, not the opponent.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-15: chapter 13, part 2 */
    {
      id: 'hw-15',
      n: 15,
      title: 'The Vienna and the Alapin',
      subtitle: 'Aggressive White systems: the Vienna Gambit and the calm answer to the Sicilian.',
      minutes: 11,
      concepts: ['sacrifice', 'initiative', 'center'],
      steps: [
        text(
          'The Vienna: 1.e4 e5 2.Nc3',
          [
            'The Vienna keeps the e4 center flexible: the knight develops FIRST, and the f-pawn waits.',
            'After 2...Nf6 the famous 3.f4!? offers the Vienna Gambit: a pawn for the center (e5 push), the f-file, and a lead in development.',
            'Black who grabs the f4 pawn without understanding the position often gets buried by e5, Nf3, and the opened f-file.',
          ],
          'Nc3 first, f4 later: the Vienna turns the golden rules into an ambush.',
        ),
        demo(
          'The Vienna Gambit on the board',
          [
            '2.Nc3 develops. 3.f4 offers the pawn: after ...exf4 the e4 pawn advances to e5, the f-file opens, and White\'s pieces pour out.',
          ],
          START,
          { moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'exf4'], caption: 'The pawn is offered' },
        ),
        quiz('What the gambit buys', 'After 3.f4 exf4, what does White get for the pawn?', [
          right('The e5 push, the open f-file, and a lead in development', 'Space, lines, and time: the three currencies of every sound gambit.'),
          wrong('Nothing: gambits are just traps', 'Good gambits are investments, not lotteries. The Vienna pays rent every move.'),
          wrong('A direct queen attack', 'No queen raid here: the attack is built from center and development.'),
        ]),
        drill(
          'Offer the gambit',
          'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 1 3',
          ['f4'],
          'The Vienna position: knight developed, center held. Make the signature move.',
          'Which pawn is offered for the center and the f-file?',
          'f4: the Vienna Gambit. If Black takes it, e5 and Nf3 follow with big central pressure.',
        ),
        text(
          'Against the Sicilian: the Alapin',
          [
            '1.e4 c5 is the Sicilian, the sharpest defense in chess. 2.c3!? (the Alapin) sidesteps the mountains of theory.',
            'The plan: build the big pawn duo c3+d4, develop simply, and fight on YOUR structure instead of theirs.',
          ],
          'When theory is a jungle, play the move that makes YOUR plan simple.',
        ),
        playout(
          'Vienna from the gambit position',
          'Black just grabbed the f4 pawn after 3.f4 exf4. Now prove the investment: e5 push, Nf3, d4, castle, and use the f-file.',
          'rnbqkb1r/pppp1ppp/5n2/8/4Pp2/2N5/PPPP2PP/R1BQKBNR w KQkq - 0 4',
          'w',
          'Castle with strong development and keep the initiative.',
          2,
          'castle',
          14,
          'Development complete, center yours: the gambit paid its rent.',
          'The pawn is gone; do not chase it. Build e5, Nf3, d4, castle.',
          'e5 kicks the knight, Nf3 develops with tempo, d4 grabs the center, O-O ends the opening.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-16: chapter 14, part 1 */
    {
      id: 'hw-16',
      n: 16,
      title: 'The Scandinavian Defense',
      subtitle: '1...d5 immediately: drag White out of theory on move two.',
      minutes: 10,
      concepts: ['development', 'initiative', 'center'],
      steps: [
        text(
          'The idea',
          [
            '1.e4 d5!? challenges the center on move one. If White takes, the queen recaptures: 2.exd5 Qxd5.',
            'Yes, the queen comes out early, BUT the rules allow informed exceptions: the queen recaptured a pawn, so she STANDS on a good square, and 3.Nc3 is answered by ...Qa5 or ...Qd6.',
            'The payoff: White has burned a move capturing, and Black is in a position nobody prepared for.',
          ],
          'The Scandinavian breaks the "never the queen" rule with a reason, not a hope.',
        ),
        demo(
          'The whole opening in four moves',
          [
            'd5 challenges. exd5 captures. Qxd5 recaptures with the queen standing proudly in the center.',
            'Next move the knight comes out, and the queen steps to a5 or d6, safe and useful.',
          ],
          START,
          { moves: ['e4', 'd5', 'exd5', 'Qxd5'], marks: [{ square: 'd5', color: 'green' }], caption: 'The queen recaptures on d5' },
        ),
        drill(
          'The queen\'s safe square',
          'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3',
          ['Qd6'],
          'The knight attacks your queen on d5. Choose the book\'s retreat.',
          'Which square keeps the queen central, developed, and away from c3, a3 and the Bg5 pin?',
          'Qd6: solid, central, and ready to castle. The c6-square plan (...c6 giving the queen an exit) keeps the whole line safe.',
        ),
        quiz('Why play it', 'What is the Scandinavian\'s real benefit for improving players?', [
          right('You know YOUR plans while White improvises on unfamiliar ground', 'Opening comfort is a weapon: the same structures every game beat shallow theory.'),
          wrong('It wins material by force', 'No: the pawn is recaptured and material is equal. The edge is knowledge, not points.'),
          wrong('It avoids all theory forever', 'It has theory too, but yours is short, coherent, and yours.'),
        ]),
        playout(
          'Scandinavian against the engine',
          'You are Black after 1.e4. Play 1...d5, recapture with the queen if needed, develop with tempo, and castle.',
          AFTER_E4,
          'b',
          'Reach a castled position with your queen safe and knights developed.',
          2,
          'castle',
          20,
          'Castled Scandinavian: queen safe, structure intact, game on.',
          'If the queen gets hit twice, she pays for her trip. Retreat with a plan, not a panic.',
          'd5, recapture, Nf6 or Qd6, c6 for the queen\'s exit, castle.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-17: chapter 14, part 2 */
    {
      id: 'hw-17',
      n: 17,
      title: 'The Caro-Kann Defense',
      subtitle: "The book's favorite: a fortress with a plan.",
      minutes: 11,
      concepts: ['pawnStructure', 'defense', 'tradeDecisions'],
      steps: [
        text(
          'Why the Caro-Kann',
          [
            '1.e4 c6 2.d4 d5: the d5 pawn is protected by the c6 pawn, so unlike 1...e5 there is no nagging attack on your center.',
            'Black\'s plan is patient: solid structure, trade into a healthy endgame, and squeeze space with ...c5 against White\'s big center.',
            'The famous cost: the c8 bishop starts in jail. The cure is time: ...c5 and ...dxe4 trades open its diagonal naturally.',
          ],
          'The Caro-Kann wins by surviving better, not by attacking faster.',
        ),
        demo(
          'The wall: c6 and d5',
          [
            'Two pawns, mutual protection, maximum solidity. White must spend real effort to break what took you two moves to build.',
          ],
          START,
          {
            moves: ['e4', 'c6', 'd4', 'd5'],
            marks: [
              { square: 'c6', color: 'green' },
              { square: 'd5', color: 'green' },
            ],
            caption: 'The foundation: c6 under d5',
          },
        ),
        text(
          'The Advance Variation: strike at the base',
          [
            'After 3.e5 White grabs space. The pawn chain\'s base is d4: attack it with 3...c5.',
            'Every trade after that releases a piece, especially the c8 bishop, and Black\'s position breathes.',
          ],
          'Big pawn chains are attacked at the base. Against e5, c5 is always the first idea.',
        ),
        drill(
          'Strike the base',
          'rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3',
          ['c5'],
          'White played the Advance Variation with 3.e5. Undermine the chain.',
          'Which black pawn attacks the base of the c6-d5-e5 chain?',
          'c5: hit d4, the base of the chain. Trades follow, pieces breathe, the fortress pays rent.',
        ),
        quiz('The exchange variation', 'White plays 4.exd5 cxd5, trading the center pawns. Is this bad for Black?', [
          right('No: the structure is clean and Black is comfortable', 'Symmetry favors no one, and Black\'s structure has zero weaknesses. Fine trade.'),
          wrong('Yes, White wins the center forever', 'With pawns traded, the center is OPEN: no chain remains to dominate.'),
          wrong('Yes, the c8 bishop is dead', 'The open c-file and light squares give the bishop the best game it has had all opening.'),
        ]),
        playout(
          'Caro-Kann against the engine',
          'You are Black after 1.e4. Build the wall: c6, d5, develop behind it, and castle. Solid wins slow games.',
          AFTER_E4,
          'b',
          'Castle safely with the c6-d5 structure intact.',
          2,
          'castle',
          20,
          'Fortress built, king safe: the Caro-Kann doing its job.',
          'If White grabs space with e5, remember the base: c5.',
          'c6, d5, Nc6 or Nd7, develop, c5 when it hits something, castle.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-18: chapter 15 */
    {
      id: 'hw-18',
      n: 18,
      title: 'Gambits: real and fake',
      subtitle: 'Which pawn sacrifices are investments, and which are noise.',
      minutes: 10,
      concepts: ['sacrifice', 'development', 'initiative'],
      steps: [
        text(
          'What a gambit actually is',
          [
            'A gambit sacrifices material (usually a pawn) for something durable: development, the center, open lines, or the initiative.',
            'The Queen\'s Gambit is NOT a real gambit: after 1.d4 d5 2.c4 dxc4 the pawn comes back soon (e4 regains it, or b3). It is a center lever wearing a gambit\'s name.',
            'Real gambits: the Danish (pawns for two giant bishops), the King\'s Gambit (f4 for the center and f-file), the Smith-Morra against the Sicilian (a pawn for a huge lead in development).',
          ],
          'A sound gambit buys PERMANENT things. A bad one buys a scare.',
        ),
        demo(
          'The Danish: pawns into bishops',
          [
            '1.e4 e5 2.d4 exd4 3.c3 dxc3 4.Bc4: White has paid two pawns and holds two monstrously active bishops, an open center, and a direct aim at f7.',
            'Every White piece enters the game one move after Black captures. That is what "investment" means.',
          ],
          START,
          { moves: ['e4', 'e5', 'd4', 'exd4', 'c3', 'dxc3', 'Bc4'], caption: 'Two pawns down, two bishops roaring' },
        ),
        quiz('The fake gambit', 'Why is the Queen\'s Gambit not a true gambit?', [
          right('White regains the pawn quickly; the sacrifice is temporary by design', '2...dxc4 is met by e4 or b3: the pawn returns, and the center plan continues.'),
          wrong('It offers a knight, not a pawn', 'It offers the c4 pawn. The NAME is the only deceptive part.'),
          wrong('Because nobody ever accepts it', 'People accept it all the time: the point is the pawn comes back anyway.'),
        ]),
        text(
          'Black gambits: high risk',
          [
            'When Black gambits (Englund 1...e5?!, Blackburne Shilling 3...Nd4?!), the first-move advantage works AGAINST the sacrifice.',
            'The book\'s stance: as Black, do not gamble material for traps. Take correct development instead; punish greed when WHITE offers something.',
            'The Blackburne Shilling, though, is worth knowing as a WARNING: after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4?! the greedy 4.Nxe5?? runs into ...Qg5 hitting knight and g2.',
          ],
          'As Black, solidity is the strategy; as White, take gambits only when you see the refutation.',
        ),
        quiz('Punish the greed', 'In the Scandinavian-style Englund, after 1.d4 e5?! 2.dxe5 Qxd4?? what hits the queen immediately?', [
          right('Nf3, developing AND attacking the queen', 'The queen must run while White develops. Greed punished by tempo: the whole lesson in one move.'),
          wrong('c3, kicking it right away', 'c3 also works but is slower: Nf3 develops while attacking. Tempo plus development.'),
          wrong('Nothing, the queen is safe', 'The queen on d4 is attacked by Nf3 (and soon c3): she is NOT safe.'),
        ]),
        drill(
          'Start the Danish',
          'rnbqkbnr/pppp1ppp/8/8/3p4/8/PPP2PPP/RNBQKBNR w KQkq - 0 3',
          ['c3'],
          'Black just took the d4 pawn after 2.d4 exd4. Launch the gambit.',
          'Which pawn offers itself to rebuild the center and open the bishops?',
          'c3: if Black takes, Bc4 and Qb3 roar at f7. If he declines, the center is yours anyway.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-19: chapter 16, part 1 */
    {
      id: 'hw-19',
      n: 19,
      title: 'Opposition and pawn endgames',
      subtitle: 'One square apart decides everything: who must move, loses.',
      minutes: 12,
      concepts: ['opposition', 'endgame', 'promotion'],
      steps: [
        text(
          'The opposition',
          [
            'Kings face each other with exactly one square between them. The side NOT to move holds the opposition; the side TO move must give way.',
            'In pawn endings the whole game is this dance: whoever must move steps aside, and the other king takes the key squares in front of the pawn.',
            'Golden rule: keep your king IN FRONT of your pawn, and take the opposition when the kings line up.',
          ],
          'Kings in line, one square apart: the player NOT to move owns the position.',
        ),
        demo(
          'Opposition on the board',
          [
            'The kings stand on e4 and e2 with e3 between them: full opposition.',
            'The side to move here must give way, and the other king advances into the freed space.',
          ],
          '8/8/8/8/4K3/8/4k3/8 w - - 0 1',
          { marks: [{ square: 'e3', color: 'gold' }], caption: 'Whoever moves, gives way' },
        ),
        quiz('The rule itself', 'The kings stand in direct opposition. Which side is in trouble?', [
          right('The side that must move right now', 'Zugzwang for kings: to move is to yield the key squares.'),
          wrong('The side that just moved', 'The side that just moved HOLDS the opposition. Comfort is theirs.'),
          wrong('Neither, it is balanced', 'It looks balanced. It is not: the move order decides the whole endgame.'),
        ]),
        drill(
          'Promote with mate',
          '6k1/4P1pp/8/8/8/8/8/4K1R1 w - - 0 1',
          ['e8=Q#'],
          'Your pawn stands on e7. One move wins the game outright.',
          'Does the promotion land with CHECK? Follow the e8 queen\'s lines.',
          'e8=Q#: promotion and mate in one. Endgame technique ends games; memorize the ending, not just the promotion.',
        ),
        text(
          'Practical pawn endings',
          [
            'Passed pawns must be pushed, but the KING walks ahead of the pawn whenever possible.',
            'Rook endgames: rooks belong BEHIND passed pawns (yours or theirs). The Philidor defense draws rook endings: keep your rook on the third rank until the pawn crosses, then check from behind forever.',
            'Trade pieces, never pawns, when you are up a pawn in the endgame: the fewer pieces, the louder the extra pawn speaks.',
          ],
          'King in front, rook behind, trade pieces not pawns: the three endgame mantras.',
        ),
        quiz('Rook placement', 'A passed pawn is racing down the board. Where does the defending rook stand?', [
          right('Behind the pawn', 'Behind it the rook attacks forever and never gets attacked. In front, it gets traded.'),
          wrong('In front of the pawn, blocking it', 'In front it can be traded off by the pawn\'s own rook: the defender dies.'),
          wrong('On its starting square', 'Passive rooks lose endings. Activity is life.'),
        ]),
        playout(
          'Hold the draw: the opposition exercise',
          'The classic lesson position: kings in line, one lone pawn on the board. White to move here is the LOSING side of the opposition: your job is to hold the DRAW by mirroring his king and never letting him pass you.',
          '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
          'w',
          'Hold the draw: match his king\'s moves, stay in opposition, never fall behind.',
          1,
          'draw',
          50,
          'Held: the opposition saved the half point. Now you understand why kings matter most in endings.',
          'You fell out of opposition and the pawn ran. Mirror his king: where he goes, you go.',
          'Stay one square apart in front of the pawn. If he steps aside, take the space he freed.',
        ),
      ],
    },

    /* ---------------------------------------------- hw-20: chapters 17-18 */
    {
      id: 'hw-20',
      n: 20,
      title: 'The method: CCA and the whole game',
      subtitle: 'Checks, captures, attacks: the scan that turns knowledge into points.',
      minutes: 12,
      concepts: ['calculation', 'removingDefender', 'winningMaterial'],
      steps: [
        text(
          'The CCA scan',
          [
            'Before every move, in this order: CHECKS (every check you can give), CAPTURES (everything you can take, with count of attackers and defenders), ATTACKS (threats you can build).',
            'Checks first because they force: a check lets you dictate the reply and think one move for free.',
            'After the opponent moves, run the scan from HIS side: what does his move check, capture, or threaten NOW? Most beginner losses are a threat nobody looked at.',
          ],
          'Checks, captures, attacks. Before your move and after his. Every move. Every game.',
        ),
        drill(
          'Checks first: the royal fork',
          'r1b1k2r/pppp1ppp/2n5/3N4/4P3/8/PPPP1PPP/R1BQKB1R w KQkq - 0 6',
          ['Nxc7+'],
          'Run the scan: any checks? One knight move ends the debate.',
          'The knight on d5 jumps to a square that attacks the king AND a rook, collecting a pawn on the way.',
          'Nxc7+: check, so Black must respond, and the a8 rook hangs. The CCA scan finds forks without effort.',
        ),
        drill(
          'Checks first: the back rank',
          '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
          ['Rd8#'],
          'Scan checks. One rook move is the whole game.',
          'The king is walled in by his own pawns. Which rank is the cage door?',
          'Rd8#: the scan finds mates, not just tactics. This is why checks come first.',
        ),
        text(
          'Zwischenzug and removing the defender',
          [
            'Zwischenzug (the in-between move): instead of the expected recapture, play a stronger intermediate threat first. Trades are a conversation; you may change the subject.',
            'Removing the defender: if a key piece guards two things, capture it (even at a loss) and the guarded things both fall.',
            'Deflection and attraction are removing-the-defender\'s cousins: PULL the defender away, or PULL a defender ONTO a fatal square.',
          ],
          'Never recapture on autopilot. Ask: is there something in between?',
        ),
        quiz('The in-between move', 'You can recapture a piece, but the CCA scan finds a CHECK that also wins material. What is the correct play?', [
          right('Play the check first; recapture later if it still matters', 'Forcing moves buy time. The recapture waits; the check collects.'),
          wrong('Always recapture immediately to restore material', 'Material balance is a reflex, not a law. Forcing moves come first.'),
          wrong('Checks are only for mating attacks', 'Checks are tempo machines. The zwischenzug is just a check used politely.'),
        ]),
        text(
          'The final assembly: your method',
          [
            'Opening: golden rules (center, development, castling), one system per color, ideas over lines.',
            'Middlegame: CCA scan before every move, blunder check after his, loose pieces defended, rooks on files, attacks built with more attackers than defenders.',
            'Endgame: king active, opposition in pawn races, rooks behind passed pawns, know your mates, never resign.',
            'Practice loop: games, puzzles, analyze the FIRST mistake. This is the entire book, and now it is your method.',
          ],
          'Rules, scan, technique, loop. That is how you win at chess.',
        ),
        quiz('The loop, one last time', 'You lost a game. The book says the analysis target is:', [
          right('The FIRST mistake, so the pattern dies at the root', 'Fixing move 30\'s blunder helps nothing if move 12 created the losing position.'),
          wrong('The final blunder that lost material', 'Final blunders are symptoms. The first mistake is the disease.'),
          wrong('The opening name, so you switch openings', 'Switching openings every loss is how nobody ever improves anywhere.'),
        ]),
      ],
    },
  ],
}
