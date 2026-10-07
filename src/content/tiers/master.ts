// Tier 5: Master. Imbalances, prophylaxis, initiative, deep technique.
import type { Tier } from '../schema'
import { text, demo, quiz, drill, right, wrong, playout, gtmStep, guess } from '../kit'

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
      concepts: ['pawnStructure', 'kingSafety', 'development'],
      steps: [
        quiz('Retrieval first', 'From the Advanced tier: when do you trade the last rooks in a won rook ending?', [
          right('When the resulting pawn endgame is a calculated win', 'Concrete wins only. The final trade must be math, not mood.'),
          wrong('Always: simplification converts automatically', 'A drawn pawn ending erases the whole game.'),
          wrong('Never: rooks win endings', 'Rooks win endings when the pawn ending after the trade is WON.'),
        ]),
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
        quiz('The comparison list', 'Which six imbalances does a master compare before every plan?', [
          right('Material, space, development, king safety, pawn structure, piece activity', 'The six dials. Every position leans one way on some, the other way on the rest.'),
          wrong('Material, luck, rating, time, style, mood', 'Four of those are not on the board.'),
          wrong('Material only: the rest is decoration', 'Material is one dial of six. Plans come from the other five.'),
        ]),
        drill('Cash the activity', 'r5k1/pppq1p1p/6p1/8/6N1/8/PPP2PPP/R3KB1R w - - 0 1', ['Nf6+', 'Kh8', 'Nxd7'], 'Your army owns the board. Convert activity into material', 'One knight hop checks the king and hits the queen at the same time.', 'Nf6, the king steps, Nxd7. The imbalance you own paid cash. That is the whole doctrine, played.'),
      ],
    },
    {
      id: 'ms-02',
      n: 2,
      title: 'Prophylaxis',
      subtitle: 'Ask what he wants. Take it away first.',
      minutes: 10,
      concepts: ['prophylaxis', 'defense'],
      steps: [
        quiz('Retrieval first', 'What are the six imbalances worth comparing in every position?', [
          right('Material, space, development, king safety, structure, activity', 'The six dials of evaluation.'),
          wrong('Material, center, castling, en passant, promotion, draws', 'Half of that is rules, not evaluation.'),
          wrong('Whatever the engine says after ten minutes', 'The engine is a check, not the evaluation habit.'),
        ]),
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
        text(
          'The list of his plans',
          [
            'Before each move, list the enemy\u2019s two or three most concrete ideas: the check he wants, the square he wants, the trade he wants. Ranked by how much they hurt.',
            'If the top idea hurts more than your own best idea helps, your move is already decided: play the prophylaxis. Only when your idea survives his best answer is it safe to commit.',
          ],
          'His best plan, ranked. If it beats yours, take it away first.',
        ),
        quiz('Prophylaxis tempo', 'You spot the enemy\u2019s dangerous plan, but your own attack is also one move from landing. Which do you play?', [
          right('Whichever threat arrives FIRST: count the moves on both clocks honestly', 'Prophylaxis is tempo math, not paranoia. If your hit lands a move sooner, hit first.'), 
          wrong('Always defend: safety over everything', 'Over-defending loses games that one forward move would have won.'),
          wrong('Always attack: the defender must lose eventually', 'Attacks that ignore the counter-threat are how attackers get mated.'),
        ]),
      ],
    },
    {
      id: 'ms-03',
      n: 3,
      title: 'The initiative',
      subtitle: 'Spend material. Buy the tempo that mates.',
      minutes: 10,
      concepts: ['initiative', 'sacrifice', 'tempo'],
      steps: [
        quiz('Retrieval first', 'When is a prophylactic move worth a tempo over your own plan?', [
          right('When his best idea hurts more than your idea helps', 'Kill the bigger threat first. Then execute yours against a parried defense.'),
          wrong('Whenever the move looks impressive', 'Prophylaxis is quiet by nature. The effect is what is impressive.'),
          wrong('Only in lost positions', 'It is a winning habit, not an emergency tool.'),
        ]),
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
        quiz('The forcing test', 'Which of these keeps the initiative alive?', [
          right('A move that gives check or creates an immediate material threat', 'Questions only. Every non-forcing move is a pause, and pauses hand over the baton.'),
          wrong('A solid developing move', 'Development is for openings. Initiative is kept by threats.'),
          wrong('A pawn grab two moves deep', 'Two quiet moves to win a pawn is two free tempi for the defense.'),
        ]),
        quiz('Spending the initiative', 'You can win a clean pawn OR keep a dangerous initiative by spending two pawns. When is the pawn the right call?', [
          right('When the initiative fades after one solid defensive move and the position has no follow-up', 'Initiative is a currency with an expiry date. If the attack dies anyway, take the money and simplify.'), 
          wrong('Never: the initiative is priceless', 'Initiative is worth exactly as much as the threats it creates. No threats, no value.'),
          wrong('Always take the pawn: material is permanent', 'Permanent material behind a shattered kingside is how won games get mated.'),
        ]),
      ],
    },
    {
      id: 'ms-04',
      n: 4,
      title: 'Majorities and the minority attack',
      subtitle: 'Pawn geography decides plans.',
      minutes: 10,
      concepts: ['pawnStructure', 'pawnBreaks'],
      steps: [
        quiz('Retrieval first', 'What keeps an initiative alive, in one sentence?', [
          right('Checks and threats on every move, never two quiet moves in a row', 'The initiative is the right to keep asking questions.'),
          wrong('Extra material on the scoreboard', 'Material can BUY the initiative. It is not the initiative itself.'),
          wrong('More pieces developed', 'Development lead is one source. The initiative lives in forcing moves.'),
        ]),
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
        drill('Roll the majority', '8/5p2/6k1/8/5P1K/6P1/7P/8 w - - 0 1', ['g4'], 'Three pawns against one. Start the march that makes a passer', 'The g-pawn leads, the king escorts, and the f-pawn guards the squares behind.', 'g4. The majority advances and the lone f7 pawn can never catch both runners. Majorities are passers in training, exactly as promised.'),
      ],
    },
    {
      id: 'ms-05',
      n: 5,
      title: 'Permanent versus temporary',
      subtitle: 'Which weaknesses can outlive this attack?',
      minutes: 10,
      concepts: ['pawnStructure', 'initiative'],
      steps: [
        quiz('Retrieval first', 'What does a pawn majority create that a minority attack does not?', [
          right('A passed pawn', 'Majorities make runners. Minorities make files and fixed targets.'),
          wrong('Open files for rooks', 'Minority attacks open files. Majorities make runners.'),
          wrong('Both are identical tools', 'Opposite tools from opposite pawn counts.'),
        ]),
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
        quiz('Classify the weakness', 'A knight is temporarily misplaced, a pawn is doubled, and a rook hangs. Rank their shelf lives.', [
          right('The hanging rook dies first (temporary), the misplaced knight heals, the doubled pawn never heals', 'Pieces are loans, structure is a mortgage. Time horizons decide which you attack.'),
          wrong('All three are permanent', 'Pieces can move. Pawns cannot. That is the whole classification.'),
          wrong('All three are temporary', 'Doubled pawns never merge back. They age forever.'),
        ]),
        drill('Harvest the fresh one', '3k4/8/8/8/8/8/3q4/3R2K1 w - - 0 1', ['Rxd2+'], 'Scan rep first: his queen just wandered next to your rook. Temporary weaknesses expire fast', 'The d-file is open and nothing defends her.', 'Rxd2 with check. The temporary weakness paid today, exactly on schedule. Permanent ones wait; loose pieces never do.'),
      ],
    },
    {
      id: 'ms-06',
      n: 6,
      title: 'Trading with intent',
      subtitle: 'Which pieces stay, which pieces go, and why.',
      minutes: 10,
      concepts: ['tradeDecisions', 'kingSafety'],
      steps: [
        quiz('Retrieval first', 'Which weakness heals with one piece move, and which never heals?', [
          right('A loose piece heals; a doubled or isolated pawn never does', 'Pieces are temporary, structure is permanent. Pawns are the long game.'),
          wrong('Both heal eventually', 'Pawn structure never moves backward. Ever.'),
          wrong('Neither heals: chess is static', 'Pieces redeploy every move. That is why tactics exist.'),
        ]),
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
        quiz('The trade interview', 'What three questions does every candidate trade face?', [
          right('Whose remaining pieces are better, whose king is safer, whose structure survives the endgame', 'A trade is a vote for the next position. Ask about the position that results.'),
          wrong('Who is higher rated, who has more time, who is winning', 'The board decides trades. The scoreboard follows.'),
          wrong('Can I win material with it, is it a check, is it forced', 'Those are tactic questions. Trade questions are positional.'),
        ]),
        quiz('The bad trade habit', 'You are better on the kingside; the enemy owns the only open file with doubled rooks. Your knight can take a rook for a bishop there. Correct?', [
          right('No: every trade feeds their only real asset and dries out yours', 'Trading INTO the opponent\u2019s strength is donating. Trade on your terms, on your side.'), 
          wrong('Yes: even trades are always fine when better', 'Even trades are not neutral: they change which assets remain on the board.'), 
          wrong('Yes, because bishop for rook wins the exchange', 'Winning the exchange on their terms can still lose the game. Read the position, not just the values.'), 
        ]),
      ],
    },
    {
      id: 'ms-07',
      n: 7,
      title: 'Owning the color',
      subtitle: 'Deep color complexes: plan by square color.',
      minutes: 10,
      concepts: ['bishopPair', 'kingSafety'],
      steps: [
        quiz('Retrieval first', 'What are the three questions of every trade?', [
          right('Whose pieces are better, whose king is safer, whose structure endures', 'The resulting position is the only thing a trade buys.'),
          wrong('Is it a capture, is it forced, is it safe', 'That is tactic vocabulary. Trades are positional votes.'),
          wrong('Who wants it more', 'Neither player. The position wants something. Read it.'),
        ]),
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
        drill(
          'Blind him completely',
          '4k3/8/8/8/8/8/1P2BPPP/2B1K3 w - - 0 1',
          ['Bh6'],
          'Black kept only a light-squared bishop. Put yours where he cannot touch it.',
          'One of your bishops has a clear road to the dark heart of the kingside.',
          'Bh6. From the dark squares your bishop attacks g7 and f8 with zero opposition. His light bishop watches from another planet.',
        ),
        quiz('Trading into the complex', 'You own the bishop pair; the enemy kingside is dark-squared weak. Which bishop do you offer to trade?', [
          right('Your light-squared one, keeping your dark bishop as the sole ruler of the complex', 'Keep the piece that feeds on the weakness. Trade away the one with no targets.'), 
          wrong('Your dark-squared one, to prove it is stronger', 'Trading your best piece for their worst hands the dark squares back.'), 
          wrong('Neither: bishops should never be traded', 'The bishop pair is great, but one good bishop beats two unemployed ones.'), 
        ]),
      ],
    },
    {
      id: 'ms-08',
      n: 8,
      title: 'Blockade as a strategy',
      subtitle: 'Passed pawns are prisoners if you hold the square.',
      minutes: 10,
      concepts: ['outposts', 'prophylaxis'],
      steps: [
        quiz('Retrieval first', 'Against a lone light-squared bishop, which squares do you invade?', [
          right('The dark squares: he is blind to every one of them', 'Attack the color the defender cannot police.'),
          wrong('The light squares, to challenge his bishop directly', 'Fighting his one defender head on is his plan, not yours.'),
          wrong('Whatever is closest', 'Color decides. Geography follows.'),
        ]),
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
        quiz('The jailer\u2019s second job', 'Your knight blockades the enemy passer from a strong square. What else should it be doing?', [
          right('Attacking: a blockader on an outpost is also an invader', 'One piece, two jobs: jailer on the pawn\u2019s road, attacker on the rest of the board.'),
          wrong('Nothing: blockading is a full-time job', 'The blockade costs one square, not the whole piece.'),
          wrong('Guarding your own back rank', 'That is a different piece\u2019s job. The blockader attacks.'),
        ]),
        quiz('Lifting the blockade', 'The enemy passer sits on d3, your knight blockades on d3. When is it right to abandon the blockade?', [
          right('When your counterattack mates first or wins more than the promoted queen', 'The blockade serves a plan. When a faster plan exists, the square can fend for itself.'), 
          wrong('Never: a blockade, once set, is permanent', 'Blockades are commitments, not contracts. Re-evaluate every move.'), 
          wrong('Whenever the knight has a better square', 'Better square for WHAT? Without a concrete plan, leaving the passer is suicide.'), 
        ]),
      ],
    },
    {
      id: 'ms-09',
      n: 9,
      title: 'Dynamic versus static',
      subtitle: 'Know when the clock on your advantage expires.',
      minutes: 10,
      concepts: ['initiative', 'pawnStructure'],
      steps: [
        quiz('Retrieval first', 'In Nimzowitsch\u2019s system, what is the order of operations against a passed pawn?', [
          right('Restrain it, blockade it, destroy it', 'Three steps. Skipping to destruction loses to the pieces behind the pawn.'),
          wrong('Blockade it immediately with the queen', 'Blockade yes, but with the right piece, and restraint comes first.'),
          wrong('Attack the king instead: pawns promote by themselves', 'They promote while you attack. The order matters.'),
        ]),
        quiz('Static or dynamic', 'Which advantage ages well: a development lead or a healthy pawn structure?', [
          right('A healthy pawn structure: it is still there in the endgame', 'Structure outlives every lead in tempo. Dynamics expire; statics compound.'),
          wrong('A development lead: tempo is everything', 'Tempo is exactly what evaporates. Spend it or lose it.'),
          wrong('Both age the same', 'One is measured in moves, the other in moves that never come back.'),
        ]),
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
        quiz('Spend or invest', 'Your advantage is a permanent weak square in his camp. Your approach?', [
          right('Invest slowly: improve pieces, plant something on it, build an unanswerable grip', 'Static advantages age well. There is no rush: there is only method.'),
          wrong('Sacrifice immediately to exploit it', 'Sacrifices buy tempo. Static edges do not need tempo: they need patience.'),
          wrong('Trade queens and head to the endgame', 'Only if the endgame keeps the weak square relevant. Otherwise the grip is the win.'),
        ]),
        playout(
          'Spend it now',
          'You start with every weapon you own. Convert your ideas into material before the engine equalizes.',
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
      concepts: ['prophylaxis', 'initiative', 'tradeDecisions'],
      steps: [
        quiz('Retrieval first', 'Which type of advantage must be spent immediately, and which can be invested?', [
          right('Dynamic: spent now. Static: invested for the endgame', 'Development leads expire. Broken structures do not.'),
          wrong('Both keep forever', 'Development leads evaporate while you shuffle.'),
          wrong('Both expire', 'Weak squares wait for you. Development does not.'),
        ]),
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
        drill('Initiative', 'r1b2k1r/ppp1bppp/8/1B1Q4/5q2/8/PPP2PPP/R3R1K1 w - - 0 1', ['Qd8+', 'Bxd8', 'Re8#'], 'Force the mate', 'No free moves for him.', 'Three forcing moves. Initiative paid in full.'),
        drill(
          'Blockade rep',
          '4k3/8/8/8/3p4/8/8/2N1K3 w - - 0 1',
          ['Nd3'],
          'Name the tool, then play it: the pawn wants to run.',
          'The knight has one square on the pawn\u2019s road, and it is a great square.',
          'Nd3. Blockade. The pawn is a prisoner and the knight is the jailer with an outside job.',
        ),
      ],
    },
    {
      id: 'ms-11',
      n: 11,
      title: 'Steering the game',
      subtitle: 'Choose openings by the endgames they promise.',
      minutes: 10,
      concepts: ['endgame', 'development'],
      steps: [
        quiz('Retrieval first', 'Name the five master tools: prophylaxis, trade voting, color invasion, blockade and...', [
          right('The initiative: keeping every move forcing', 'Five tools. Every strong middlegame is one of them running.'),
          wrong('Castling', 'A rule, not a strategic tool.'),
          wrong('The en passant capture', 'Also a rule. Also not a plan.'),
        ]),
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
        quiz('The steering audit', 'How do you find out which structures YOU should steer into?', [
          right('Review your own games and find where you actually win', 'Your results are data. Build the repertoire on your own evidence.'),
          wrong('Copy the world champion\u2019s repertoire', 'His strengths are not yours. His openings serve his skills.'),
          wrong('Play whatever is fashionable this year', 'Fashion serves nobody\u2019s strengths in particular.'),
        ]),
      ],
    },
    {
      id: 'ms-12',
      n: 12,
      title: 'Rook endings deep',
      subtitle: 'Short-side defense, checking distance, the active king.',
      minutes: 12,
      concepts: ['endgame', 'defense', 'kingActivity'],
      steps: [
        quiz('Retrieval first', 'How do you choose which structures to steer your repertoire toward?', [
          right('The ones where your own game results say you win', 'Your games are the data. Steer to your evidence.'),
          wrong('Whatever the strongest engine prefers', 'Engine-best and human-best are different shopping lists.'),
          wrong('The most theoretical lines, for respect', 'Respect does not score points. Results do.'),
        ]),
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
        quiz('Short side, long side', 'Defending a pawn-down rook ending: where do the king and rook belong?', [
          right('King on the short side (away from the checks), rook checking from the long side', 'The attacker\u2019s king cannot hide from checks that come from maximum distance.'),
          wrong('Both on the back rank, passive', 'A passive rook defends nothing. Distance is the defense.'),
          wrong('King in front of the pawn', 'That is the WINNING side\u2019s setup. The defender stands elsewhere.'),
        ]),
      ],
    },
    {
      id: 'ms-13',
      n: 13,
      title: 'Fortresses',
      subtitle: 'Positions that cannot be cracked, no matter what.',
      minutes: 10,
      concepts: ['endgame', 'defense', 'technique'],
      steps: [
        quiz('Retrieval first', 'In a pawn-down rook ending, where do the defending king and rook go?', [
          right('King short side, rook checks from the long side, three files or more away', 'Maximum distance keeps the checks unblockable and the draw alive.'),
          wrong('Both hug the back rank quietly', 'Passivity loses. The rook must WORK for the draw.'),
          wrong('The king escorts the enemy pawn', 'That is the attacker\u2019s technique. The defender runs the checking machine.'),
        ]),
        text(
          'The unbreakable wall',
          [
            'A fortress is a position where the stronger side\u2019s extra material simply cannot be converted: the pieces and pawns form a shape no invasion can breach. A rook against a cornered king, a sealing knight and two sheltered pawns is the everyday example.',
            'Two fortress skills: BUILDING them when defending (choose the wall before the pieces arrive), and RECOGNIZING them when attacking, so you trade into a real endgame instead of beating your head on the wall.',
          ],
          'Some walls do not fall. Recognize them, do not rent a ladder.',
        ),
        demo('The everyday wall', ['Black owns the only big piece, and it can never cash it: the king is tucked in the corner, a knight seals the back rank, and pawns on a2 and b2 seal the corner. Every capture and every check loses the rook on the spot, and there is no zugzwang to farm. A draw with certainty, not with luck.'], 'r6k/8/8/8/8/8/PP6/KN6 w - - 0 1', {
          marks: [
            { square: 'b1', color: 'green' },
            { square: 'a2', color: 'green' },
            { square: 'b2', color: 'green' },
          ],
          caption: 'Green: the wall. Knight seals the rank, pawns seal the corner.',
        }),
        quiz('Fortress verdict', 'You are up a rook. The defender tucks the king into the corner, plants a knight on b1 and pawns on a2 and b2. Result with best play?', [
          right('Draw: every capture and every check costs the rook, and there is no zugzwang', 'No invasion square, no way to take a pawn and keep the rook, no way to pass a move. Take the half point and move on.'),
          wrong('Win: material is material', 'Material only converts when the position lets you use it.'),
          wrong('Win by zugzwang', 'The rook has spare tempi; the wall has none to give. No zugzwang exists here.'),
        ]),
        quiz('Building a fortress', 'You are DEFENDING a pawn down. When should fortress thinking start?', [
          right('Before the attackers arrive: choose the wall shape and king placement early', 'Fortresses are built in advance. Improvised walls crumble.'),
          wrong('Only when the position is already hopeless', 'Hopeless is too late. The wall needs moves to build.'),
          wrong('Never, fortresses are luck', 'Fortresses are technique. Books are written about them.'),
        ]),
        playout('Hold the wall', 'You are the wall. The engine brings the rook; the geometry answers. Keep the seal and the half point is guaranteed.', 'r6k/8/8/8/8/8/PP6/KN6 w - - 0 1', 'w', 'Hold the draw for 10 moves', 3, 'draw', 10, 'The rook checked, probed and waited. The wall did not care.', 'If the knight ever leaves b1 for long, the back rank opens and the checks arrive. Keep the seal.', 'Only the knight moves: hop it out to a3 or c3 (the b2 pawn guards both) and back to b1. Never d2: the rook owns that file. The king and pawns never shift.'),
      ],
    },
    {
      id: 'ms-14',
      n: 14,
      title: 'Opposite bishops, mastered',
      subtitle: 'The outside passed pawn doctrine.',
      minutes: 12,
      concepts: ['endgame', 'promotion'],
      steps: [
        quiz('Retrieval first', 'When does fortress thinking begin for the defender?', [
          right('Before the attackers arrive', 'Walls are built in advance. Improvised ones crumble.'),
          wrong('When the position is lost', 'Lost is too late. The wall takes moves to construct.'),
          wrong('Fortresses cannot be planned', 'They are among the most studied structures in endgame theory.'),
        ]),
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
        quiz('Where the bishop lives', 'As the DEFENDER with opposite bishops, where does your bishop take up residence?', [
          right('On the color complex where the dangerous pawn lives, abandoning the other color', 'Half a board is defensible. Trying for all of it loses all of it.'),
          wrong('Center: it sees everything from there', 'A central bishop defends neither complex fully. Commit to one color.'),
          wrong('Next to your king', 'King safety is irrelevant when the pawns are the whole war.'),
        ]),
      ],
    },
    {
      id: 'ms-15',
      n: 15,
      title: 'The opposite-side storm',
      subtitle: 'Racing pawns with everything on the line.',
      minutes: 12,
      concepts: ['kingSafety', 'pawnBreaks', 'initiative'],
      steps: [
        quiz('Retrieval first', 'As the defender in an opposite-bishop ending, where does your bishop live?', [
          right('On the color of the dangerous pawn, abandoning the other color', 'Commit to one complex. Half a board is holdable.'),
          wrong('Centered, to cover both colors', 'A bishop covering two colors defends neither.'),
          wrong('Wherever it attacks most pawns', 'Attack is irrelevant. The runner is the whole story.'),
        ]),
        text(
          'The race doctrine',
          [
            'Opposite-side castling removes the brakes: both players storm, and the game is decided by WHO OPENS THE FILE FIRST and whose pieces arrive through it. Defense is almost impossible; the correct strategy is to be one tempo faster.',
            'Rule of the race: every pawn move must either advance the storm or slow their storm. Quiet development is a donation. If you have committed to the race, count tempi like cash.',
          ],
          'Count tempi like cash. The first open file wins.',
        ),
        drill('Roll the storm', 'r1bq1rk1/ppp2ppp/2n2n2/3p4/3P4/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 9', ['h4'], 'The kings are on opposite wings. Start the race', 'The h-pawn leads. Every move counts now.', 'h4. The race is on. h5 comes next, then the rook lifts. Count his tempi and stay ahead.'),
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
        quiz('Slowing their storm', 'Their pawn storm is one move faster than yours. Which moves count double now?', [
          right('Moves that BOTH advance your storm and slow theirs', 'In races, dual-purpose tempi are gold: h4 that hits their h5 pawn beats a quiet rook move.'),
          wrong('Pure attack moves on your side', 'If they open their file first, your attack never arrives.'),
          wrong('Defensive king moves', 'The king was castled for a reason. The race decides before he matters.'),
        ]),
      ],
    },
    {
      id: 'ms-16',
      n: 16,
      title: 'Difficult defense',
      subtitle: 'Staying alive with activity, not hope.',
      minutes: 12,
      concepts: ['defense', 'tradeDecisions', 'pieceActivity'],
      steps: [
        quiz('Retrieval first', 'Where do the heavy pieces go in an opposite-side castling race?', [
          right('Behind the storming pawns, ready for the first opened file', 'Pawns open the door. Rooks and queen walk through it.'),
          wrong('Defending your own king', 'You castled opposite wings. The plan is the race, not the shelter.'),
          wrong('Maneuvering in the center', 'The center is a sideshow when the wings are racing.'),
        ]),
        quiz('Retrieval first', 'In an opposite-wing race, which moves count double?', [
          right('Moves that advance your storm AND slow theirs', 'Dual-purpose tempi decide sprints.'),
          wrong('Quiet improving moves', 'Quiet moves are donations in a race.'),
          wrong('King safety moves', 'The race ends the king\u2019s relevance either way.'),
        ]),
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
        quiz('The one counter-threat', 'You are worse but not lost. How many concrete counter-threats should active defense create?', [
          right('One: a single real threat forces the attacker to spend tempo deciding', 'One threat is annoying. Five vague ideas are noise the attacker ignores.'),
          wrong('As many as possible, everywhere', 'Vague multiplicity is passive defense wearing a costume.'),
          wrong('None: pure defense is stronger', 'Pure defense loses slowly. One threat forces decisions.'),
        ]),
      ],
    },
    {
      id: 'ms-17',
      n: 17,
      title: 'Clock and mind',
      subtitle: 'Practical decisions: time, tilt, and tempo bluffs.',
      minutes: 10,
      concepts: ['tempo', 'calculation'],
      steps: [
        quiz('Retrieval first', 'What is the shape of correct active defense?', [
          right('Trade pieces, create one concrete counter-threat, force him to prove the win', 'Annoying, concrete, alive. Hope is none of those.'),
          wrong('Defend everything passively and wait', 'Passive defense is a slow resignation.'),
          wrong('Counterattack everywhere at once', 'Scattered counterplay is ignored. One real threat is not.'),
        ]),
        text(
          'The invisible pieces',
          [
            'Time is a resource with its own tactics: spend minutes on critical branches (captures, pawn structure decisions, king safety) and seconds on forced or obviously bad alternatives. Decide BEFORE your clock bleeds, not after.',
            'Tilt is the most expensive piece on the board. After a mistake, the losing move is the immediate aggressive compensation attempt. The correct move is the most solid one: stabilize first, the position does not know your feelings.',
          ],
          'Spend minutes on branches, seconds on forced moves, zero on emotions.',
        ),
        quiz('The spending rule', 'Which moments earn your clock minutes?', [
          right('Branching capture decisions, structure commitments, king safety choices', 'Irreversible forks in the road. Everything else gets seconds.'),
          wrong('Every move equally, for consistency', 'Equal spending is unequal thinking. Critical moves eat the budget.'),
          wrong('Only when the position looks lost', 'By then the budget is gone. Spend where the branches are.'),
        ]),
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
        quiz('Retrieval first', 'What earns the big clock investments?', [
          right('Irreversible decisions: captures, structures, king safety', 'Forks in the road. Forced and trivial moves get seconds.'),
          wrong('Every move gets equal time', 'Equal spending means the critical branch ran out of budget.'),
          wrong('Only endgame technique moves', 'The middlegame branches are where games are decided.'),
        ]),
      ],
    },
    {
      id: 'ms-18',
      n: 18,
      title: 'Practice arena: master tactics I',
      subtitle: 'Deep combinations, verified.',
      minutes: 12,
      concepts: ['sacrifice', 'mate', 'calculation'],
      steps: [
        quiz('Retrieval first', 'Which moments justify burning clock minutes?', [
          right('Irreversible branch points: captures, structures, king safety', 'Everything else runs on seconds.'),
          wrong('All moves equally', 'Equal spending starves the critical branch.'),
          wrong('Only the endgame', 'Middlegame branches decide most games.'),
        ]),
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
        drill(
          'Skewer to the end of the line',
          '8/8/8/6kq/8/8/8/R5K1 w - - 0 1',
          ['Ra5+', 'Kf6', 'Rxh5'],
          'Calculate the whole line before touching a piece.',
          'Check along the rank, king steps off, collect what hid behind him.',
          'Three plies, fully verified before the first move. That is the master habit: finish the line in your head.',
        ),
      ],
    },
    {
      id: 'ms-19',
      n: 19,
      title: 'Practice arena: master tactics II',
      subtitle: 'Multi-motif, full depth.',
      minutes: 12,
      concepts: ['calculation', 'discoveredAttack', 'defense'],
      steps: [
        quiz('Retrieval first', 'What is the master calculation habit this arena trains?', [
          right('Finishing the entire line in your head before touching a piece', 'The board is for verification, not for discovery.'),
          wrong('Playing fast and trusting instinct', 'Instinct proposes. Calculation disposes.'),
          wrong('Counting material after each move on the board', 'Moving to see is how lines get abandoned halfway.'),
        ]),
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
        drill(
          'The zwischenzug at depth',
          'r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4',
          ['Qg5'],
          'The classic refusal, one more rep. Do not recapture.',
          'One square hits the e5 knight and the g2 pawn at once.',
          'Qg5. The zwischenzug is the deepest habit on this list: it lives exactly where attention does not.',
        ),
      ],
    },
    {
      id: 'ms-20',
      n: 20,
      title: 'Master graduation',
      subtitle: 'One famous combination, one exam, one game.',
      minutes: 20,
      concepts: ['calculation', 'endgame', 'famousGame'],
      steps: [
        quiz('Retrieval first', 'Where does the zwischenzug live?', [
          right('In the moment after a capture, when everyone plays automatically', 'The intermediate move is the deepest practical habit in tactics.'),
          wrong('Only in opening traps', 'It fires on move 40 as often as move 4.'),
          wrong('In endgames only', 'It is a forcing-move habit. Every phase has forcing moves.'),
        ]),
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
        text(
          'Kasparov\u2019s Immortal',
          [
            'Wijk aan Zee, 1999. Kasparov, as White against Topalov, opens with a pawn storm, and on move 24 finds a rook sacrifice that starts one of the longest king hunts ever played. Seven forcing moves in a row, every one of them either a check, a capture, or the only move that keeps the trap closed.',
            'You play White from the position after 23...Qd6. Topalov\u2019s king sits on a7 behind its own pawns. Each of your moves marches it one square closer to the edge of the board.',
          ],
          'Guess the champion\u2019s moves before you play them.',
        ),
        gtmStep(
          'The king hunt',
          [
            'The rook on d4 is the famous offer. Take the king\u2019s road seriously: a7, b6, a5, a4, a3. Your checks are not random, they are a fence moving with him.',
            'Watch for the quiet fifth move: after four checks, the strongest move in the sequence does not check at all.',
          ],
          'Garry Kasparov v Veselin Topalov, Wijk aan Zee 1999',
          START,
          ['e4','d6','d4','Nf6','Nc3','g6','Be3','Bg7','Qd2','c6','f3','b5','Nge2','Nbd7','Bh6','Bxh6','Qxh6','Bb7','a3','e5','O-O-O','Qe7','Kb1','a6','Nc1','O-O-O','Nb3','exd4','Rxd4','c5','Rd1','Nb6','g3','Kb8','Na5','Ba8','Bh3','d5','Qf4+','Ka7','Rhe1','d4','Nd5','Nbxd5','exd5','Qd6'],
          [
            guess('Rxd4', 'The rook offers itself for a pawn. Accepting opens every diagonal and file at once; declining leaves White with Qxf7 ideas and a wrecked kingside. Topalov accepted, and years later called accepting suicide.', { reply: 'cxd4' }),
            guess('Re7+', 'The rook check that cuts the 7th rank. The king must step toward the open board, and the bishop on b7 stays buried behind its own army.', { reply: 'Kb6' }),
            guess('Qxd4+', 'Queen check along the 4th rank, and it also eyes the a5 knight, so the king keeps walking.', { reply: 'Kxa5' }),
            guess('b4+', 'A plain pawn push that checks and fences. The king cannot go back: b6, b5 and a6 are all covered by White\u2019s pieces.', { reply: 'Ka4' }),
            guess('Qc3', 'The silent star of the combination. No check, but it threatens b3 with mate ideas and forces the black queen to abandon the a8 bishop.', { reply: 'Qxd5' }),
            guess('Ra7', 'The rook invades the 7th rank, pinning the bishop to its own camp. Black has no time to consolidate.', { reply: 'Bb7' }),
            guess('Rxb7', 'The bishop falls. Recapturing with the queen runs into Qb3 mate, so the queen must leave the corner for good.', { reply: 'Qc4' }),
            guess('Qxf6', 'The queen collects the last knight, guards a1 against the rook, and the king runs to a3 to dodge the checks. White has queen for two pieces and a winning attack.', { reply: 'Kxa3' }),
          ],
        ),
        text(
          'How it ended',
          [
            'Kasparov drove the king home: 32.Qxa6+ Kxb4 33.c3+ Kxc3 34.Qa1+ Kd2 35.Qb2+ Kd1 36.Bf1 Rd2, then 37.Rd7 pinned the rook so the queen could be collected: 38.Bxc4 bxc4 39.Qxh8. Topalov resigned on move 44.',
            'What made it work: every check also captured something or took away the only flight square, so Black never got a free tempo. Forcing does not mean blind. It means each move keeps the fence closed.',
          ],
        ),
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
