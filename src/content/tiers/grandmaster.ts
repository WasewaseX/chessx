// Tier 6: Grandmaster. Judgment at full depth: zugzwang, fortresses,
// exchange sacrifices, preparation, and the capstone game.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout, gtmStep, guess } from '../kit'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const grandmaster: Tier = {
  id: 'grandmaster',
  n: 6,
  title: 'Grandmaster',
  tagline: 'Zugzwang, fortresses, exchange sacrifices, and the capstone.',
  color: '#b08a2e',
  levels: [
    {
      id: 'gm-01',
      n: 1,
      title: 'Calculation trees',
      subtitle: 'Prune branches, finish lines, trust only the end.',
      minutes: 12,
      concepts: ['calculation', 'sacrifice', 'mate'],
      steps: [
        quiz('Retrieval first', 'From the Master tier: what is the single habit that separates master play from club play?', [
          right('Asking what the opponent wants before every move', 'Prophylaxis first. Tactics serve the plan.'),
          wrong('Longer opening memorization', 'Lines end. Judgment does not.'),
          wrong('Faster play', 'Speed without accuracy donates material.'),
        ]),
        text(
          'Depth with discipline',
          [
            'Grandmaster calculation is not seeing twenty moves: it is seeing THREE branches fully. Prune early: if a candidate loses material after the opponent\u2019s best reply, drop it and move on. Never calculate the second-best reply in depth.',
            'Finish lines in your head. A combination calculated to move two and improvised from there is where titles are lost. The board hides nothing; memory hides everything. Train by replaying finished lines with your eyes closed.',
          ],
          'Three branches, fully finished, beat twenty half-calculated ideas.',
        ),
        demo(
          'The full tree',
          ['One sacrifice, one forced reply, one mate. Before moving, a master has already seen all three positions and verified the last one.'],
          'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1',
          {
            marks: [
              { square: 'd8', color: 'green' },
              { square: 'e8', color: 'green' },
            ],
            caption: 'Qd8+, Bxd8, Re8: seen before played',
          },
        ),
        drill('Finish the tree', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Calculate to the mate, then play the line', 'The bishop is the only defender of d8. After he takes, the e-file is empty.', 'Three positions, all verified. The line ends in mate: calculation complete.'),
        quiz('Pruning rule', 'A candidate move looks brilliant but loses a pawn to the opponent\u2019s BEST reply. What does the master do?', [
          right('Drops it and evaluates the next candidate', 'Best replies only. Hope is not a branch of the tree.'),
          wrong('Calculates the opponent\u2019s likely (weaker) reply', 'The tree must survive the strongest attack. Everything else is decoration.'),
          wrong('Plays it for complications', 'Complications favor the prepared mind, not the hopeful one.'),
        ]),
        quiz('Training the tree', 'How do you train calculation depth away from the board?', [
          right('Replay finished lines with your eyes closed until the positions stay solid', 'Visualization is a muscle. Finished lines are the weights.'),
          wrong('Solve thousands of one-move mates', 'One-move reps train the scan. Depth needs line-holding.'),
          wrong('Trust the board: glance at every branch there', 'The board is a crutch. Games are played in the head.'),
        ]),
        quiz('Pruning discipline', 'You calculated a pretty 7-move line for one candidate and it works. Two other candidates were never looked at. What is the error?', [
          right('Verification bias: a working line does not make this candidate the best move', 'The best move is the best of ALL candidates, not the first one that survived.'), 
          wrong('None: a working line means the move is playable', 'Playable is not optimal. Strong players finish the scan before committing.'), 
          wrong('You should calculate all 40 moves equally deep', 'Prune by pattern to a shortlist first, then calculate the shortlist honestly. Skipping the shortlist is the crime.'), 
        ]),
      ],
    },
    {
      id: 'gm-02',
      n: 2,
      title: 'Resources in worse positions',
      subtitle: 'Activity, counterplay, and the perpetual threat.',
      minutes: 12,
      concepts: ['defense', 'pieceActivity'],
      steps: [
        quiz('Retrieval first', 'What is the right way to train deep calculation?', [
          right('Hold finished lines in your head, eyes closed, until they stop dissolving', 'Visualization holds the tree together under time pressure.'),
          wrong('Memorize famous combinations from books', 'Recognition helps. The TREE must be built live, branch by branch.'),
          wrong('Let the engine show you the branches', 'Engine lines are answers. Calculation is the question-asking skill.'),
        ]),
        text(
          'Compensation is a resource',
          [
            'A worse position is not a lost position until the opponent can convert without interruption. Resources: an exposed enemy king, a far-advanced passer, an open file, a perpetual threat. Your entire defense is built from whatever concrete asset remains.',
            'The skill: identify your ONE asset in the position and ride it relentlessly. A single active rook checking forever can save ten "lost" positions; a h-passer on h6 distracts a whole army.',
          ],
          'Find the one thing that still bites. Ride it.',
        ),
        demo('The eternal checks', ['Material means nothing while the queen checks along every rank. The king walks down the board and meets the same queen every step.'], '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', {
          moves: ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'],
          caption: 'The resource that never runs out',
        }),
        drill('Ride the resource', '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'], 'Prove the draw with checks', 'Rank after rank, one file to the left each time.', 'The perpetual is a resource, not a habit. Here it is the whole point.'),
        quiz('Resource hunt', 'You are two pawns down with one far-advanced passed pawn on h6. The defense of the opponent is solid. Your best practical plan?', [
          right('Push the pawn: it forces the enemy pieces to babysit it, freeing squares elsewhere', 'The passer is a magnet. Magnets create weaknesses elsewhere.'),
          wrong('Trade into a pure pawn endgame', 'Two pawns down in a pawn ending is resignable.'),
          wrong('Wait passively behind your walls', 'Passivity converts a worse position into a lost one.'),
        ]),
        quiz('The one asset', 'What is the first step of defending any worse position?', [
          right('Identify your single concrete asset and build the defense around it', 'A passer, an open file, a perpetual: one real asset beats five vague hopes.'),
          wrong('Defend everything equally', 'Equal defense defends nothing. Resources need a focal point.'),
          wrong('Look for cheap traps', 'Traps are one-move assets. The position needs a durable one.'),
        ]),
        quiz('The perpetual checklist', 'Down material and under attack, what must you actively hunt every move?', [
          right('Any square your pieces can hit from that forces the attacker to stop and think', 'Counterplay is oxygen. Checks, threats and passed pawns make the attacker defend instead of push.'), 
          wrong('The fastest square to hide the king', 'Hiding alone loses slowly. Active defense actually saves positions.'), 
          wrong('Trading every piece you can', 'Trades reduce counterplay first. The weaker side usually wants pieces ON.'), 
        ]),
      ],
    },
    {
      id: 'gm-03',
      n: 3,
      title: 'Zugzwang',
      subtitle: 'The position where any move loses.',
      minutes: 12,
      concepts: ['zugzwang', 'endgame', 'opposition'],
      steps: [
        quiz('Retrieval first', 'How do you defend a materially worse position?', [
          right('Find your one concrete asset and ride it relentlessly', 'One real resource is a defense. Five vague hopes are decoration.'),
          wrong('Trade everything and hope', 'Hope is not a resource. Concrete assets are.'),
          wrong('Attack the enemy king immediately', 'Attacks need assets. Find yours first.'),
        ]),
        text(
          'The obligation to move',
          [
            'Zugzwang: every legal move makes your position worse. It barely exists in middlegames (there is always a waiting move) and rules pawn endings, where kings and pawns have no spare tempi.',
            'Corresponding squares: in the tightest king-and-pawn duels, each square of one king\u2019s route has exactly one matching square for the other. Stand on the wrong one and you lose; arrive on the right one first and the opponent inherits the curse of moving.',
          ],
          'In pawn endings, having no useful move is the losing side\u2019s whole story.',
        ),
        demo(
          'The turn decides',
          [
            'White has the advanced pawn and the king right beside it. It is Black\u2019s move, and the geometry seals every reply: d8 and b8 are covered by the pawn, d7 and d6 by the white king, and every king step on the kingside lets White take the key square first.',
            'In pawn endings the turn IS the position. The same army with the other side to move plays a completely different duel: that is why strong players map corresponding squares before every king step.',
          ],
          '8/2P1k3/2K5/8/8/8/8/8 b - - 0 1',
          {
            marks: [
              { square: 'd8', color: 'red' },
              { square: 'd7', color: 'yellow' },
            ],
            caption: 'Red: sealed by the pawn. Yellow: sealed by the king.',
          },
        ),
        quiz('Zugzwang definition', 'Zugzwang exists most often in which phase?', [
          right('Pawn endings, where no piece has spare tempi', 'Kings and pawns cannot pass a turn. That is what makes it work.'),
          wrong('Open middlegames', 'Too many pieces: there is always another waiting move.'),
          wrong('Queen endgames', 'Queens always have another check. Zugzwang needs immobility.'),
        ]),
        quiz('Corresponding squares', 'Two kings duel over the squares in front of a pawn. What decides the winner?', [
          right('Who arrives on the key corresponding square with the OTHER side to move', 'The curse of moving is the weapon. Take the right square with him to play.'),
          wrong('Who is closer to the pawn', 'Distance is a detail. The correspondence is the law.'),
          wrong('Whoever has the move at the start', 'The move is a burden in zugzwang, not a gift.'),
        ]),
        quiz('The spare tempo', 'What decides most zugzwang races between kings?', [
          right('Whoever holds a spare tempo: a useful pawn move saved for exactly this moment', 'One waiting pawn move flips the correspondence. Spend them carelessly and the duel is lost.'),
          wrong('Whoever has more material', 'Material cannot move itself. Tempi decide duels.'),
          wrong('Coincidence: zugzwang is random', 'Corresponding squares are pure geometry. Nothing random.'),
        ]),
        drill('Take the key square', '6k1/8/5K2/6P1/8/8/8/8 w - - 0 1', ['Kg6'], 'The duel hangs on one corresponding square. Step there', 'The king goes where the pawn advances behind him and the enemy king cannot slip past.', 'Kg6. The king has taken the key square ahead of the pawn, and from here every race is won. The rule, not the calculation.'),
      ],
    },
    {
      id: 'gm-04',
      n: 4,
      title: 'Building and breaking fortresses',
      subtitle: 'The wall exists before the siege.',
      minutes: 12,
      concepts: ['defense', 'endgame'],
      steps: [
        quiz('Retrieval first', 'What decides zugzwang duels between kings?', [
          right('Corresponding squares and spare tempi', 'Arrive on the right square with him to move. One spare pawn move flips everything.'),
          wrong('Raw calculation depth', 'The geometry is small enough to map by hand. Depth is not the tool.'),
          wrong('Piece activity', 'There are barely any pieces. Kings and tempi rule.'),
        ]),
        text(
          'Both sides of the wall',
          [
            'Building: when defending, commit early to a wall shape (king in front of connected pawns, bishop guarding the entry color) and stop improvising. A finished fortress converts a lost position into a draw by pure geometry.',
            'Breaking: fortresses fall only from inside ( zugzwang, pawn sacrifice to open the king\u2019s shell) or from a second front the wall was never designed to face. Attack the DESIGN, not the bricks.',
          ],
          'Fortresses are designed, not improvised. So are their breaches.',
        ),
        demo('The wall', ['The everyday fortress: king in the corner, knight sealing the back rank, pawns sealing the corner. Every rook check or capture loses the rook on the spot. There is nothing to wait out.'], 'r6k/8/8/8/8/8/PP6/KN6 w - - 0 1', {
          marks: [
            { square: 'b1', color: 'green' },
            { square: 'b2', color: 'green' },
          ],
          caption: 'Green: the seal. It does not fall.',
        }),
        quiz('Fortress breach', 'Which factor actually breaks a fortress?', [
          right('Zugzwang or a second front the wall cannot face', 'Walls fail on design flaws, not on force.'),
          wrong('More checking with the rook', 'Checks are not progress without a plan.'),
          wrong('Trading down to a pawn endgame', 'That usually STRENGTHENS the defender\u2019s position.'),
        ]),
        quiz('Fortress build order', 'Which pieces make the everyday corner fortress?', [
          right('The king tucked in, a knight sealing the back rank, pawns sealing the file', 'The knight is the keystone: no checks along the rank, no captures on the wall.'),
          wrong('Two knights in front of scattered pawns', 'Scattered pawns are doors. Knights jump but cannot seal files.'),
          wrong('The queen parked on the first rank', 'Queens patrol; they do not build.'),
        ]),
        drill('The keystone left', 'k6r/8/2N5/8/8/8/PP6/K7 b - - 0 1', ['Rh1#'], 'Same wall, one difference: the knight wandered to c6. Break it', 'The back rank is open. One rook move ends everything.', 'Rh1 mate. The wall was never weak; its keeper simply left. Fortresses die at the design flaw, not at the bricks.'),
        quiz('Building your own fortress', 'You are worse with an unbreakable-looking enemy attack coming. When do you START thinking about a fortress?', [
          right('Immediately: trade into the structure where your pawns and king form a wall, before the pieces arrive', 'Fortresses need the right structure. Building it under fire is far harder.'), 
          wrong('Only when the attack has fully arrived', 'By then every wall square is watched. The window closes early.'), 
          wrong('Fortresses are only for endgames', 'The best fortresses are set up while queens still hover: the structure does the defending.'), 
        ]),
      ],
    },
    {
      id: 'gm-05',
      n: 5,
      title: 'Structural exchanges',
      subtitle: 'Give a good piece for a bad square, on purpose.',
      minutes: 12,
      concepts: ['tradeDecisions', 'pawnStructure'],
      steps: [
        quiz('Retrieval first', 'How do fortresses actually fall?', [
          right('Zugzwang, or a second front the design never faced', 'Flaws, not force.'),
          wrong('Sustained direct assault', 'The wall was built to absorb exactly that.'),
          wrong('Material attrition over time', 'Material does not shrink by itself inside a fortress.'),
        ]),
        text(
          'Trading values, keeping squares',
          [
            'Modern opening play happily gives up the two bishops, trades a good knight for a bad one, or accepts doubled pawns, all to fix the structure the middlegame will be fought on. The question is never "who is material ahead after move ten" but "whose pawns will lose the war of attrition".',
            'The classic example: taking on c6 and c7 to give your opponent doubled pawns in front of their own king, then attacking those squares for the rest of the game. The pawns cannot run away. Your pieces can.',
          ],
          'Trade value for geometry. Geometry does not move backward.',
        ),
        demo('The permanent mark', ['White\u2019s doubles sit on c3 and c4. The red squares show where the structure bleeds forever: the front pawn needs a bodyguard every single move for the rest of the game.'], '2r1k3/8/8/8/2P5/2P5/1P6/2KR4 w - - 0 1', {
          marks: [
            { square: 'c3', color: 'red' },
            { square: 'c4', color: 'red' },
          ],
          caption: 'Red: the structure that can never heal.',
        }),
        quiz('Structural exchange', 'You can trade your good knight for his bad bishop, and the resulting structure gives him doubled pawns on a half-open file. This trade is good when...', [
          right('The doubled pawns and the open file outweigh the piece quality difference', 'Squares and files outlast piece placement.'),
          wrong('Never: a good knight is sacred', 'Piece quality is temporary. Structure is permanent.'),
          wrong('Only when material is equal', 'The structure decides who is effectively material ahead later.'),
        ]),
        quiz('The long view', 'Why do top players accept doubled pawns near their own king in exchange for long-term pressure?', [
          right('Because the pressure is concrete and the doubled pawns can often be defended for a long time', 'The compensation arrives now; the bill may never come due.'),
          wrong('Because doubled pawns are actually good', 'They are a real weakness. Just sometimes a affordable one.'),
          wrong('Because engines recommend it', 'Engines evaluate positions, not philosophies. The human reads the position type.'),
        ]),
        quiz('Defending the doubles', 'You are the side WITH doubled pawns. What keeps them alive?', [
          right('Piece control of the front pawn\u2019s squares and a plan that does not need the file behind them', 'The front pawn survives while pieces guard it. The compensation must outlive the defense.'),
          wrong('Pushing one of them immediately to undouble', 'Undoubling usually surrenders the file AND the square for nothing.'),
          wrong('Nothing: doubled pawns always fall', 'They fall on a schedule. Good players postpone that schedule forever.'),
        ]),
        playout('The structure war, played out', 'His pawns are doubled on the c-file: a target that never heals. Open the file, gang up on the front pawn and turn structure into material.', 'r2q1rk1/p1p1bppp/2pn4/8/8/2N5/PPP2PPP/R1BQ1RK1 w - - 0 9', 'w', 'Win at least 3 points of material within 16 moves', 4, 'material', 16, 'The doubled pawn paid its bill. Structure converted into loot.', 'Do not force anything: the c-file is a slow squeeze. Trade into it, then hit c6 from every direction.', 'Every piece you swing toward c6 is a loan the doubled pawn repays with interest.'),
      ],
    },
    {
      id: 'gm-06',
      n: 6,
      title: 'Flank thrusts',
      subtitle: 'g5 and f5: the pawns that start revolutions.',
      minutes: 12,
      concepts: ['pawnBreaks', 'initiative'],
      steps: [
        quiz('Retrieval first', 'How does the side holding doubled pawns usually survive?', [
          right('Piece control of the front pawn\u2019s squares while the compensation lasts', 'The bill is postponed, not canceled. Pieces are the postponement.'),
          wrong('Quickly undoubling with a pawn capture', 'Undoubling donates squares and file for nothing.'),
          wrong('They never survive: doubled pawns are fatal', 'Doubled pawns lose endgames, not necessarily the game.'),
        ]),
        text(
          'Space converted to attacks',
          [
            'In closed centers, flank pawn thrusts are the main weapon: g4-g5 evicts the f6 knight (the guardian of the light squares and the king), f4-f5 claims space and opens the f-file behind it.',
            'The rule: a flank thrust works when the center is STABLE. If the center can open, your advancing pawns become targets and the counterstrike comes through the middle. Close the center first, then storm.',
          ],
          'Close the center, then flank. Open centers make flank pawns bait.',
        ),
        drill('Roll the flank', 'r1bq1rk1/ppp2ppp/2n2n2/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', ['h4'], 'The center is locked. Start the flank advance', 'The h-pawn leads the wave toward the enemy king.', 'h4. Closed center: the flank is the only road. h5, g5, and the wall has a door.'),
        quiz('Thrust precondition', 'Before playing g4-g5 in a closed position, verify that...', [
          right('The center is stable and cannot be opened against you', 'Flank attacks need a closed center as their foundation.'),
          wrong('Your king is castled short', 'Location matters, but the center\u2019s stability is the true precondition.'),
          wrong('You have more material', 'Material is irrelevant to the geometry of a flank attack.'),
        ]),
        quiz('Thrust cost', 'g4-g5 also does what to YOUR position?', [
          right('Weakened your own king cover and fixed your pawn on a target square', 'Flank pawns spend home safety. Closed centers make that affordable.'),
          wrong('Nothing: pawns are free', 'Pawns never move back. Every push is an investment with risk.'),
          wrong('Improved your bishop automatically', 'The g-pawn often BLOCKS its own bishop. Costs and benefits.'),
        ]),
        quiz('Open center punishment', 'You played g4-g5 but the center was NOT stable. What happens?', [
          right('The center opens and your advanced pawns become targets for the counterstrike', 'Flank attacks without a closed center are invitations to the middle.'),
          wrong('Nothing: flank pawns are always safe', 'An open center turns every advanced flank pawn into a hook.'),
          wrong('The flank attack just fails quietly', 'It fails LOUDLY: the counterstrike hits the king through the center.'),
        ]),
        quiz('Flank pawn hooks', 'Why is an advanced flank pawn (like a black g-pawn on g4) strategically valuable even when the attack fails?', [
          right('It is a hook: your own pawn or piece can hit it to open lines for your attack', 'Hooks justify flank pushes even in failure: the weaknesses remain as future targets.'),
          wrong('Advanced pawns are always assets', 'They are hooks for BOTH sides. Whoever attacks the hook first usually profits.'),
          wrong('Hooks only matter in pawn endings', 'Opening a file with a pawn trade matters most with heavy pieces still on.'),
        ]),
      ],
    },
    {
      id: 'gm-07',
      n: 7,
      title: 'The exchange sacrifice',
      subtitle: 'A rook for structure, squares, and time.',
      minutes: 12,
      concepts: ['sacrifice', 'pawnStructure', 'pieceActivity'],
      steps: [
        quiz('Retrieval first', 'What must be true before a flank pawn thrust?', [
          right('The center is stable: it cannot be opened against you', 'Closed center first, flank second. Reverse the order and lose.'),
          wrong('You have the bishop pair', 'Helpful, but the center\u2019s stability is the precondition.'),
          wrong('The enemy king is already weak', 'The thrust CREATES the weakness. The center decides whether you live long enough.'),
        ]),
        text(
          'Minus two, plus forever',
          [
            'The exchange sacrifice (rook for knight or bishop) is the most strategic material investment in chess. The classic: Rxc3, wrecking the pawn chain around the enemy king, or Rc8/Nc4 trades that entomb a bishop behind its own pawns forever.',
            'The evaluation question: not "did I win material" but "what PERMANENT thing did I buy". Doubled pawns, a dead bishop, a shattered king shell: all permanent. The two-point material deficit is temporary only if your compensation is not.',
          ],
          'Sell the rook. Buy squares the opponent can never buy back.',
        ),
        demo('Rxc3: the classic', ['Black takes the knight with the rook. After bxc3, White\u2019s pawns are doubled, c3 and c4 are forever weak, and the dark squares belong to Black.'], '2r1k3/8/8/8/8/2N5/PPP5/2KR4 b - - 0 1', {
          moves: ['Rxc3', 'bxc3'],
          caption: 'Material: minus two. Structure: plus everything.',
        }),
        drill('Break the shell', '2r1k3/8/8/8/8/2N5/PPP5/2KR4 b - - 0 1', ['Rxc3', 'bxc3'], 'Play the exchange sacrifice', 'The knight on c3 guards the whole white queenside. Remove it with a rook.', 'Rxc3, bxc3. Doubled pawns, dead squares, permanent weakness. The rook was the cheapest part.'),
        quiz('Sac verdict', 'The exchange sacrifice is justified when...', [
          right('The compensation is permanent: structure, squares, or an unfixable king weakness', 'Temporary activity for a permanent rook is a bad rate. Permanent damage is the right purchase.'),
          wrong('You feel the position needs shaking up', 'Feelings do not convert into endgames.'),
          wrong('You are behind material anyway', 'Being behind is not compensation. Geometry is.'),
        ]),
        quiz('Best exchange target', 'The classic exchange sacrifice lands on which square most often?', [
          right('c3 or c6, where the knight anchors the enemy pawn chain and king shelter', 'The knight holding the structure together is the rook\u2019s best victim.'),
          wrong('f7, where bishops belong', 'f7 is bishop geometry. The exchange sac is knight geometry.'),
          wrong('Wherever the enemy queen sits', 'That would be a queen sacrifice, not an exchange one.'),
        ]),
        quiz('The permanent audit', 'You played Rxc3 and got doubled pawns, a weak square, and nothing else concrete. Was the sacrifice sound?', [
          right('Only if the structure damage is permanent and worth more than two points over the rest of the game', 'Permanent purchases only. Activity alone cannot cover a rook.'),
          wrong('Yes: any exchange sac creates pressure', 'Pressure without permanence is a two-point donation.'),
          wrong('No: never sacrifice the exchange', 'The exchange sac is a mainline weapon. It just has strict terms.'),
        ]),
        quiz('Timing the exchange sac', 'When does an exchange sacrifice on c3 or f6 lose its power?', [
          right('When the attacker can trade off the pieces that would exploit the new weak squares', 'The sac buys structure damage. If the exploiters get traded, the damage is harmless.'), 
          wrong('When it is played early, before move 20', 'Early exchange sacs are common and strong when the structure fits.'), 
          wrong('When the defender has not castled yet', 'Unmixed kings can be MORE vulnerable: the sac may deflect before castling.'), 
        ]),
      ],
    },
    {
      id: 'gm-08',
      n: 8,
      title: 'Prophylaxis at the top',
      subtitle: 'Restrict moves before you make your own.',
      minutes: 12,
      concepts: ['prophylaxis', 'outposts'],
      steps: [
        quiz('Retrieval first', 'Where does the classic exchange sacrifice land, and what does it buy?', [
          right('On c3/c6: the knight anchoring the enemy structure, buying permanent damage', 'The structural anchor is the rook\u2019s victim.'),
          wrong('On f7: for an attack', 'f7 is bishop geometry. Exchange sacs are knight geometry.'),
          wrong('Anywhere: rooks are flexible', 'The sacrifice has one classic purchase: the structure.'),
        ]),
        quiz('When the sac fails', 'You sacrificed the exchange for doubled pawns, but your opponent just traded all the minor pieces. What went wrong?', [
          right('Nothing structural: but with no pieces left, doubled pawns are the only army that can lose the endgame', 'The sac bought a MIDDLEGAME target. Keep pieces on the board or the purchase expires.'),
          wrong('Doubled pawns are always enough on their own', 'Pawns win endgames, but only with an army behind them.'),
          wrong('The sacrifice was simply bad', 'The purchase was real. The plan must keep the pieces that cash it in.'),
        ]),
        text(
          'The invisible squeeze',
          [
            'Master-level prophylaxis is not one move: it is a policy. Every pawn you keep on its square takes squares from his knights; every piece you keep flexible denies him targets. Karpov built a dynasty on asking "what does he want?" for forty moves.',
            'The advanced version: prophylaxis against IDEAS, not threats. His knight dreams of d5: occupy d5\u2019s access squares before he organizes it. The plan dies two moves before it is born.',
          ],
          'Restrict his future, then collect the present.',
        ),
        drill('Kill the dream square', '4k3/2p1p3/8/8/8/8/8/1N2K3 w - - 0 1', ['Nc3', 'Kd7', 'Nd5'], 'His knight would love d5. Get there first', 'Two hops: c3, then the square itself.', 'Nd5. The square is occupied by the RIGHT knight now. His dream square is your outpost.'),
        quiz('Prophylaxis target', 'The strongest prophylactic moves target...', [
          right('The opponent\u2019s PLANS: the squares and routes his pieces need', 'Kill the idea two moves early and it never costs a tempo.'),
          wrong('Only immediate threats', 'Immediate threats are tactics. Prophylaxis is strategy.'),
          wrong('Your own weaknesses', 'That is defense. Prophylaxis is offense against plans.'),
        ]),
        quiz('Prophylaxis vs defense', 'Blocking a threat this move versus killing a plan this move. Which is prophylaxis?', [
          right('Killing the plan: the threat may never even arise', 'True prophylaxis acts before the threat exists.'),
          wrong('Blocking the immediate threat', 'That is plain defense. Necessary, but not the art.'),
          wrong('Both are the same thing', 'One is a bandage. The other is the vaccine.'),
        ]),
        quiz('The squeeze audit', 'Your position is better but your opponent has no weaknesses. What is the master plan?', [
          right('Restrict his pieces\u2019 best squares until HIS position cracks first', 'No weaknesses means you create the squeeze: deny squares, force bad moves, wait.'),
          wrong('Sacrifice to create complications', 'Complications favor the squeezed side\u2019s counterplay.'),
          wrong('Trade into an endgame and hope', 'Endgames need an advantage entering them. Create it first.'),
        ]),
        quiz('The waiting move', 'In a squeeze, you found a good square for each piece. What role do quiet waiting moves still play?', [
          right('They transfer the turn so the opponent must weaken his position first', 'Zugzwang lives inside squeezes. Waiting moves are weapons, not passivity.'), 
          wrong('None: always improve a piece every single move', 'Once every piece stands at its best, further moves only create weaknesses. Waiting takes over.'), 
          wrong('Waiting moves are only for time trouble', 'Grandmasters spend many moves a game doing exactly nothing, on purpose.'), 
        ]),
      ],
    },
    {
      id: 'gm-09',
      n: 9,
      title: 'The king walks',
      subtitle: 'When the strongest piece changes address mid-game.',
      minutes: 12,
      concepts: ['kingActivity', 'kingSafety', 'center'],
      steps: [
        quiz('Retrieval first', 'What is the difference between prophylaxis and plain defense?', [
          right('Prophylaxis kills PLANS before they exist; defense answers THREATS that exist', 'The vaccine versus the bandage.'),
          wrong('They are identical terms', 'One acts on the future, one on the present.'),
          wrong('Prophylaxis is passive defense', 'It is offense against the opponent\u2019s future.'),
        ]),
        text(
          'The rarest luxury',
          [
            'A middlegame king walk (Kf1-g2-h3, or the long march to the queenside) happens when BOTH conditions hold: the center is completely closed, and neither side can open lines against the walking king.',
            'The walk converts the king into a fighting piece two moves early: escorting passers, supporting pawn breaks, physically dominating squares. It is terrifying and legal. Verify the center is frozen first, every single move.',
          ],
          'Frozen center: the king may walk. Any crack: the king stays home.',
        ),
        demo('The closed center permit', ['The center is closed: d4 and d5 are fixed against each other and no file is open. While the freeze holds, the king is allowed to step toward the center and fight. One opened line and the permit is revoked.'], 'r1bqkb1r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQKB1R w KQkq - 4 6', {
          marks: [
            { square: 'd4', color: 'green' },
            { square: 'd5', color: 'yellow' },
          ],
          caption: 'The frozen center: the permit stands while it lasts',
        }),
        quiz('Walk permission', 'A middlegame king march is safe when...', [
          right('The center is closed and no line can be opened against him', 'The wall is the permit.'),
          wrong('You are up material', 'Material does not stop rooks on open files.'),
          wrong('Your queen protects him', 'Queens cannot stop four attackers on an opened file.'),
        ]),
        drill('The walk begins', '8/8/8/8/8/4k3/2P5/K1R5 w - - 0 1', ['Kb1'], 'The same walk, distilled to its skeleton: the king crosses only behind cover', 'The rook guards the pawn; the king slides toward it without ever leaving it unguarded.', 'Kb1. From here the king walks forward and the pawn runs behind him. The rook held the guard duty; the king collected the win.'),
        quiz('The walk audit', 'Your king is three squares into a middlegame walk and the center just unlocked. What now?', [
          right('The permit is revoked: walk the king straight home, immediately', 'One opened line is all it takes. The walk dies the moment the center cracks.'),
          wrong('Continue: the king is already committed', 'Committed to what? The center changed the rules.'),
          wrong('Continue but keep the queen defending', 'Queens cannot stop four pieces on an opened file. Turn back.'),
        ]),
      ],
    },
    {
      id: 'gm-10',
      n: 10,
      title: 'Passed pawn doctrine',
      subtitle: 'Blockaders, duos, and the far-advanced killer.',
      minutes: 12,
      concepts: ['endgame', 'promotion'],
      steps: [
        quiz('Retrieval first', 'What revokes a middlegame king walk\u2019s permission?', [
          right('The center opening: even one line against the walking king is fatal', 'Frozen center walks. Open center dies.'),
          wrong('The opponent\u2019s rating', 'The center decides, not the opponent.'),
          wrong('Running low on clock', 'Clock pressure is real but secondary. Geometry is primary.'),
        ]),
        text(
          'Runners with escorts',
          [
            'Connected passed pawns are the strongest formation in endgames: each defends the other\u2019s promotion squares, and one always promotes. They need only a king nearby, not pieces.',
            'The far-advanced passer (6th rank, supported) is worth a piece in practical terms: it fixes two enemy pieces, and every enemy tempo spent on it is a tempo your other plans ride free.',
          ],
          'Two runners side by side beat every piece that watches them.',
        ),
        demo('The duo', ['Two connected passers on the fifth: they guard each other\u2019s squares and cannot be stopped by anything less than two pieces.'], '8/8/8/2PP4/8/8/8/4K2k w - - 0 1', {
          marks: [
            { square: 'c5', color: 'green' },
            { square: 'd5', color: 'green' },
          ],
          caption: 'Green: the duo. Each guards the other.',
        }),
        drill('Roll the duo', '8/8/8/2PP4/8/8/8/4K2k w - - 0 1', ['d6'], 'Push the duo forward', 'The d-pawn leads, the c-pawn guards its squares.', 'd6. The runner advances and its bodyguard stays home. This is how connected passers win endgames.'),
        quiz('Duo strength', 'Why are connected passed pawns stronger than two isolated passers?', [
          right('They defend each other\u2019s promotion squares', 'One blocker faces a wall, not a door.'),
          wrong('They are worth more material points', 'Same points. Different teamwork.'),
          wrong('They move faster', 'Pawns all move one square. Speed is geometry, not speed.'),
        ]),
        quiz('The far-advanced passer', 'Why is a supported passer on the 6th rank worth roughly a piece?', [
          right('It fixes two enemy pieces on babysitting duty, freeing your whole army', 'The magnet effect: every defender assigned is a defender absent elsewhere.'),
          wrong('Because it promotes next move no matter what', 'It still needs escorting. The VALUE is the distraction.'),
          wrong('Pawns are undervalued by the point system only', 'This is a concrete positional fact, not a scoring quirk.'),
        ]),
      ],
    },
    {
      id: 'gm-11',
      n: 11,
      title: 'Rook and pawn: technical wins',
      subtitle: 'Lucena, cutting off, and the wrong rook.',
      minutes: 12,
      concepts: ['endgame', 'technique', 'kingActivity'],
      steps: [
        quiz('Retrieval first', 'Why does a far-advanced supported passer play like a piece?', [
          right('It pins down multiple defenders, and every tempo they spend is yours', 'The magnet effect funds your whole remaining plan.'),
          wrong('It moves two squares per turn', 'Pawns never do.'),
          wrong('The point system says so', 'The point system says 1. The board says a piece.'),
        ]),
        text(
          'The professional method',
          [
            'Three wins to own completely: Lucena (build the bridge), the cutting-off (rook parks the enemy king on a rank while your king escorts the pawn), and the wrong rook position (when the defending rook is passively placed behind the pawn, the win is routine).',
            'The meta-skill: reach these positions FROM slightly worse ones by exact play a dozen moves earlier. That is what "technical" means: knowing which endgame to aim for before it exists.',
          ],
          'Own the three wins. Recognize them ten moves early.',
        ),
        drill('The bridge, again', '8/3P2k1/8/1K6/7R/8/1r6/8 w - - 0 1', ['Rb4', 'Rxb4+', 'Kxb4'], 'Lucena from the Master tier: build it faster now', 'One move constructs the shelter on the checking file.', 'Rb4! Bridge built, checks absorbed, pawn queens. Rep speed is the grandmaster difference.'),
        quiz('Cutting off', 'The attacker\u2019s rook parks on a rank and the defending king cannot cross. What does this achieve?', [
          right('The king is excluded from the promotion race entirely', 'One rook, one rank, half the enemy army removed.'),
          wrong('It wins the rook', 'The rook is safe on its rank. The win comes from the pawn.'),
          wrong('It forces the fifty-move rule', 'Checks and shuffles waste White\u2019s time, not Black\u2019s.'),
        ]),
        quiz('Wrong rook defense', 'The defender\u2019s rook sits passively in front of the enemy pawn. What does this mean for the attacker?', [
          right('The win becomes routine: the rook defends nothing and attacks nothing', 'Passive rooks are worth a pawn less than their nominal value.'),
          wrong('The defense is now stronger', 'Active rooks defend. Passive rooks decorate.'),
          wrong('Nothing: rooks are rooks', 'Rook ACTIVITY is the whole evaluation of rook endings.'),
        ]),
        quiz('Reach it early', 'What is the meta-skill behind "technical" endgame wins?', [
          right('Steering toward the winning position a dozen moves before it exists', 'Technique starts in the transition, not in the endgame itself.'),
          wrong('Memorizing more tablebase lines', 'The tables cover the last few pieces. The steering is the human skill.'),
          wrong('Playing faster in endings', 'Speed is irrelevant to reaching the right structure.'),
        ]),
      ],
    },
    {
      id: 'gm-12',
      n: 12,
      title: 'Draws you must know',
      subtitle: 'K+B, K+N, stalemate craft, and the perpetual library.',
      minutes: 12,
      concepts: ['endgame', 'technique', 'defense'],
      steps: [
        quiz('Retrieval first', 'What makes an endgame win "technical"?', [
          right('You recognized and steered toward it many moves before it arrived', 'The professional wins endings in the transition, not at the board of the ending.'),
          wrong('It requires no calculation', 'It requires calculation, just of a known and drillable kind.'),
          wrong('The engine confirms the win', 'Engines confirm everything. Steering is the human skill.'),
        ]),
        text(
          'The library of half points',
          [
            'K+B vs K and K+N vs K: always drawn. K+R vs K: always won. K+two knights vs K: cannot force mate, though it exists. Q vs R: usually drawn with technique. These facts are not trivia: they decide whether you trade into an ending or refuse.',
            'Stalemate craft: as the attacker, one careless queen move hands back a whole queen\u2019s worth of advantage. As the defender, steering INTO stalemate nets is the last resource, and it works.',
          ],
          'Know the table of ends before you trade into one.',
        ),
        drill('Mate, not stalemate', '7k/8/6K1/8/8/8/8/3Q4 w - - 0 1', ['Qd8#'], 'One move: mate him instead of drawing him', 'The king on g6 covers the escape squares; the queen covers the rest of rank 8.', 'Qd8 mate. One careless queen step and this would be stalemate: the difference between a point and half one.'),
        quiz('Table of ends', 'Which ending CANNOT be won by force?', [
          right('King and two knights versus a lone king', 'No forced mate exists. Everything else on this list converts.'),
          wrong('King and rook versus a lone king', 'Basic technique mate. Always won.'),
          wrong('King and queen versus king and rook', 'Hard, but normally won with exact play.'),
        ]),
        quiz('Stalemate trap', 'You are up a queen. Before every check you must verify...', [
          right('That the enemy king keeps at least one legal move (or gets mated)', 'Stalemate is the only way a queen up becomes a draw.'),
          wrong('That the check is with the queen', 'All queen checks matter. The ESCAPE squares matter more.'),
          wrong('Nothing: checks are always safe', 'The stalemate net is woven from careless checks.'),
        ]),
        quiz('The trade question', 'You can trade queens into K+R vs K. What do you need to know first?', [
          right('That K+R vs K is a forced win: take the trade and collect', 'The table of ends is the trade filter. Know it before you shake hands.'),
          wrong('Whether your opponent wants it', 'The table decides, not the opponent\u2019s mood.'),
          wrong('Nothing: queen endings are always better', 'Queen endings are drawish and tactical. The rook ending is a guaranteed point.'),
        ]),
      ],
    },
    {
      id: 'gm-13',
      n: 13,
      title: 'Pure technique',
      subtitle: 'One endgame, zero mistakes allowed.',
      minutes: 14,
      concepts: ['technique', 'endgame', 'kingActivity'],
      steps: [
        quiz('Retrieval first', 'Which endings are forced wins, and which are forced draws?', [
          right('K+R and K+Q: won. K+B, K+N, two knights: drawn', 'The table of ends. It filters every trade offer you will ever accept.'),
          wrong('Everything is won with good technique', 'K+B vs K has no mate in it. No technique reaches what does not exist.'),
          wrong('Everything is drawn without pawns', 'K+Q vs K is the most basic win in chess.'),
        ]),
        text(
          'The technique test',
          [
            'Rook and king versus king: the full conversion, no coaching. Cut off, escort, mate. Every wasted move extends the game; every wrong move risks the fifty-move rule or a slip.',
            'Do it in as few moves as you can. Efficiency is the grandmaster metric, not just correctness.',
          ],
          'Cut, escort, mate. Efficiently.',
        ),
        quiz('Efficiency metric', 'You can mate in 14 moves with perfect technique or shuffle safely for 25. What does the grandmaster optimize?', [
          right('Fewer moves: fewer chances for slips and clock drain', 'Efficiency is correctness with margins.'),
          wrong('More moves: safety first', 'Shuffling gives the opponent resources and yourself doubt.'),
          wrong('Either: the result is the same', 'The result is the same only until a human makes move 23 instead of 14.'),
        ]),
        quiz('The slip margin', 'Why does efficiency protect accuracy, not just the clock?', [
          right('Every extra move is one more chance for a repetition slip, a stalemate trap, or a flag', 'Short technique has fewer doors for disaster. Margin is a chess concept.'),
          wrong('It does not: correctness is correctness', 'Correct twenty-five times in a row is harder than correct fourteen times.'),
          wrong('Only the fifty-move rule matters', 'Slips and stalemate traps arrive long before move fifty.'),
        ]),
        drill('First move of the conversion', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', ['Kd2'], 'The rook endgame begins. Best first move?', 'The king marches. Rook moves can wait.', 'Kd2. King activity is the conversion engine.'),
        playout(
          'The technique exam',
          'Rook and king against a lone king. Mate him, cleanly and fast.',
          '7k/8/8/8/8/8/8/R3K3 w - - 0 1',
          'w',
          'Checkmate the black king',
          2,
          'checkmate',
          25,
          'Clean technique. This position must be a formality for the rest of your chess life.',
          'Reset: rook across the king\u2019s rank, king marches, shrink the box. Keep the rook three squares from his king.',
        ),
      ],
    },
    {
      id: 'gm-14',
      n: 14,
      title: 'Calculating under uncertainty',
      subtitle: 'Playing well when the position has no answer.',
      minutes: 12,
      concepts: ['calculation', 'prophylaxis'],
      steps: [
        quiz('Retrieval first', 'What does technical efficiency protect beyond the clock?', [
          right('Accuracy margin: fewer moves, fewer slip chances', 'Every extra move is a door for disaster.'),
          wrong('Nothing: the result is fixed', 'The result is fixed only if every single move is right.'),
          wrong('Your rating only', 'It protects the win itself. The rating follows.'),
        ]),
        text(
          'The fog doctrine',
          [
            'Some positions have no calculable truth: too many branches, evaluation swinging with every move. Grandmasters handle fog with three tools: choose the move that keeps the most OPTIONS, avoid committing to structures you do not understand, and prefer positions where mistakes are recoverable.',
            'The practical rule: in unclear positions, play moves that would still be good in three different futures. Flexibility is the evaluation category the engine cannot teach you.',
          ],
          'In fog, keep options. Commitment is for clarity.',
        ),
        demo('Reading the fog', ['An unclear middlegame: no forcing lines, evaluation near zero, many pieces on the board. The right move here keeps the queen flexible and the pawns flexible.'], 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQKB1R w KQ - 4 6', {
          marks: [
            { square: 'd4', color: 'green' },
            { square: 'd5', color: 'yellow' },
          ],
          caption: 'Fog: keep the tension, keep the options',
        }),
        quiz('Fog decision', 'Two moves are roughly equal in evaluation. One commits to a kingside attack; the other keeps central flexibility. The position is sharp and unclear. Which do you play?', [
          right('The flexible one: unclear positions punish commitments', 'Options survive the fog. Attacks die in it.'),
          wrong('The attacking one: initiative is everything', 'Initiative without clarity is a coin flip.'),
          wrong('Whichever move is faster to play', 'The clock is one resource. The position is the other.'),
        ]),
        drill('Calculate the one forcing line', '5r1k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1', ['Qg8+', 'Rxg8', 'Nf7#'], 'Fog everywhere, except here: this line forces itself. Calculate it to the end', 'The queen lands next to the king with support; the rook must take; the knight finishes.', 'Qg8, Rxg8, Nf7 mate. Every ply forced. When a line calculates to the END, the fog does not apply: play it.'),
        quiz('Flexibility test', 'Which move is the flexible one?', [
          right('The one that stays useful in three different plausible futures', 'Flexibility is option density. Commitments are option spending.'),
          wrong('The one your favorite piece wants to make', 'Pieces have dreams. Positions have requirements.'),
          wrong('The one that wins the most material if it works', 'If it works is doing heavy lifting in that sentence.'),
        ]),
      ],
    },
    {
      id: 'gm-15',
      n: 15,
      title: 'Preparation thinking',
      subtitle: 'Building a dossier instead of memorizing lines.',
      minutes: 10,
      concepts: ['development', 'endgame'],
      steps: [
        quiz('Retrieval first', 'What makes a move good in an unclear position?', [
          right('Recoverability and usefulness across multiple futures', 'Flexibility is the fog currency.'),
          wrong('Maximum forcing power', 'Forcing is commitment. Fog punishes commitment.'),
          wrong('The strongest engine line at fixed depth', 'Engine lines assume the engine is playing. You are.'),
        ]),
        text(
          'The preparation method',
          [
            'Serious preparation is a dossier: which openings does the opponent pool play, where do their results cluster, which structures do they LOSE from, how do they handle endgames and time trouble. You are not memorizing moves; you are choosing the battlefield.',
            'Your own dossier matters equally: know your leak patterns (the positions you lose from) and design your repertoire to route around them. Every opening choice is a bet on your strengths.',
          ],
          'Prepare structures and patterns. Lines are just the door.',
        ),
        quiz('Dossier priority', 'The most valuable item in a preparation dossier is...', [
          right('The structures where the opponent consistently loses or suffers', 'Routes to their weak structures are worth more than exact lines.'),
          wrong('Their complete game history', 'History is raw data. The dossier is the insight.'),
          wrong('Their favorite first moves', 'Move one tells you almost nothing. Structures tell you everything.'),
        ]),
        quiz('Building the dossier', 'How often should a serious competitor update their own leak-pattern dossier?', [
          right('Every review session: it is a living document, not a one-time project', 'Leak patterns shift as you improve. Yesterday\u2019s fix is today\u2019s strength.'),
          wrong('Once, before a big tournament', 'One snapshot misses the trend.'),
          wrong('Never: you know your own style', 'You know your intentions. The games know your habits.'),
        ]),
        quiz('Your own dossier', 'Reviewing your last 20 rated games, the highest-value statistic to track is...', [
          right('The positions or structures where you consistently make your first mistakes', 'Your leak patterns are the map for your next training block.'),
          wrong('Total time played', 'Volume is not diagnosis.'),
          wrong('Your opponent\u2019s names', 'Unless you play them weekly, irrelevant.'),
        ]),
        drill('Aim the repertoire', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['d4'], 'You win strategic struggles and lose wild tactics. Open accordingly', 'The queen pawn leads to closed, plannable middlegames.', 'd4. The repertoire serves your strengths. That is preparation in one move.'),
      ],
    },
    {
      id: 'gm-16',
      n: 16,
      title: 'Analyzing like a professional',
      subtitle: 'The blunder map and the plan audit.',
      minutes: 10,
      concepts: ['calculation', 'prophylaxis'],
      steps: [
        quiz('Retrieval first', 'What is the most valuable item in any preparation dossier?', [
          right('The structures where the opponent (and you) consistently leak', 'Routes to weak structures beat exact lines every time.'),
          wrong('Raw game counts', 'Volume is not insight.'),
          wrong('Engine evaluations of their openings', 'Evaluations say nothing about human leak patterns.'),
        ]),
        text(
          'Two passes, one method',
          [
            'Pass one, the blunder map: walk the game move by move and mark every decision point where the evaluation genuinely swung. Not the mistakes you already know: the moments you CHOSE a plan.',
            'Pass two, the plan audit: at each swing point, write what you were thinking and what the position actually required. Skills improve when the gap between intention and position becomes visible. Engines show moves; the audit shows habits.',
          ],
          'Map the swings. Audit the thinking. That is how ratings actually rise.',
        ),
        quiz('Analysis order', 'After a loss, the professional first pass is...', [
          right('A cold blunder map, before reading any engine output', 'Find the swings with your own eyes first. The engine\u2019s numbers come second.'),
          wrong('Dump the PGN into the engine immediately', 'The engine tells you WHAT. You need to learn WHY.'),
          wrong('Blame the opening', 'The opening is one decision of forty. The map shows the real story.'),
        ]),
        quiz('Habit fixing', 'The blunder map shows you consistently drop material between moves 25 and 30. The fix is...', [
          right('A dedicated check-scan routine at that phase, trained with drills', 'Patterns and routines fix phases. Willpower does not.'),
          wrong('Playing faster to feel fresh', 'The phase, not fatigue, is the pattern.'),
          wrong('Avoiding move 25', 'Chess has no skip button.'),
        ]),
        playout('Play the audit', 'The report scans every move for loose pieces and missed checks. Run that scan here, wait for the practice bot to slip, and make it pay.', 'r1bqkb1r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQKB1R w KQkq - 4 6', 'w', 'Win at least 3 points of material within 16 moves', 4, 'material', 16, 'The scan found the loot. That is the habit the audit trains.', 'Loose pieces pay only when you LOOK. Checks, captures, threats, every move.', 'The position is unclear, so keep your options: the scan, not the engine, finds the swing.'),
        demo('Marking the swings', ['A blunder map in visual form: the red squares mark where a plan decision went wrong in a real game. The engine finds moves; the map finds MOMENTS.'], 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', {
          marks: [
            { square: 'd8', color: 'red' },
            { square: 'e8', color: 'yellow' },
          ],
          caption: 'Red: the decision point. Yellow: what it cost.',
        }),
        quiz('The audit habit', 'At each swing point, what does the professional write down?', [
          right('What they were thinking versus what the position actually required', 'The gap between intention and position is the training target.'),
          wrong('The engine\u2019s evaluation at that move', 'Numbers do not fix habits. Named gaps do.'),
          wrong('Nothing: recognizing it once is enough', 'Habits repeat until they are named and retrained.'),
        ]),
      ],
    },
    {
      id: 'gm-17',
      n: 17,
      title: 'Time triage',
      subtitle: 'Mapping clock minutes to position complexity.',
      minutes: 10,
      concepts: ['tempo', 'calculation'],
      steps: [
        quiz('Retrieval first', 'What does the plan audit compare at every swing point?', [
          right('What you were thinking versus what the position required', 'The intention gap is where improvement lives.'),
          wrong('Your move versus the engine\u2019s move', 'The engine comparison comes after the habit comparison.'),
          wrong('Clock usage versus opponent\u2019s', 'Time matters, but the audit is about thinking.'),
        ]),
        text(
          'Where the minutes go',
          [
            'Budget by decision weight: opening knowledge, seconds. Quiet regrouping, one minute. Pawn structure commitments, captures, king safety decisions: several minutes each. There are usually only three or four critical moments per game: they deserve most of the clock.',
            'The endgame rule: bank time. Reach move 30 with ten minutes and every technique decision is calm; reach it with two and technique collapses exactly when it matters.',
          ],
          'Three or four moments own the clock. Find them and pay them.',
        ),
        quiz('Critical moment', 'Which decision deserves the most clock time?', [
          right('A pawn structure commitment that cannot be undone', 'Pawn moves are mortgages. Sign them slowly.'),
          wrong('A forced recapture', 'Forced is forced. One second.'),
          wrong('A standard opening move', 'Theory exists precisely so you do not spend minutes there.'),
        ]),
        quiz('Banking time', 'Move 22 of a calm middlegame: your opponent is in time trouble, you have 14 minutes. Best use of the clock?', [
          right('A long think now: find the plan that creates complexity for his clock', 'Complexity plus his clock is a winning combination.'),
          wrong('Play instantly to seem confident', 'Instant moves waste YOUR surplus and fix nothing.'),
          wrong('Offer trades to simplify for both clocks', 'Simplification relieves the player in time trouble.'),
        ]),
        drill('Routine, not ritual', '7k/8/8/8/8/8/8/R3K3 w - - 0 1', ['Ra5'], 'Time triage in action: this move deserves seconds, not minutes', 'Cutting the king off is routine technique. Play it and bank the time.', 'Ra5 in one glance. The clock goes back in the pocket for the real decisions.'),
        quiz('The endgame bank', 'Why bank clock for the endgame?', [
          right('Technique decisions multiply exactly when the clock is thinnest', 'Conversion is where wins are signed. Arrive funded.'),
          wrong('Endgames are easy and need no time', 'They are easy ONLY with time to verify every tempo.'),
          wrong('To avoid flagging on the last move', 'Flagging is one risk. Wrong technique is the expensive one.'),
        ]),
      ],
    },
    {
      id: 'gm-18',
      n: 18,
      title: 'Grandmaster combinations I',
      subtitle: 'Full depth, full forcing.',
      minutes: 12,
      concepts: ['sacrifice', 'mate', 'calculation'],
      steps: [
        quiz('Retrieval first', 'Why does the endgame deserve banked clock time?', [
          right('Technique decisions multiply while the clock bottoms out', 'Arrive funded or the conversion wobbles.'),
          wrong('Endgames take no thought', 'They take exact thought: tempo by tempo.'),
          wrong('The opponent is more tired by then', 'Maybe. The real reason is your own decision load.'),
        ]),
        text(
          'The deep rep set',
          [
            'Four combinations across the whole tier. See every line to its END before touching a piece.',
            'These positions repeat from earlier levels on purpose: mastery is speed plus certainty on the classics.',
          ],
        ),
        drill('Queen sacrifice mate', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Mate in three', 'Sacrifice, forced reply, open file.', 'Seen, verified, played. The grandmaster rhythm.'),
        drill('Double check entry', '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', ['Nd6+'], 'Open two lines at once', 'The knight departs, the rook fires.', 'Nd6 plus double check. The strongest entry move in chess.'),
        drill('Deflection mate', 'r5k1/5ppp/8/8/8/8/3R4/3R2K1 w - - 0 1', ['Rd8+', 'Rxd8', 'Rxd8#'], 'Back rank, full depth', 'Bait, deflect, execute.', 'Three moves, zero doubts.'),
        drill('Bridge speed run', '8/3P2k1/8/1K6/7R/8/1r6/8 w - - 0 1', ['Rb4', 'Rxb4+', 'Kxb4'], 'Lucena in one move', 'The checking file is b. Build there.', 'Rb4. Speed on the classics is what buys clock time for the rest.'),
      ],
    },
    {
      id: 'gm-19',
      n: 19,
      title: 'Grandmaster combinations II',
      subtitle: 'Multi-motif, endgame finish.',
      minutes: 12,
      concepts: ['sacrifice', 'zugzwang', 'defense'],
      steps: [
        quiz('Retrieval first', 'What is the calculation habit this rep set drills?', [
          right('Seeing every line to its end before the first move', 'The board verifies. The head calculates.'),
          wrong('Speed over depth', 'Speed without certainty is a donation.'),
          wrong('Pattern memory alone', 'Memory finds candidates. Verification finishes them.'),
        ]),
        text(
          'The final rep set',
          [
            'Four last drills, then the capstone. Visualization between drills: replay each finished line with eyes closed.',
          ],
        ),
        drill('Structure strike', '2r1k3/8/8/8/8/2N5/PPP5/2KR4 b - - 0 1', ['Rxc3', 'bxc3'], 'The exchange sacrifice', 'Rook for knight, structure for keeps.', 'Rxc3. Permanent damage, temporary cost.'),
        drill('Zugzwang geometry', '8/2P1k3/2K5/8/8/8/8/8 b - - 0 1', ['Kf8'], 'You are Black in the sealed duel. Every move loses: play the most resilient one', 'The kingside steps last longest: the white king is farthest from them.', 'Kf8. White still wins with exact play, but the kingside walk makes White earn the whole technique. On the queenside the pawn seals everything instantly.'),
        drill('Perpetual road', '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', ['Qd8+', 'Kh7', 'Qd7+', 'Kh6', 'Qd6+', 'Kh5'], 'Salvation by rank checks', 'One file left each check.', 'The eternal checks. Half a point by geometry.'),
        drill('The back rank, one last time', '2r3k1/5ppp/8/8/8/8/1q1R4/3R2K1 w - - 0 1', ['Rd8+', 'Rxd8', 'Rxd8#'], 'His rook guards the back rank; his queen watches the wrong war. Remove the guard first', 'The d-file is open: deflect the guard, then take it.', 'Rd8, Rxd8, Rxd8 mate. Deflection at full depth: see it, verify it, play it. That is the habit the capstone will demand.'),
      ],
    },
    {
      id: 'gm-20',
      n: 20,
      title: 'Capstone',
      subtitle: 'The final game of the curriculum.',
      minutes: 25,
      concepts: ['calculation', 'endgame', 'technique', 'famousGame'],
      steps: [
        quiz('Retrieval first', 'What must Black avoid in a winning king-and-pawn versus king duel?', [
          right('Losing a tempo: every king step must keep the pawn guarded and the cage closed', 'One careless step frees the defending king and the win evaporates.'),
          wrong('Pushing the pawn as fast as possible', 'The pawn waits. The king escorts. Speed spoils zugzwang nets.'),
          wrong('Trading into a rook ending', 'There is nothing to trade. This is pure geometry.'),
        ]),
        text(
          'Everything, one game',
          [
            'The capstone: a full game against the strongest regularly-beatable engine level, with a material goal and a clock of your own attention.',
            'Open with a plan, convert imbalances, prophylax against counterplay, and finish with technique. Everything the last 120 levels taught, in one board.',
          ],
          'One game. One hundred and twenty levels behind it.',
        ),
        text(
          'Game 6: the strategic masterpiece',
          [
            'Reykjavik, 1972. Fischer had never played the Queen\u2019s Gambit in a serious game before this one. Spassky prepared for king pawn attacks and instead got a quiet positional squeeze, the kind of game critics said Fischer could not play. He played it to perfection.',
            'You play White from the middle game. The queen trip from d1 to a4 to a3 has already started, the c-file is half open, and every White move from here adds one small new problem. No sacrifices in this one: this is what a world championship squeeze looks like from the inside.',
          ],
          'Guess Fischer\u2019s moves. The win is patient, not flashy.',
        ),
        gtmStep(
          'The squeeze, move by move',
          [
            'The board shows the position after 15...bxc5. Black\u2019s c-pawn is isolated, the d5 square is weak, and White has the healthier king. Castling, a bishop retreat with a threat, and a knight regroup to d4 come first.',
            'Notice how nothing attacks anything directly for several moves, and Black\u2019s position still gets worse every time. That is the grandmaster skill this tier has been building.',
          ],
          'Robert James Fischer v Boris Spassky, World Championship Game 6, Reykjavik 1972',
          START,
          ['c4','e6','Nf3','d5','d4','Nf6','Nc3','Be7','Bg5','O-O','e3','h6','Bh4','b6','cxd5','Nxd5','Bxe7','Qxe7','Nxd5','exd5','Rc1','Be6','Qa4','c5','Qa3','Rc8','Bb5','a6','dxc5','bxc5'],
          [
            guess('O-O', 'King safety first, always. The king disappears and the rook joins the f-file for the f5 break that comes much later.', { reply: 'Ra7' }),
            guess('Be2', 'The bishop retreats with a threat: it now aims at the knight on c6 through to the rook, so Black must spend a move on defense instead of generating counterplay.', { reply: 'Nd7' }),
            guess('Nd4', 'The famous regrouping. The knight heads for d4, where trading it off removes the best defender of the d5 hole. Quiet moves like this win world championships.', { reply: 'Qf8' }),
            guess('Nxe6', 'The trade the regrouping prepared. After fxe6 the e6 pawn becomes a permanent target and the light squares around Black\u2019s king stay broken.', { reply: 'fxe6' }),
            guess('e4', 'The central break. It claims space, cuts the d4 pawn off from help, and opens the e-file and the d1-h5 diagonal for White\u2019s heavy pieces.', { reply: 'd4' }),
            guess('f4', 'Fixing the kingside and preparing f5. Each advance also takes a square away from a black piece, which is how space converts into pressure.', { reply: 'Qe7' }),
            guess('e5', 'The passed pawn keeps going. It opens the d1-h5 diagonal, cramps Black further, and later the same pawn marches to e6 while the rooks swing to the kingside.', { reply: 'Rb8' }),
          ],
        ),
        text(
          'How it ended',
          [
            'Fischer kept squeezing: 23.Bc4 Kh8 24.Qh3, the break 26.f5, the march 31.e6, and finally 38.Rxf6 smashing the kingside open for the rooks. Spassky resigned after 41.Qf4.',
            'Then chess history: Spassky joined the audience in applauding. The win put Fischer ahead 3.5 to 2.5, and he never trailed in the match again.',
          ],
        ),
        text(
          'Where you go from here',
          [
            'The curriculum is finished, but chess is not. The Analysis tab grades your real games and finds the leak patterns this tier taught you to hunt. The puzzle pool, the bot ladder and the coach chat keep every one of these tools warm.',
            'Reread levels when a pattern gets rusty: retrieval beats re-reading, so take the quizzes again rather than the text. The tier is yours now.',
          ],
          'One hundred and twenty levels done. The board is yours.',
        ),
        drill('One last check', '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re8#'], 'Warm up the forcing-move scan', 'Checks first. One exists.', 'Re8 mate. The scan never retires.'),
        quiz('Curriculum check', 'The single habit that most separates master play from club play is...', [
          right('Asking what the opponent wants before every move', 'Prophylaxis is the master habit. Tactics are the servant.'),
          wrong('Memorizing longer opening lines', 'Lines end. Judgment does not.'),
          wrong('Playing faster than the opponent', 'Speed without accuracy is a donation.'),
        ]),
        playout(
          'The capstone game',
          'Defeat the level 5 engine on material. Full curriculum applied.',
          START,
          'w',
          'Win 3 or more points of material within 20 moves',
          5,
          'material',
          20,
          'Capstone cleared. The curriculum is complete. Now go play real games.',
        ),
      ],
    },
  ],
}
