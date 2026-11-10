// Book-derived curriculum: the teaching framework of "How to Win at Chess"
// (Levy Rozman, 2023), rewritten as ChessX lessons.
//
// WHAT THIS IS: the book's core method — opening principles over memorized
// lines, a tactical-motif ladder, endgame fundamentals by rating bracket,
// and "train what your level actually needs" — mapped onto the existing
// tier/level structure. Every rating band of the book lands in the matching
// tier as extra levels appended to its chapter.
//
// WHAT THIS IS NOT: the book's text. No sentence, chapter title or example
// list is copied; every position here is composed or drawn from public-domain
// classics, and every explanation is ChessX's own. Attribution in each level
// names the teaching angle, not the source prose.
//
// All FENs and lines are validated by `bun run validate:content`.
import type { Level, Tier } from '../schema'
import { text, demo, quiz, drill, playout, gtmStep, right, wrong, guess } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const BOOK = 'How to Win at Chess (Levy Rozman), applied at this level.'

// ---------------------------------------------------------------------------
// Newbie — the book's first chapters: how games are won, the opening rules,
// and refusing the early-queen bait.
// ---------------------------------------------------------------------------

export const hwNewbie: Level[] = [
  {
    id: 'nb-hw1',
    n: 24,
    title: 'How games are actually won',
    subtitle: 'Checkmate ends it — material is how you get there.',
    minutes: 8,
    concepts: ['winningMaterial', 'mate'],
    steps: [
      text(
        'Nobody resigns to a pawn count',
        [
          'Games are won by checkmate. But you do not jump straight to mate — you collect small advantages first: free pieces, safer kings, more attackers in one place.',
          'The habit that separates beginners who improve from beginners who stall: before every move, ask what is undefended, and count attackers against defenders on every capture square.',
          'A piece is "free" when it has more attackers than defenders. Free pieces decide most games below 1000.',
        ],
        'Count attackers and defenders before you capture anything.',
      ),
      demo(
        'A pawn left unguarded',
        [
          'Black just played 2...f6?? attacking the knight but forgetting what it guards. The e5 pawn now has one attacker (the knight) and zero defenders.',
          'Watch the line: the knight takes the pawn, and Black cannot take back without the king walking into checks it cannot afford.',
        ],
        START,
        {
          moves: ['e4', 'e5', 'Nf3', 'f6', 'Nxe5'],
          caption: 'White to move — why is e5 free?',
        },
      ),
      quiz(
        'Which capture is actually safe',
        'A black knight sits on d5. It is attacked by two of your pieces and defended by one. What happens when you capture?',
        [
          right(
            'You win a piece',
            'Two attackers, one defender: after the trade you keep the extra piece. That is the whole arithmetic of winning material.',
          ),
          wrong(
            'You lose material',
            'Count again: more attackers than defenders means the last attacker survives.',
          ),
          wrong(
            'It depends on the queen',
            'The count is already the answer. Two attackers versus one defender is a won capture wherever it happens.',
          ),
        ],
      ),
      drill(
        'The ladder finish',
        '7k/R7/8/8/8/8/8/1R5K w - - 0 1',
        ['Rb8#'],
        'Mate in one. Two rooks, black king trapped on the eighth rank.',
        'One rook takes the seventh, the other takes the eighth.',
        'Rb8 is mate: the a7 rook guards the whole seventh rank, so the king has no square and no shield.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'nb-hw2',
    n: 25,
    title: 'The three opening rules',
    subtitle: 'Center, development, king safety — in that order.',
    minutes: 9,
    concepts: ['center', 'development', 'castlingSafety'],
    steps: [
      text(
        'The book’s whole opening advice, in three lines',
        [
          'Rule one: claim the center with a pawn (e4 or d4). Central pawns open lines for your pieces.',
          'Rule two: bring out knights and bishops, one move each, toward the center. Do not move the same piece twice, do not rush the queen out.',
          'Rule three: castle inside the first ten moves. A king in the center is a target; a castled king starts the game already finished with its main job.',
        ],
        'Center, develop, castle — almost no opening plan needs more than this at first.',
      ),
      demo(
        'A model opening',
        [
          'Every move does one of the three jobs: e4 takes the center, Nf3 and Bc4 develop toward it, O-O tucks the king away by move four.',
          'This is also the start of the Italian Game — the book’s recommended first opening for White.',
        ],
        START,
        {
          moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'],
          caption: 'Castled on move 4, every piece has a job',
        },
      ),
      quiz(
        'Spot the rule-breaker',
        'Which first move violates all three rules at once?',
        [
          wrong('e4', 'That is the model citizen: center, opens the bishop and queen.'),
          right(
            'h4',
            'It claims nothing in the center, develops no piece, and even weakens the king’s own shelter before castling.',
          ),
          wrong('Nf3', 'A developing move toward the center — it follows the rules.'),
        ],
      ),
      playout(
        'Castle by move ten',
        'Play a real opening against the engine. Get both rules done: pieces developed AND your king castled within ten moves.',
        START,
        'w',
        'Castle your king within ten moves while developing at least two minor pieces.',
        1,
        'castle',
        10,
        'Castled and developed — that is a real opening, not a hope.',
        'The clock beat you. Next game: one move per piece, then tuck the king in.',
        'e4, Nf3, Bc4 or Bd3, then O-O. Four moves, all three rules.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'nb-hw3',
    n: 26,
    title: 'Stop the four-move trick',
    subtitle: 'The f7 bait, and how to refuse it like a book.',
    minutes: 8,
    concepts: ['development', 'kingSafety', 'defense'],
    steps: [
      text(
        'Why everyone tries it on you',
        [
          'At the start, f7 is the weakest square on the board: the king is its only defender, and the queen and a bishop can both point at it. So opponents try the two-move checkmate — queen out early, bishop behind, Qxf7#.',
          'Here is the secret the trappers do not know: the trick only works against someone who never develops. Every normal developing move makes the queen leave empty-handed.',
          'The rule: see the queen eyeing f7, and do not panic-block. Develop a piece that challenges or shields, and the attacking queen has to retreat while you gain time.',
        ],
        'The four-move checkmate is a bet that you will not develop. Take the bet.',
      ),
      demo(
        'g6 slams the door',
        [
          'White has played the bait: bishop on c4, queen on h5, both looking at f7. Black answers with the most natural developing move: g6.',
          'The pawn guards f7 AND opens the bishop’s diagonal. The queen is suddenly attacked and must run — three wasted tempi for White while Black develops.',
        ],
        START,
        {
          moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6'],
          caption: 'The queen is the piece that has to move',
        },
      ),
      quiz(
        'The move that loses',
        'Same setup: White queen on h5, bishop on c4, Black yet to move. Which reply actually loses the game?',
        [
          wrong(
            'g6',
            'It guards f7 and attacks the queen. This is the book’s answer.',
          ),
          right(
            'Nf6',
            'It attacks the queen, yes — but it stops guarding f7. Qxf7# ends the game on the spot: two attackers, zero defenders.',
          ),
          wrong(
            'Nc6',
            'Developing, and it does not hang anything — but it also does not kick the queen.',
          ),
        ],
      ),
      drill(
        'Chase the queen, gain the time',
        'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1KBNR b KQkq - 3 3',
        ['g6', 'Qf3', 'Nf6'],
        'The queen eyes f7. Refuse the bait and develop with tempo.',
        'A pawn move that guards f7 and attacks the queen.',
        'g6 guards f7 and hits the queen; when it retreats to f3 renewing the threat, Nf6 blocks, develops, and prepares to castle. Three developing moves versus none.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
]

// ---------------------------------------------------------------------------
// Beginner — the book's 800–1200 band: the tactical weapons everyone must own.
// ---------------------------------------------------------------------------

export const hwBeginner: Level[] = [
  {
    id: 'bg-hw1',
    n: 25,
    title: 'The royal fork',
    subtitle: 'One knight hop, two royal targets.',
    minutes: 9,
    concepts: ['fork', 'winningMaterial'],
    steps: [
      text(
        'The knight’s superpower',
        [
          'A knight attacks in a shape no other piece can block: over walls, around shields. Put a knight where it hits a king and a queen (or a king and a rook) at the same time, and one of them is yours.',
          'The check makes the fork unstoppable: the king must move, and the other target just falls. That is the royal fork.',
          'Book habit: whenever the enemy king and a loose piece stand a knight’s-move apart in your mind, hunt for the landing square.',
        ],
        'A checked king cannot defend anything. Forks that include a check always win.',
      ),
      demo(
        'The family fork',
        [
          'A stripped-down position so the shape is unmistakable: black king and rook on the back rank, white knight one hop from c7.',
          'Nc7+ is check to the king and a hand in the rook’s pocket at the same time. The king moves, the knight eats the rook.',
        ],
        'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
        {
          arrows: [{ from: 'b5', to: 'c7', color: 'green' }],
          marks: [{ square: 'c7', color: 'gold' }],
          caption: 'One square hits two targets',
        },
      ),
      quiz(
        'Finding the landing square',
        'The enemy king is on e8 and their rook sits on a8, with the queenside pawns gone. Which square forks king and rook?',
        [
          right(
            'c7',
            'From c7 the knight checks the king on e8 AND attacks the rook on a8. A checked king defends nothing — the rook falls.',
          ),
          wrong(
            'd6',
            'd6 is a nice outpost but it attacks no royal target: no check, and the king simply takes or moves.',
          ),
          wrong(
            'e5',
            'e5 attacks d7 and f7 — neither is the king. No check, no fork.',
          ),
        ],
      ),
      drill(
        'Collect the rook',
        'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
        ['Nc7+', 'Kd8', 'Nxa8'],
        'Win the rook with one check.',
        'Find the square that checks the king and touches the rook.',
        'Nc7+ forks king and rook; after the king steps aside, Nxa8 cashes in. This exact pattern wins countless club games.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'bg-hw2',
    n: 26,
    title: 'Pins and skewers',
    subtitle: 'Freeze the front piece, rob the one behind.',
    minutes: 10,
    concepts: ['pin', 'skewer', 'winningMaterial'],
    steps: [
      text(
        'Two names, one geometry',
        [
          'A pin: a line piece aims through an enemy piece at a target behind it. The front piece is frozen — moving it costs the thing behind. In the French Defense, ...Bb4 pins the c3 knight to the king on move three.',
          'A skewer is the reverse: the KING is in front. Check along the line, the king steps aside, and you take the valuable piece that was hiding behind it.',
          'Both are book staples because they win material without giving the opponent a single capture in return — the cheapest way to get ahead.',
        ],
        'Pinned pieces defend nothing. Skewered kings run and leave their wallet.',
      ),
      demo(
        'The pin arrives on move three',
        [
          'The French Defense: e4 e6 d4 d5 and now Nc3 — and Bb4 pins the knight against the white king.',
          'The knight on c3 suddenly cannot move without losing the king’s cover. White must spend a move breaking the pin (a3) or live with a frozen piece.',
        ],
        START,
        {
          moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'],
          arrows: [{ from: 'b4', to: 'e1', color: 'red' }],
          caption: 'Through the knight, at the king',
        },
      ),
      quiz(
        'Which is the skewer',
        'Your rook, the enemy king and the enemy queen all stand on the same file — king nearest to your rook. What do you win?',
        [
          right(
            'The queen, after the king moves',
            'That is the skewer: check first, king steps aside, the queen behind falls. Pins freeze, skewers collect.',
          ),
          wrong(
            'Nothing — the queen defends the king',
            'The queen cannot stand in front here. The geometry decides: king nearest is checked first.',
          ),
          wrong(
            'The king, if it moves',
            'Kings are never captured — the game ends by checkmate. The skewer’s prize is the piece behind.',
          ),
        ],
      ),
      drill(
        'Run the king, take the queen',
        '3q4/3k4/8/8/8/8/8/R3K3 w - - 0 1',
        ['Rd1+', 'Kc7', 'Rxd8'],
        'Check the king along the file and pick up what hides behind it.',
        'A check on the open file — the king is nearest, the queen behind.',
        'Rd1+ hits the king first; wherever it steps, Rxd8 collects the queen. A skewer is just a pin with the targets swapped.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'bg-hw3',
    n: 27,
    title: 'Back-rank reality check',
    subtitle: 'The mate every club player has suffered.',
    minutes: 8,
    concepts: ['mate', 'kingSafety'],
    steps: [
      text(
        'The row your king lives on',
        [
          'After castling, the king hides behind three pawns — and behind the king is the edge of the board. If those pawns never move, a single rook or queen on the eighth rank can end the game in one move.',
          'The defense is one word: luft. Pushing an h- or a-pawn one square gives the king a window. The cost is tiny; the insurance is permanent.',
          'The attack side: before you offer a trade of rooks, count the eighth rank. If the enemy king has no window and no defender on the back rank, the mate offer is not a sacrifice — it is a delivery.',
        ],
        'Make luft once, early. Check their back rank every single move.',
      ),
      demo(
        'One rook, one rank, over',
        [
          'Both kings castled, both pawn chains untouched. White’s rook swings to d8 — and the game ends: the king’s three escape squares are blocked by his own pawns.',
          'This is the position that decides more beginner games than any opening trap.',
        ],
        '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
        {
          moves: ['Rd8#'],
          marks: [{ square: 'g8', color: 'red' }],
          caption: 'No window, no defense, no game',
        },
      ),
      quiz(
        'When to make luft',
        'You castled kingside. When is h3 (or h6) worth a tempo?',
        [
          right(
            'Early, when the eighth rank is still quiet',
            'One tempo now buys a permanent escape window. Waiting until the rook already lands on your back rank is a tempo too late.',
          ),
          wrong(
            'Only after the enemy rook arrives',
            'By then the check is on the board. Luft is prevention, not a response.',
          ),
          wrong(
            'Never — it weakens the king',
            'A pawn on h3 barely weakens anything; a king with no window loses entire games.',
          ),
        ],
      ),
      drill(
        'Deliver it yourself',
        '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
        ['Re8#'],
        'White to move: the enemy king has no window and no guard on the back rank.',
        'A rook check on the eighth rank.',
        'Re8 is mate — the pawns that were supposed to be the king’s shield are its tombstone.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
]

// ---------------------------------------------------------------------------
// Intermediate — the book's 1200–1600 band: discovered play, removing the
// defender, king activity, pawn structure.
// ---------------------------------------------------------------------------

export const hwIntermediate: Level[] = [
  {
    id: 'int-hw1',
    n: 26,
    title: 'The discovered attack',
    subtitle: 'One piece moves, two threats appear.',
    minutes: 10,
    concepts: ['discoveredAttack', 'doubleAttack', 'initiative'],
    steps: [
      text(
        'Two attackers pretending to be one',
        [
          'Line up your rook or bishop behind your own knight or pawn, both looking down the same line at the enemy king. The front piece blocks the shot — until it moves.',
          'The front piece moves and does something ELSE: takes a piece, attacks a queen, plants a fork. The opponent is hit by two threats at once and can only parry one.',
          'The book calls this one of the highest-value motifs in club play because it needs no sacrifice: the battery was legal, quiet, and sitting there the whole time.',
        ],
        'Build batteries on lines that end at the enemy king — then spend the front piece twice.',
      ),
      demo(
        'The knight wears the rook’s blindfold',
        [
          'White’s rook on e1 and knight on e4 form a battery against the black king on e8. As long as the knight stands still, nothing happens.',
          'Nd6+ is the double blow: discovered check from the rook AND the knight now attacks c8. The king moves, the knight eats the queen.',
        ],
        '2q1k3/8/8/8/4N3/8/8/4RK2 w - - 0 1',
        {
          moves: ['Nd6+', 'Kd7', 'Nxc8'],
          arrows: [{ from: 'e1', to: 'e8', color: 'red' }],
          caption: 'The rook shoots through the knight',
        },
      ),
      quiz(
        'Building the battery',
        'You want a discovered attack against the enemy king on e8. Which setup works?',
        [
          right(
            'Your bishop behind your knight, both aimed at e8',
            'Correct battery: the knight blocks a real threat, so moving it releases a check plus a second threat. Two for one.',
          ),
          wrong(
            'Your rook behind YOUR OWN king',
            'The battery must point at the enemy. Pointing your rook through your own king is just how pins against you are born.',
          ),
          wrong(
            'Two rooks stacked behind each other, aimed at a pawn',
            'A battery against a pawn wins a pawn at best, and stacked rooks are one pin away from disaster. Aim batteries at kings.',
          ),
        ],
      ),
      drill(
        'Fire both barrels',
        '2q1k3/8/8/8/4N3/8/8/4RK2 w - - 0 1',
        ['Nd6+', 'Kd7', 'Nxc8'],
        'Win the queen with one knight move.',
        'The knight steps aside with a check of its own.',
        'Nd6+ is discovered check and a queen fork in one move; after Kd7, Nxc8 collects. Notice the king had to walk INTO the knight’s range — the battery forced it.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'int-hw2',
    n: 27,
    title: 'Kick the pinner',
    subtitle: 'What to do when your piece is frozen.',
    minutes: 9,
    concepts: ['pin', 'defense', 'pawnStructure'],
    steps: [
      text(
        'The guardian can be evicted',
        [
          'A pin is only as strong as the piece doing the pinning — and that piece can be attacked. The standard cure is a pawn kick: a6 against Bb5, a3 against Bb4, h3 against Bg4.',
          'The arithmetic favors you: pawns attacking bishops cost nothing. The pinning piece must retreat or trade itself for the pawn — either way, the frozen piece is free and the pin wasted a move.',
          'The book’s warning: pins against your king’s cover deserve IMMEDIATE attention, but pins against other pieces can often simply be ignored while you develop around them.',
        ],
        'Pin? Ask first: does it really hurt? If yes, kick the pinner with a pawn.',
      ),
      demo(
        'a6 — the cheapest move on the board',
        [
          'The Spanish bishop has pinned nothing yet but is a hair from doing so. Black’s a6 attacks it with a pawn.',
          'If White retreats, Black gained a tempo for free. If White trades on c6, Black recaptures with the b-pawn and the center pawn structure fights for the half-open b-file.',
        ],
        'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        {
          moves: ['a6', 'Bxc6', 'bxc6'],
          marks: [{ square: 'a6', color: 'green' }],
          caption: 'A pawn asks the bishop to leave',
        },
      ),
      quiz(
        'Which pin deserves the kick',
        'You can spend one move. A bishop pins your knight against your QUEEN far from the king; meanwhile the enemy is starting a kingside attack. Where does the kick go?',
        [
          right(
            'The kingside — the pin can wait',
            'The book’s triage: material pins rarely justify abandoning an attack on your king. Defend the king first; the frozen knight is a nuisance, not a loss.',
          ),
          wrong(
            'a3, always kick every pin',
            'Moves are not free. Chasing a pin that costs you nothing while your king burns is how attacks succeed.',
          ),
          wrong(
            'Move the knight anyway — pins are a myth',
            'Moving a pinned piece against a queen loses the queen. Myths do not do that; arithmetic does.',
          ),
        ],
      ),
      drill(
        'Evict the bishop',
        'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        ['a6', 'Bxc6', 'bxc6'],
        'Black to move: chase the bishop off the pinning diagonal.',
        'A pawn attack on the pinning piece.',
        'a6 hits the bishop; after the trade, bxc6 recaptures and Black’s queenside majority lives. The pin is gone for the price of one pawn move.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'int-hw3',
    n: 28,
    title: 'The king is a fighter',
    subtitle: 'Endgames are won by the bravest king.',
    minutes: 10,
    concepts: ['kingActivity', 'opposition', 'endgame'],
    steps: [
      text(
        'Take the king out of the box',
        [
          'In the middlegame the king hides. The moment queens leave the board, the truth flips: the king is the strongest piece on the board, and the player whose king walks to the center first usually wins the endgame.',
          'The key duel is the opposition: when the two kings face each other with one square between, the side whose turn it is must give ground. Winning pawn endings is mostly choreographing who holds that opposition.',
          'The book’s endgame chapters repeat one sentence: activate the king FIRST, push pawns SECOND. A pawn race without the king in front is a coin flip; with the king, it is arithmetic.',
        ],
        'Queens off? March the king to the center before you touch a pawn.',
      ),
      demo(
        'The wall of faces',
        [
          'The kings face off on the e-file. It is Black’s move — so Black holds the opposition, and the white king must step aside.',
          'Every pawn ending is a series of these face-offs. Count them: whoever wins the last one, when the pawn push comes, promotes.',
        ],
        '8/8/8/4k3/8/8/4K3/8 b - - 0 1',
        {
          arrows: [{ from: 'e5', to: 'e2', color: 'gray' }],
          marks: [
            { square: 'e5', color: 'gold' },
            { square: 'e2', color: 'gray' },
          ],
          caption: 'Black to move: White must yield ground',
        },
      ),
      quiz(
        'The promotion race',
        'Kings square off, one pawn each on the kingside, all minor pieces gone. Which factor decides the race first?',
        [
          right(
            'Whose king stands in front of (or nearer to) the pawns',
            'King position outranks every other factor in pawn endings. A king one square closer is worth more than an extra tempo of pawn pushing.',
          ),
          wrong(
            'Whose pawns are one rank further advanced',
            'Pawns without the king in front get eaten or outrun. The book’s order is king first, pawns second.',
          ),
          wrong(
            'Whose turn it is to move the pawns',
            'Tempo matters, but only after the kings are placed. Wrong king, right tempo still loses.',
          ),
        ],
      ),
      playout(
        'Walk the king in',
        'King and pawn versus king — the most important endgame in the book. Promote the pawn (finish with three or more points of material) using your king, not just the pawn.',
        '4k3/8/5K2/4P3/8/8/8/8 w - - 0 1',
        'w',
        'Promote the pawn: end with a queen against bare king.',
        1,
        'material',
        20,
        'Promoted — this exact king-and-pawn choreography is what decides level games.',
        'The bare king held you. March the king in front of the pawn first, then push.',
        'e6 first, then support the pawn with the king from the side — never let the pawn walk alone.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'int-hw4',
    n: 29,
    title: 'Pawns are the soul of chess',
    subtitle: 'Pawn moves are the only ones you cannot take back.',
    minutes: 9,
    concepts: ['pawnStructure', 'outposts', 'tradeDecisions'],
    steps: [
      text(
        'The permanent moves',
        [
          'Every piece can retreat; a pawn cannot. That is why the book spends whole chapters on which pawn moves to avoid: doubled pawns (two on one file, they block each other), isolated pawns (no pawn neighbor can ever defend them), and holes (squares no pawn can ever cover again — knight hotels for the enemy).',
          'The practical rule: before a pawn move, imagine the board AFTER your best pieces are traded off. If a hole or an isolated pawn is guaranteed forever, the move needs a very good reason.',
          'This is also why trading is a structure decision: accepting doubled pawns for an open file is often right; accepting them for nothing is the classic 1200 mistake.',
        ],
        'Pieces can go back. Pawns sign contracts in ink.',
      ),
      demo(
        'Reading the structure',
        [
          'Black’s d5 pawn has no neighbors on c5 or e5: it is isolated, and no black pawn can ever defend it again. White’s d4 is its lifelong enemy.',
          'Marked for life: the isolated d5 needs a piece bodyguard forever, and the squares in front of it become battlegrounds.',
        ],
        'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3',
        {
          marks: [
            { square: 'd5', color: 'red' },
            { square: 'd4', color: 'green' },
          ],
          caption: 'The isolated pawn and its lifelong enemy',
        },
      ),
      quiz(
        'The irreversible mistake',
        'You can win a knight for a bishop — but the recapture doubles your pawns in a closed position with no open file to show for it. What is the book’s verdict?',
        [
          right(
            'Decline — doubled pawns in a closed position are forever',
            'No file, no diagonal, no compensation: you would rent a small material gain and pay rent forever. Structures outlive exchanges.',
          ),
          wrong(
            'Accept — material is material',
            'Below 1600 the count usually rules, but here the count is temporary and the structure is not. This is exactly the trade the book teaches you to refuse.',
          ),
          wrong(
            'Accept and immediately push both doubled pawns',
            'Pushing doubled pawns opens lines for BOTH sides and leaves the back one weak. It treats the symptom by creating two more.',
          ),
        ],
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
]

// ---------------------------------------------------------------------------
// Advanced — the book's 1600–2000 band: outposts, the bishop pair,
// candidate-move discipline, attacking the weak king.
// ---------------------------------------------------------------------------

export const hwAdvanced: Level[] = [
  {
    id: 'adv-hw1',
    n: 24,
    title: 'Open files and outposts',
    subtitle: 'Real estate rooks and knights never have to leave.',
    minutes: 10,
    concepts: ['openFiles', 'outposts', 'pieceActivity'],
    steps: [
      text(
        'Two squares that decide middlegames',
        [
          'An open file (no pawns on it) belongs to whoever puts a ROOK on it first — and a rook that rides it to the seventh rank is worth a piece in practical play.',
          'An outpost: a square in enemy territory that no enemy pawn can ever attack. A knight planted there cannot be kicked, only traded — and trading it costs the opponent position.',
          'The book’s pairing is deliberate: the file is the road, the outpost is the fortress on it. Play for both from the same pawn moves.',
        ],
        'Rooks want open files; knights want squares no pawn can evict.',
      ),
      demo(
        'A knight with a lifetime lease',
        [
          'White’s d-pawn guards e5; Black’s f-pawn is already traded, so nothing can ever attack e5 again. The knight lands there and simply cannot be bothered.',
          'From the outpost the knight eyes the queenside and kingside diagonals, covers the d-file, and costs Black a piece just to evict.',
        ],
        '2r2rk1/pp3ppp/8/8/3P4/5N2/PP3PPP/3R2KR w - - 0 1',
        {
          marks: [
            { square: 'e5', color: 'gold' },
            { square: 'd4', color: 'green' },
          ],
          caption: 'd4 is the lease, e5 is the fortress',
        },
      ),
      quiz(
        'What makes it an outpost',
        'Which square qualifies as a true outpost for your knight?',
        [
          right(
            'A square in enemy territory no enemy pawn can attack',
            'That is the whole definition — and it usually exists because of a pawn trade YOU engineered. Outposts are built, not found.',
          ),
          wrong(
            'Any central square your knight can reach',
            'Central squares the enemy pawn can kick are motels, not fortresses. The knight arrives, the pawn arrives, the knight leaves.',
          ),
          wrong(
            'The square in front of the enemy king',
            'Romantic, but the king’s own pawns attack everything nearby. Outposts live where pawns are GONE.',
          ),
        ],
      ),
      drill(
        'Claim the fortress',
        '2r2rk1/pp3ppp/8/8/3P4/5N2/PP3PPP/3R2KR w - - 0 1',
        ['Ne5'],
        'Plant the knight where it can never be kicked.',
        'The d-pawn guards it; the f-pawn is gone.',
        'Ne5 is the book’s picture of an outpost: protected by your own pawn, unattackable by theirs. From here the knight dominates the position for free.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'adv-hw2',
    n: 25,
    title: 'The bishop pair',
    subtitle: 'Two long-range pieces beat one of each — if you keep them.',
    minutes: 9,
    concepts: ['bishopPair', 'tradeDecisions', 'pieceActivity'],
    steps: [
      text(
        'A small edge that compounds',
        [
          'Two bishops cover both colors and cut across every defense at once. Give one up and the remaining bishop can be blocked forever by a single pawn chain.',
          'The book’s rule of thumb: the pair is worth about half a pawn in open positions — so trading a bishop for a knight needs a concrete reason (winning material, hitting the king, fixing a weakness). Position alone rarely pays for it.',
          'The flip side, same coin: when YOUR opponent owns the pair, close the position or trade one of the bishops off. Half a pawn either way.',
        ],
        'Keep the pair in open positions; break it when the opponent has it.',
      ),
      demo(
        'Both colors, one team',
        [
          'White owns both bishops; Black traded one off earlier. The light-squared bishop eyes the long diagonals, the dark-squared one the dark squares — Black’s knights can only defend one point at a time.',
          'This is why the pair grows stronger as pawns come off: more open diagonals, fewer blockers.',
        ],
        'r1bqk2r/ppp2ppp/2n5/3pp3/2B1P3/2N5/PPPP1PPP/R1B1K2R w KQkq - 0 8',
        {
          marks: [
            { square: 'c4', color: 'gold' },
            { square: 'c1', color: 'gold' },
          ],
          caption: 'Two colors, one problem for Black',
        },
      ),
      quiz(
        'The trade that loses half a pawn',
        'Open position, you own the bishop pair. Your opponent offers knight-for-bishop on equal terms. Best verdict?',
        [
          right(
            'Decline — keep the pair',
            'In an open position the pair is worth close to half a pawn. Equal material after the trade is a small win for them.',
          ),
          wrong(
            'Accept — an even trade is never wrong',
            'Even trades are not neutral: they shift static advantages. Handing over the pair IS giving up half a pawn.',
          ),
          wrong(
            'Accept — bishops are worse in the endgame',
            'Backwards: with pawns off, the pair gets STRONGER. It is blocked middlegames where a single bishop suffers.',
          ),
        ],
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'adv-hw3',
    n: 26,
    title: 'Candidate moves, not vibes',
    subtitle: 'Checks, captures, threats — in that order.',
    minutes: 11,
    concepts: ['calculation', 'tempo'],
    steps: [
      text(
        'How strong players actually calculate',
        [
          'They do not see "everything". They first LIST the candidate moves — usually two or three — and the list starts with the forcing ones: every check, every capture, every direct threat. Quiet moves come last, not first.',
          'Each candidate gets calculated to a QUIET position — a spot where the forcing sequence ends and you can judge who likes the board. No candidate is judged after one move.',
          'The book’s discipline: only when both sides have no forcing moves left do you compare the pictures. This is what "calculating deep" actually is — short forcing lines, cleanly compared, not one 12-move fantasy.',
        ],
        'List checks, captures, threats. Walk each to a quiet square. Choose the best picture.',
      ),
      quiz(
        'First glance order',
        'New position on your clock. What do you scan FIRST?',
        [
          right(
            'Every check and capture for both sides',
            'Forcing moves shrink the tree: they are few, concrete, and end arguments. The book’s method starts there every single move.',
          ),
          wrong(
            'Your long-term plan',
            'Plans matter — after the forcing scan. A plan calculated while a mate-in-two sits on the board is how games end.',
          ),
          wrong(
            'The move you played in a similar game once',
            'Pattern-matching is fuel, not steering. This position has new forcing facts; check them before memories.',
          ),
        ],
      ),
      drill(
        'The forcing scan pays off',
        '6k1/5ppp/8/3Q4/8/8/5PPP/4R1K1 w - - 0 1',
        ['Re8#'],
        'Mate in one — and the checks-first habit finds it instantly.',
        'Scan checks first: the rook and the queen both look at the eighth rank.',
        'Re8 is mate — the queen on d5 covers the escape squares. When you scan forcing moves first, mate-in-one stops being luck.',
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
  {
    id: 'adv-hw4',
    n: 27,
    title: 'Attack with your whole team',
    subtitle: 'Légal’s mate: every attacker counts, every defender counts.',
    minutes: 12,
    concepts: ['mate', 'initiative', 'sacrifice'],
    steps: [
      text(
        'The attacker’s arithmetic',
        [
          'A kingside attack works when two numbers are true: you have MORE attackers than defenders around the king, and the roads (open lines) are already open. Sacrifices buy the road — never the arithmetic.',
          'The book’s checklist before any attack: which pieces am I bringing? Which pieces does the defender have? What lines am I opening? If a number is missing, develop first.',
          'This level’s game is the oldest lesson in attacking arithmetic: Légal’s mate, where a knight sacrifice works ONLY because three pieces point at f7 and the defender is missing one move of development.',
        ],
        'Count attackers and defenders around the king. Only attack when the count is yours.',
      ),
      gtmStep(
        'Guess the oldest trap in the book',
        [
          'White develops; Black pins the knight and then plays g6, dreaming of winning the queen with Bxd1. White burns the bridge: Nxe5!, ignoring the queen.',
          'Play White’s continuation at each step. Count attackers on f7 before you answer.',
        ],
        'The famous Légal mate, Paris, 1750 (traditional attribution)',
        START,
        ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6'],
        [
          guess('Nxe5!', 'The attack count is ready: bishop c4, knight c3 and this knight all point into the kingside. The queen is bait.', {
            reply: 'Bxd1',
          }),
          guess('Bxf7+', 'First hammer: check, and the bishop cannot be captured — the e5 knight now guards f7.', {
            reply: 'Ke7',
          }),
          guess('Nd5#', 'The third attacker arrives at the square the pinning bishop left empty. Mate with two pieces down — because the count was never close.', {}),
        ],
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
]

// ---------------------------------------------------------------------------
// Master — the book's 2000+ chapters: prophylaxis and the initiative.
// ---------------------------------------------------------------------------

export const hwMaster: Level[] = [
  {
    id: 'ms-hw1',
    n: 22,
    title: 'Prophylaxis: play their side first',
    subtitle: 'The strongest move often answers a question nobody asked yet.',
    minutes: 10,
    concepts: ['prophylaxis', 'calculation', 'kingSafety'],
    steps: [
      text(
        'Two plans, one move',
        [
          'At master level, every move is judged twice: what does it do for ME, and what does it stop for THEM. Prophylaxis is the second question made a habit — spotting the opponent’s plan while it is still cheap to block.',
          'The tell is always a target: a square they are building toward (a hole, an open file, your king), a piece they are slowly transferring. Cover the square or challenge the transfer one move before it matters.',
          'The book’s honest framing: prophylaxis feels passive but is not — every covered square forces the opponent to invent a second plan, and inventing plans costs the resource they never get back: tempo.',
        ],
        'Before your plan, spend one second on theirs. The cheapest defense is one move early.',
      ),
      quiz(
        'The move before the plan',
        'You are ready to start a kingside pawn storm. Meanwhile the enemy knight has spent two moves heading for the beautiful d5 hole in your camp. Best move?',
        [
          right(
            'Cover or contest d5 first',
            'One prophylactic move kills their whole plan while yours only waits. After the hole is guarded, the storm starts from a position where nothing answers back.',
          ),
          wrong(
            'Storm first — your attack is faster',
            'Attacks that ignore a knight landing in the center are how attacks get countered. The book: finish the opponent’s strongest idea first, then attack.',
          ),
          wrong(
            'Ignore it — d5 is far from my king',
            'Prophylaxis is not only about mate threats. A knight on d5 anchors every future break; some squares are worth more than pawns.',
          ),
        ],
      ),
      text(
        'Practice it',
        [
          'On your next five games, before each move say the opponent’s most annoying idea out loud. If your move does not answer it, your move needs a reason.',
          BOOK,
        ],
      ),
    ],
  },
  {
    id: 'ms-hw2',
    n: 23,
    title: 'Initiative: keep asking questions',
    subtitle: 'The player making threats chooses the topics.',
    minutes: 11,
    concepts: ['initiative', 'tempo', 'development'],
    steps: [
      text(
        'Threats are time',
        [
          'The initiative is simple to define and brutal to hold: it is the state where every one of your moves creates a problem and every one of theirs solves one. While it holds, their plans do not exist.',
          'The book’s rule for keeping it: every move must ask a question. A quiet developing move can still ask one — develop AND threaten, develop AND open a line. Pure waiting moves hand the microphone back.',
          'And the warning that belongs with it: initiative is not recklessness. A threat that loses material on the reply was never a threat — the forcing-move scan from your earlier lessons is what separates an initiative from a donation.',
        ],
        'Make every move a question. A threat that loses material on the reply was never a threat.',
      ),
      demo(
        'Development with a question attached',
        [
          'The Italian with an early Bb4 pin against the c3 knight: after Nc3 Bb4, White castles — developing move, king safety, AND now the pinning bishop stares at a knight guarded by a pawn that can kick it (a3).',
          'Watch who spends the next moves retreating while White’s rook claims the center file. That swing is the initiative made visible.',
        ],
        'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        {
          moves: ['Nc3', 'Bb4', 'O-O'],
          caption: 'Every move developed and asked a question',
        },
      ),
      quiz(
        'Holding the microphone',
        'You just won a pawn with a check. The opponent’s king walks to safety. Which follow-up keeps the initiative?',
        [
          right(
            'The forcing move that renews a real threat',
            'Initiative survives on questions. One more check, one more capture, one more threat — each reply is forced while your pieces keep arriving.',
          ),
          wrong(
            'Castle quietly and consolidate the pawn',
            'Consolidating is what the DEFENDER does. If the forcing scan offers a real threat, the initiative pays better than the pawn insurance.',
          ),
          wrong(
            'Offer a trade of queens to simplify',
            'Trades are the defender’s best friend: every pair coming off shrinks your attacking surplus. Simplify when AHEAD and under attack — not while holding the initiative.',
          ),
        ],
      ),
      text('Where this comes from', [BOOK]),
    ],
  },
]

// ---------------------------------------------------------------------------
// Grandmaster — the book's closing chapter: how to train.
// ---------------------------------------------------------------------------

export const hwGrandmaster: Level[] = [
  {
    id: 'gm-hw1',
    n: 21,
    title: 'Train like the book says',
    subtitle: 'Analyze yourself, fix one thing, repeat.',
    minutes: 9,
    concepts: ['calculation', 'defense', 'tradeDecisions'],
    steps: [
      text(
        'The loop that actually raises rating',
        [
          'Play long games with real thinking time. Blitz measures recognition; improvement needs calculation — the muscle built only under a clock that lets you use the method from these lessons.',
          'Then the part everyone skips: review your OWN games, and do it without the engine first. Annotate what you thought during the game, find the move where the evaluation flipped, and name the reason in one sentence: missed fork, lazy king, uncounted attack.',
          'Keep the loop honest: one weakness per week, not five. The book’s closing promise is that rating follows the loop, not the other way around — and every tool in this app exists to run it: games library for the losses, analysis for the flip move, drills for the named weakness.',
        ],
        'Play long, review honestly, name the flip move, fix one thing. Repeat.',
      ),
      quiz(
        'The review that improves',
        'You lost a long game. What is the highest-value first pass?',
        [
          right(
            'Walk it yourself, find where it turned, name the reason',
            'Your own annotations force the calculation muscle and produce ONE fixable weakness. Engines are for checking the walk, not replacing it.',
          ),
          wrong(
            'Open the engine at move one and read evaluations',
            'Eval-bar watching feels like study and trains nothing. The flip move is a moment, not a graph.',
          ),
          wrong(
            'Queue ten blitz games to bounce back',
            'Bouncing back repeats the same weakness ten times at speed. The loop loses to the queue every time.',
          ),
        ],
      ),
      text(
        'Where this comes from',
        [
          'Your last step in the course: everything before this level gave you the positions; this level gave you the loop. Run it.',
          BOOK,
        ],
      ),
    ],
  },
]

// Tier attachment map — consumed by the tier files so the book levels ship
// inside the existing chapters at the matching rating band.
export const HOW_TO_WIN_LEVELS: Record<Tier['id'], Level[]> = {
  newbie: hwNewbie,
  beginner: hwBeginner,
  intermediate: hwIntermediate,
  advanced: hwAdvanced,
  master: hwMaster,
  grandmaster: hwGrandmaster,
}
