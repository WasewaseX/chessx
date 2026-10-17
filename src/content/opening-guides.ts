// Curated opening guides for the Tools view. Every line here is ordinary
// public theory (main lines and well-known sidelines), not puzzle content —
// safe to ship to the client. All SAN arrays were replay-validated with
// chess.js from the starting position.

export interface OpeningVariation {
  name: string
  /** Full SAN line from the starting position. */
  moves: string[]
  /** One or two sentences: what this line is trying to do. */
  idea: string
}

export interface OpeningGuide {
  slug: string
  name: string
  /** ECO code, e.g. "B20". */
  eco: string
  /** Who this guide primarily helps. */
  side: 'white' | 'black' | 'either'
  /** Main line in SAN, 8-12 plies. */
  moves: string[]
  /** The one-paragraph point of the opening. */
  idea: string
  /** Up to four key branches with the idea behind each. */
  variations: OpeningVariation[]
  /** Plan for White in this opening. */
  whiteStrategy: string
  /** Plan for Black in this opening. */
  blackStrategy: string
  strengths: string[]
  weaknesses: string[]
}

export const OPENING_GUIDES: OpeningGuide[] = [
  {
    slug: 'italian-game',
    name: 'Italian Game',
    eco: 'C50',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    idea:
      'The oldest opening in chess and still one of the soundest: a pawn on e4, a bishop aimed at f7, and a patient build-up. Modern play keeps the central tension ("Giuoco Pianissimo") and manoeuvres for a kingside attack many moves later.',
    variations: [
      {
        name: 'Giuoco Piano',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'],
        idea: 'White opens the centre at once with d4; the game becomes sharp and forcing around the d4/e5 pawns.',
      },
      {
        name: 'Two Knights Defense',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5', 'c3', 'd6', 'O-O'],
        idea: 'Black counter-attacks e4 with the knight instead of developing the bishop. White answers quietly with d3, keeping d4 and a later Ng5 in reserve.',
      },
      {
        name: 'Evans Gambit',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4'],
        idea: 'A pawn is offered to build the biggest centre possible. Even today a well-prepared Evans wins club games by storm.',
      },
      {
        name: 'Hungarian Defense',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Be7', 'd4', 'exd4', 'Nxd4'],
        idea: 'Black plays a passive ...Be7 and dares White to prove an edge. White takes the centre with d4 and enjoys freer play.',
      },
    ],
    whiteStrategy:
      'Build the classic e4-d3-c3 pawn trio, castle short, then expand with Re1, a4 and d4 at the right moment. The dark-squared bishop belongs on e3 or b3; look for a kingside break once the centre is secure.',
    blackStrategy:
      'Match development, keep the light-squared bishop active on c5 or b6, and meet d4 with ...exd4 followed by ...Bb4+ or a quick ...d5. Counter in the centre the moment White overextends on the flank.',
    strengths: ['Safest way to reach a healthy open game', 'A huge body of reliable theory', 'Suits attacking and positional players alike'],
    weaknesses: ['Slow lines require patience and manoeuvring', 'Well-prepared Black reaches comfortable positions'],
  },
  {
    slug: 'sicilian-defense',
    name: 'Sicilian Defense',
    eco: 'B20',
    side: 'black',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6'],
    idea:
      'The most popular response to 1.e4 at every level. Black trades a flank pawn for a centre pawn and plays for a win with the extra central presence and the semi-open c-file.',
    variations: [
      {
        name: 'Najdorf',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
        idea: 'The weapon of Fischer and Kasparov. ...a6 controls b5 and prepares ...e5 or ...e6 with maximum flexibility.',
      },
      {
        name: 'Dragon',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'],
        idea: 'Black fianchettoes on g7 and bosses the long diagonal. Extremely sharp — the Yugoslav Attack features opposite-side castling races.',
      },
      {
        name: 'Classical',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6'],
        idea: 'Solid and direct: pressure on d4 with pieces, ...Bg7 and ...O-O, and the semi-open c-file as the main highway.',
      },
      {
        name: 'Alapin (2.c3)',
        moves: ['e4', 'c5', 'c3', 'd5', 'exd5', 'Qxd5', 'd4', 'Nf6'],
        idea: 'White sidesteps open theory and stakes the centre with d4. Black must develop quickly or the exposed queen on d5 becomes a target.',
      },
    ],
    blackStrategy:
      'Pick a system and learn its pawn structures: exchange on d4, develop with tempo (...Nf6, ...Nc6 or ...a6/...g6), castle, and fight for the c-file or the d5 square. Counter in the centre with ...d5 or ...e5 breaks.',
    whiteStrategy:
      'Claim the bigger centre with d4 and Nc3, then choose your attack: a kingside pawn storm (Be3, f3, g4) or restraint with Be2/O-O lines. The d4 pawn is the anchor of the whole position — never let it drop without compensation.',
    strengths: ['The best practical winning score for Black against 1.e4', 'Rich, well-mapped theory for every taste', 'Unbalanced positions create real winning chances'],
    weaknesses: ['A massive amount of theory to master', 'Early structural commitments can be attacked', 'White’s initiative must be respected in Dragon-type lines'],
  },
  {
    slug: 'french-defense',
    name: 'French Defense',
    eco: 'C00',
    side: 'black',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3'],
    idea:
      'Black challenges e4 with a supported ...d5 and accepts a slightly cramped but structurally sound game. The famous light-squared bishop problem is the price; central counterplay is the compensation.',
    variations: [
      {
        name: 'Winawer',
        moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7'],
        idea: 'The pin on c3 defines the fight: Black gives up the bishop pair to wreck White’s pawns and gnaw at them with ...c5 and ...Qc7.',
      },
      {
        name: 'Classical (Steinitz)',
        moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'],
        idea: 'The purest form: direct central tension. Black develops normally and prepares ...Nbd7, ...Be7 and ...O-O.',
      },
      {
        name: 'Tarrasch (3.Nd2)',
        moves: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'Nf6', 'e5', 'Nfd7'],
        idea: 'White avoids the Winawer pin by recapturing on e4 with the knight. Play is strategic; Black often gains the bishop pair after ...Bxd2+.',
      },
      {
        name: 'Advance',
        moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6'],
        idea: 'A space race: White locks the centre and attacks on the kingside while Black undermines from the queenside with ...c5 and ...f6.',
      },
    ],
    blackStrategy:
      'Understand the pawn chain: attack d4 with ...c5 and ...Nc6 or ...f6, and solve the light-squared bishop with ...b6/...Ba6 or a ...Bd7-e8-g6 trade. The half-open files belong to you.',
    whiteStrategy:
      'Space comes from the e5 wedge: Nf3, Bd3, O-O, then f4-f5 or Nbd2-Nc4 plans. In Winawer structures keep the pawns together and aim at the dark squares left weak around c3.',
    strengths: ['Very solid — hard to blow off the board', 'Clear strategic plans on both sides', 'Excellent practical scores for Black at club level'],
    weaknesses: ['The "problem bishop" on c8', 'White gets extra space in most lines', 'Endgames with the light-squared bishop locked in are grim'],
  },
  {
    slug: 'caro-kann',
    name: 'Caro-Kann Defense',
    eco: 'B10',
    side: 'black',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6'],
    idea:
      'All the solidity of the French without the bad bishop: Black challenges e4 with ...d5 but develops the light-squared bishop outside the pawn chain first.',
    variations: [
      {
        name: 'Classical',
        moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],
        idea: 'The purest Caro-Kann: the bishop gets out before ...e6, and Black reaches a healthy, compact position with a clear plan.',
      },
      {
        name: 'Advance',
        moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'],
        idea: 'White gains space; Black grabs the light squares, hits the e5 chain with ...c5 and ...Qb6, and plays for the endgame.',
      },
      {
        name: 'Exchange',
        moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'],
        idea: 'A drawish-looking structure where real play revolves around open-line usage — White’s piece activity against Black’s sound pawns.',
      },
      {
        name: 'Panov-Botvinnik Attack',
        moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'e6'],
        idea: 'White reaches an isolated-queen-pawn structure with fast development — sharp middlegames where the d5 pawn generates initiative.',
      },
    ],
    blackStrategy:
      'Develop the light-squared bishop early, castle, and aim for ...c5 breaks in Advance structures or smooth equality in the Classical. Endgames are your friend — the structure rarely leaves holes.',
    whiteStrategy:
      'In the Classical, gain space with h4-h5 or develop with Nf3/Be2 for small structural edges. In the Panov, use the isolated pawn for rapid piece play toward f7 and d5.',
    strengths: ['Rock-solid and easy to set up', 'No chronically bad bishop, unlike the French', 'Scales well: safe for beginners, deep for masters'],
    weaknesses: ['Few immediate winning attempts as Black', 'Advance structures can be squeezed for space', 'White has many anti-Caro systems to prepare'],
  },
  {
    slug: 'london-system',
    name: 'London System',
    eco: 'D02',
    side: 'white',
    moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6'],
    idea:
      'A complete system against almost anything: d4, Bf4, e3, Nf3, c3, Bd3, Nbd2, then a kingside build-up. Theory-light and structure-stable — the reason club players love it.',
    variations: [
      {
        name: 'Main Line vs ...c5',
        moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3'],
        idea: 'White keeps the centre compact, answers the ...c5 strike with c3, and only then commits to Nbd2, Bd3 and the kingside plan.',
      },
      {
        name: 'vs King’s Indian Setup',
        moves: ['d4', 'Nf6', 'Bf4', 'g6', 'Nc3', 'd5'],
        idea: 'Against the fianchetto, White develops naturally and neutralises the g7 bishop with the dark-squared trade or h4-h5 ideas after Nge2.',
      },
      {
        name: 'Torre Transposition',
        moves: ['d4', 'Nf6', 'Nf3', 'g6', 'Bf4', 'Bg7', 'Nbd2'],
        idea: 'The Torre Attack (Nf3 + Bf4) reaches identical structures and adds move-order flexibility against ...g6 setups.',
      },
      {
        name: 'vs Early ...Qb6',
        moves: ['d4', 'd5', 'Bf4', 'c5', 'e3', 'Nc6', 'c3', 'Qb6'],
        idea: 'Black hits b2 and f4 at once. White answers with Qb3 — exact knowledge pays off in this line.',
      },
    ],
    whiteStrategy:
      'Complete the setup (Bd3, Nbd2, O-O, h3, Re1), then choose: Ne5-f4-h4 kingside play, or a c4 break if Black overcommits on the queenside. Trade the Bf4 for a dark-squared bishop whenever it eases your structure.',
    blackStrategy:
      'Get ...c5 or ...e5 in early, develop with tempo, and target the Bf4 or the b2/d4 points it abandons. The ...Bd6 trade offer and ...Qb6 pressure are the standard equalising tries.',
    strengths: ['Minimal theory, maximum system', 'Very solid; hard to attack directly', 'The same plans work against nearly everything'],
    weaknesses: ['Predictable — prepared opponents know the antidotes', 'Can lead to sterile positions', 'Slow kingside attacks give Black free rein on the queenside'],
  },
  {
    slug: 'queens-gambit',
    name: "Queen's Gambit",
    eco: 'D06',
    side: 'white',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bg5', 'O-O'],
    idea:
      'The classical way to fight for the centre: c4 undermines d5 and builds the strongest pawn duo in chess. The "gambit" pawn on c4 is rarely really free — it is a bid for lasting central control.',
    variations: [
      {
        name: 'QGD Orthodox',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7'],
        idea: 'The main classical defence: Black untangles with ...Be7, ...O-O and ...Nbd7, then hits the centre with ...dxc4 and ...c5 or ...e5 breaks.',
      },
      {
        name: 'Queen’s Gambit Accepted',
        moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4'],
        idea: 'Black grabs the pawn and tries to hold it with ...b5 or ...a6; White develops fast, regains it, and keeps a big centre.',
      },
      {
        name: 'Slav Defense',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4'],
        idea: 'Black supports d5 with ...c6, keeping the bishop free. Taking on c4 is safe because ...b5 holds the pawn.',
      },
      {
        name: 'Tarrasch Defense',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'exd5', 'Nf3', 'Nc6'],
        idea: 'Black accepts an isolated d5 pawn for huge piece activity and open lines — a fighter’s choice.',
      },
    ],
    whiteStrategy:
      'Complete development with Nf3, Nc3, Bg5/e3, Bd3 and O-O; resolve the c4 tension on your own terms. Play the minority attack (b4-b5) in Carlsbad structures or central breaks with e4.',
    blackStrategy:
      'Untangle the light-squared bishop (...b6/...Bb7 or ...Bd6), castle, and strike the centre with ...c5 or ...e5 at the right moment. In the QGA, return the pawn for time when needed.',
    strengths: ['The soundest way to fight for an edge with 1.d4', 'Endless strategic depth that rewards study', 'Every defence has a clear anti-plan to learn'],
    weaknesses: ['Converting the small edges needs real positional skill', 'Black has ultra-solid defences (Slav, Orthodox)', 'Careless play drifts into sterile symmetries'],
  },
  {
    slug: 'kings-indian-defense',
    name: "King's Indian Defense",
    eco: 'E60',
    side: 'black',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
    idea:
      'Black concedes the centre on purpose, fianchettoes, castles, and then detonates the position with ...e5 or ...c5 counterstrikes. The classic hypermodern defence for players who want to win.',
    variations: [
      {
        name: 'Classical (Mar del Plata)',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
        idea: 'The centre closes and the great race begins: White storms the kingside with g4-f5 while Black breaks through on the queenside with ...c5 and ...b5.',
      },
      {
        name: 'Sämisch',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'f3'],
        idea: 'White locks e4 and d4 behind a f3 pawn and plays Be3, Qd2, O-O-O for a slow but brutal h4-g4 pawn storm.',
      },
      {
        name: 'Four Pawns Attack',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'f4', 'O-O'],
        idea: 'White grabs maximum space at once; Black hits back with ...c5 and ...Qa5 against the overextended centre.',
      },
      {
        name: 'Fianchetto System',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'Bg7', 'g3'],
        idea: 'White mirrors the fianchetto (g3, Bg2) and keeps the centre fluid — positional, less forcing, and famously hard to break.',
      },
    ],
    blackStrategy:
      'Finish the setup fast (Bg7, O-O, d6, Nbd7), then strike: ...e5 in Classical structures or ...c5 against the Sämisch. In the Mar del Plata, queenside play must beat White’s kingside storm on pure speed.',
    whiteStrategy:
      'Claim the whole centre with e4 and d4, pick your attack plan (Sämisch storm, Classical c5 clamp, Fianchetto restraint), and never open the g7 bishop’s diagonal carelessly.',
    strengths: ['A fighting chance for a win in every line', 'Clear, learnable attacking plans', 'Scores well at club level, where attacks land'],
    weaknesses: ['Structurally risky — White can clamp and squeeze', 'Mar del Plata theory runs 30+ moves deep', 'One mistimed break and the centre turns against you'],
  },
  {
    slug: 'nimzo-indian',
    name: 'Nimzo-Indian Defense',
    eco: 'E20',
    side: 'either',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O', 'Bd3', 'd5', 'Nf3', 'c5'],
    idea:
      'The gold standard of chess openings: Black pins the knight, fights for e4, and trades the bishop for structural concessions at the moment of maximum effect. Used by every world champion of the last century.',
    variations: [
      {
        name: 'Rubinstein (4.e3)',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3'],
        idea: 'White keeps things flexible and solid; Black completes development and chooses between ...d5, ...c5 or ...b6 setups.',
      },
      {
        name: 'Classical (4.Qc2)',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'Qc2'],
        idea: 'White un-pins, defends e4 and avoids doubled c-pawns. The strategies revolve around a central e4 expansion.',
      },
      {
        name: 'Sämisch',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+', 'bxc3'],
        idea: 'White wins the bishop pair but accepts doubled c-pawns. Black aims for ...c5 and ...d5 to permanently restrict those pawns.',
      },
      {
        name: 'Black’s ...c5 plan',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'c5'],
        idea: 'Striking the centre at once, heading for IQP or hanging-pawn structures where Black’s pieces flourish.',
      },
    ],
    blackStrategy:
      'Trade Bxc3 exactly when it hurts (after a3, or when the doubling matters), control e4 with ...d5 or ...c5, and finish development quickly. The bishop pair is your compensation bank — spend it wisely.',
    whiteStrategy:
      'Decide early: bishop pair (a3/Sämisch structures) or the centre (Qc2, e3 setups)? Convert either the dark-square holes around c3/d4 or the bishop pair into the long-term winning attempt.',
    strengths: ['Impeccably sound — no tactical refutation exists', 'Fights for e4 immediately', 'Rich strategic variety for both sides'],
    weaknesses: ['Real fighting chances need deep theory', 'White can sidestep with 3.Nf3 or 3.g3', 'Black must handle many different structures well'],
  },
  {
    slug: 'ruy-lopez',
    name: 'Ruy Lopez',
    eco: 'C60',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'],
    idea:
      'The Spanish Game — chess’s main highway for 150 years. The bishop pressures the knight defending e5, and White builds slow, crushing central and kingside pressure.',
    variations: [
      {
        name: 'Morphy Defense',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
        idea: 'The main answer: ...a6 kicks the bishop and prepares ...b5, breaking the e5 pressure at its root.',
      },
      {
        name: 'Berlin Defense',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'],
        idea: 'Kramnik’s famous wall against Kasparov: Black gives up the centre pawns for the "Berlin endgame" and its lasting light-square strength.',
      },
      {
        name: 'Exchange Variation',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6'],
        idea: 'White wrecks Black’s pawn structure for a long structural squeeze — slow, safe, and still dangerous.',
      },
      {
        name: 'Classical (3...Bc5)',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Bc5'],
        idea: 'Black ignores the pin and develops naturally. Direct, fighting play where White’s c3 and d4 meet ...Na5 or ...f5 counter-ideas.',
      },
    ],
    whiteStrategy:
      'Follow the classic recipe: c3 and d4 (or Re1 and the Nbd2-f1-g3 knight tour). The b5-a4 pin chain, the e5 weakness and kingside space are the permanent assets to milk.',
    blackStrategy:
      'Resolve the e5 tension cleanly: support with ...b5/...d6 and castle fast, or strike with ...d5 in the right lines. Route the light-squared bishop via ...b7 or ...a6-b7; the c-file often becomes yours.',
    strengths: ['Maximum sound pressure from White’s oldest try', 'Proven up to the absolute top level', 'Deep plans reward serious study'],
    weaknesses: ['An enormous theoretical load (Berlin, Closed lines)', 'Slow build-ups demand real positional skill', 'Black’s best defences hold in many lines'],
  },
  {
    slug: 'scandinavian-defense',
    name: 'Scandinavian Defense',
    eco: 'B01',
    side: 'black',
    moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6'],
    idea:
      'The fastest central challenge to 1.e4. Black trades ...d5, gets the queen out early, and finishes development with zero pawn weaknesses — practical, direct, and easy to remember.',
    variations: [
      {
        name: 'Main Line (3...Qa5)',
        moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'],
        idea: 'The queen steps to a5, eyeing the queenside and escaping the tempo hits. Solid and fully playable.',
      },
      {
        name: '3...Qd6 (Gubinsky-Melts)',
        moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6'],
        idea: 'A modern favourite: the queen develops flexibly, avoiding White’s harassing options like Bb5 or Nb5 ideas.',
      },
      {
        name: 'Modern 2...Nf6',
        moves: ['e4', 'd5', 'exd5', 'Nf6'],
        idea: 'Black skips the queen moves and wins the pawn back with tempo after ...Bg4, or gambits with ...c6 for the initiative.',
      },
      {
        name: 'Icelandic Gambit',
        moves: ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nxc6'],
        idea: 'A pawn sacrifice for open lines and fast development — surprise value with real teeth at club level.',
      },
    ],
    blackStrategy:
      'Move the queen out of the firing line (...Qa5 or ...Qd6), develop with ...Nf6, ...c6/...e6 and ...Bf5 or ...Bg4, castle, and let the symmetrical structure become a piece-play battle. Your pawn structure has no weaknesses.',
    whiteStrategy:
      'Use the extra tempi for d4-e5 space or rapid development with Nf3, Bc4/Bd3 and O-O. Tempo hits on the early queen and the d4-d5 push define your chances.',
    strengths: ['Very little forced theory', 'Clear, easy-to-remember plans', 'Fully sound structurally'],
    weaknesses: ['Early queen sorties can cost tempi', 'White reaches comfortable setups easily', 'Main lines tend toward draws'],
  },
  {
    slug: 'pirc-defense',
    name: 'Pirc Defense',
    eco: 'B07',
    side: 'black',
    moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'c6'],
    idea:
      'Black lets White build a big centre, then attacks it with pieces and pawn breaks (...e5, ...c5). Flexible and ambush-style — an opening that wins games by counter-punching.',
    variations: [
      {
        name: 'Austrian Attack',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4'],
        idea: 'White grabs space with f4 immediately and aims for an e5/f5 storm. Black counter-hits the centre with ...c5 and ...Qa5.',
      },
      {
        name: 'Classical System',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3'],
        idea: 'The calmest approach: natural development, then Be2/O-O and a measured central clamp. Play revolves around the timing of e5 and ...e5.',
      },
      {
        name: '150 Attack',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3'],
        idea: 'White develops the dark-squared bishop first and sets up Qd2 and h4-h5 mating nets learned from British club play.',
      },
      {
        name: 'Solid ...c6 setup',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'c6'],
        idea: 'c6 supports a future d5 trade and prepares queenside space with ...b5 before committing to ...e5.',
      },
    ],
    blackStrategy:
      'Fianchetto, castle, and hold the centre at arm’s length until the strike: ...e5 or ...c5. Trade White’s attackers at the right moments — the g7 bishop must survive as your best piece.',
    whiteStrategy:
      'Space first, attack second: build the d4-e4 duo (f4 in the Austrian), keep the centre intact, and use the extra space for h4-h5 or Bd3/Qd2 mating setups. Avoid premature trades that free Black’s game.',
    strengths: ['Ambush value — many 1.e4 players know it poorly', 'Flexible move orders', 'Real winning chances via counterattack'],
    weaknesses: ['White gets a free big centre', 'The 150 Attack is a prepared, dangerous system', 'Slow starts can drift into passivity'],
  },
  {
    slug: 'english-opening',
    name: 'English Opening',
    eco: 'A10',
    side: 'either',
    moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2', 'Nb6'],
    idea:
      'A reversed Sicilian with an extra tempo: White fights for d5 with flank play, fianchettoes, and builds a slow stranglehold. The most flexible first move after 1.e4 and 1.d4.',
    variations: [
      {
        name: 'Reversed Sicilian (1...e5)',
        moves: ['c4', 'e5', 'Nc3', 'Nf6'],
        idea: 'The pure English: White plays a Sicilian with colours reversed and a tempo up. Plans revolve around g3-fianchetto pressure on d5.',
      },
      {
        name: 'Symmetrical',
        moves: ['c4', 'c5', 'Nc3', 'Nf6'],
        idea: 'Both sides fight for d4 and d5. Everything from Botvinnik setups (g3, Bg2, e4) to hedgehogs (b6, Bb7, d6) arises.',
      },
      {
        name: 'Botvinnik Setup',
        moves: ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'g6', 'Bg2', 'Bg7'],
        idea: 'The famous Botvinnik system: Rb1, b4, e4 — a queenside space grab behind a strong light-squared bishop.',
      },
      {
        name: 'Anglo-Indian',
        moves: ['c4', 'Nf6', 'Nc3', 'e6'],
        idea: 'Avoiding 1...e5 theory entirely, White meets Indian setups and transposes into favourable versions of King’s Indian and Nimzo-English structures.',
      },
    ],
    whiteStrategy:
      'Fianchetto on g2, fight for d5 with Nc3 and Nf3 support, and expand with b4 (Botvinnik) or a well-timed e4 break. The bishop on g2 is the soul of the position — never trade it cheaply.',
    blackStrategy:
      'Use the extra tempo well: against 1.c4 e5, prepare ...d5 or hit with ...f5; in symmetrical lines, fight for d4 with ...Nf6/...d5 timing. Solid ...d6/...g6 hedgehog setups blunt the g2 bishop permanently.',
    strengths: ['Tremendous flexibility in move order', 'Avoids huge bodies of 1.e4 and 1.d4 theory', 'Stranglehold play suits positional grinders'],
    weaknesses: ['Slow — attackers may find it tame', 'Symmetrical lines can fizzle into draws', 'Needs a real feel for reversed structures'],
  },
  {
    slug: 'catalan-opening',
    name: 'Catalan Opening',
    eco: 'E00',
    side: 'white',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4'],
    idea:
      'The Queen’s Gambit with a fianchetto: White combines the d4/c4 central claims with the g2 bishop’s permanent gaze down the long diagonal. Kramnik made it the ultimate try for an advantage.',
    variations: [
      {
        name: 'Open Catalan',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4'],
        idea: 'Black takes the c4 pawn; White answers with Qc2, Ne5 and Rc1 ideas for possibly eternal pressure against it.',
      },
      {
        name: 'Closed Catalan',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'c6'],
        idea: 'Black declines and builds a slow fortress with ...c6, aiming to blunt the g2 bishop and hold the centre.',
      },
      {
        name: 'Bogo-Indian Transposition',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Bb4+'],
        idea: 'The Bogo-flavoured check: White blocks with Bd2 or Nbd2 and reaches related structures, usually keeping pleasant choices with the bishop pair.',
      },
    ],
    whiteStrategy:
      'Complete the fianchetto (Bg2, Nf3, O-O), then squeeze: pressure c4 in Open Catalans with Qc2/Ne5/Rc1, or build slow central pressure in Closed lines. The g2 bishop is permanent — trade it only on your terms.',
    blackStrategy:
      'Decide fast: take on c4 and try to convert it into development (...c5, ...b5 counterplay), or close with ...c6 and untangle with ...Nbd7 and ...b6/...Bb7. Neutralise the g2 bishop and the game is level.',
    strengths: ['The most respected 1.d4 try for a lasting edge', 'Long-term pressure suits patient players', 'Flexible transpositions into Queen’s Gambit and Bogo structures'],
    weaknesses: ['Subtle play — the edge is slow to convert', 'Black’s open setups hold in many lines', 'Needs strong positional understanding'],
  },
  {
    slug: 'grunfeld-defense',
    name: 'Grünfeld Defense',
    eco: 'D80',
    side: 'black',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7'],
    idea:
      'A dynamic provocation: Black lets White build a giant centre, then attacks it with the g7 bishop and piece play. Every game revolves around whether that centre is strong — or a big target.',
    variations: [
      {
        name: 'Exchange Variation',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7'],
        idea: 'The classical battle: White’s huge pawn mass against Black’s piece pressure on it. Kasparov’s main weapon for decades.',
      },
      {
        name: 'Russian System (4.Nf3 Bg7 5.Bf4)',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'Nf3', 'Bg7', 'Bf4'],
        idea: 'White develops with tempo, pressures the g7 bishop and keeps the centre. Rich middlegames where both sides race to attack the weakest point.',
      },
      {
        name: 'Fianchetto System',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'd5', 'g3'],
        idea: 'White avoids the sharp centre lines with g3/Bg2 restraint. Slower Grünfelds where Black’s counterplay comes from ...c5 and piece pressure on d4.',
      },
    ],
    blackStrategy:
      'Attack the centre with everything: ...c5, ...Qa5, ...Nc6 and ...Rd8 in the Exchange — pieces first, pawn breaks second, until the d4/e4 mass cracks.',
    whiteStrategy:
      'Support the centre and keep it intact: Nf3, Be3, Qd2, Rc1 in the Exchange, using the space for a kingside build-up. Trade into an ending only once the centre is stable.',
    strengths: ['A genuine fighting chance from a hypermodern counterattack', 'Top-level seal of approval and deep theory', 'The centre either wins for White or falls — always a real game'],
    weaknesses: ['The theory is vast and forcing', 'Some lines give White pleasant endgame edges', 'One inaccurate move order and Black drifts'],
  },
  {
    slug: 'slav-defense',
    name: 'Slav Defense',
    eco: 'D10',
    side: 'either',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6'],
    idea:
      'The solid sibling of the Queen’s Gambit: Black supports ...d5 with ...c6 and keeps the light-squared bishop’s diagonal open. Queen’s-Gambit strength with French-like freedom.',
    variations: [
      {
        name: 'Main Line (4...dxc4)',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'],
        idea: 'Black grabs the pawn; a4 stops ...b5. Black develops with ...Bf5 first and returns the pawn on favourable timing.',
      },
      {
        name: 'Semi-Slav',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6'],
        idea: 'The ...e6 addition locks the bishop but unlocks the Meran and Botvinnik systems — one of the sharpest structures in all of chess.',
      },
      {
        name: 'Exchange Slav',
        moves: ['d4', 'd5', 'c4', 'c6', 'cxd5', 'cxd5'],
        idea: 'Symmetry and calm. The honest truth: it is famously drawish, and real play revolves around minor outposts and the c-file.',
      },
      {
        name: 'Chebanenko (...a6)',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'a6'],
        idea: 'The flexible ...a6 Slav: keeps ...dxc4 and ...b5 options alive and frustrates White’s tempo-gaining tries.',
      },
    ],
    blackStrategy:
      'Develop the light-squared bishop before ...e6 when possible, take on c4 when the timing is right, and use the b5/c4 dynamics. In Semi-Slav structures, know your Meran lines before entering them.',
    whiteStrategy:
      'Build with Nf3, Nc3 and Bg5; use a4 and Ne5 ideas in main lines, minority attacks in Semi-Slav Carlsbad structures, and central e4 breaks when Black hesitates.',
    strengths: ['Extremely solid — world-champion tested', 'Usually keeps the bad-bishop problem away', 'Flexible: solid or razor-sharp versions exist'],
    weaknesses: ['Exchange lines are sleepy', 'Semi-Slav theory is enormous', 'The ...c6 commitment can slow the pieces'],
  },
  {
    slug: 'vienna-game',
    name: 'Vienna Game',
    eco: 'C25',
    side: 'white',
    moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4'],
    idea:
      'A King’s Gambit with a safety net: the knight on c3 supports the f4 push while keeping d4 in reserve. Fast, aggressive, and much sounder than its reputation.',
    variations: [
      {
        name: 'Vienna Gambit',
        moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4'],
        idea: 'The full-blooded main line: pawns fly, and White gets open lines and an e5 wedge. Preparation wins games here.',
      },
      {
        name: 'Quiet Vienna',
        moves: ['e4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5'],
        idea: 'The fianchetto version: g3, Bg2, d3, Nge2 — a slow build that sidesteps all the gambit theory.',
      },
      {
        name: 'Main line with d4',
        moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4'],
        idea: 'White completes the big centre; the game becomes a sharp race where White’s space fights Black’s piece activity around e4.',
      },
    ],
    whiteStrategy:
      'After fxe5, complete development with tempo (Nf3, d4, Bd3) and target the e4 knight and f7. In quiet lines, build the Bg2 setup and expand with d4 at the right moment.',
    blackStrategy:
      'Meet f4 actively: ...d5 strikes the centre at once. Return material for time when needed, develop with ...Nc6, ...Be7, castle fast, and blunt the e5 wedge with ...f6 or ...Bc5 pressure.',
    strengths: ['Big surprise value below master level', 'Fast attacking chances on sound foundations', 'Quiet lines offer a painless fallback'],
    weaknesses: ['Well-prepared defenders neutralise the gambit', 'The gambit lines demand exact knowledge', 'Quiet versions can be dull'],
  },
  {
    slug: 'scotch-game',
    name: 'Scotch Game',
    eco: 'C45',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Nge7'],
    idea:
      'Open the centre at once: d4 resolves the tension before Black can clamp it. Kasparov revived it in the 1990s as a less theory-doomed alternative to the Ruy Lopez.',
    variations: [
      {
        name: 'Classical (4...Bc5)',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5'],
        idea: 'The main line: Black develops with tempo against the d4 knight. White answers Be3 or Nb3 and the centre opens into rich middlegames.',
      },
      {
        name: 'Mieses Variation (4...Nf6)',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6'],
        idea: 'Black hits e4 at once; White typically plays Nxc6 bxc6 followed by e5 and plays on the damaged structure.',
      },
      {
        name: 'Four Knights Scotch',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'd4'],
        idea: 'The Four Knights meets the Scotch: immediate central tension in a safe, well-known arena.',
      },
    ],
    whiteStrategy:
      'Finish development fast (Be3 or Bc4, Nxc6 structures, e5 breaks) and use the open lines before Black consolidates. Open lines and quick development are the currency here.',
    blackStrategy:
      'Develop with tempo (Bc5/Qf6 or Nf6 hits) and castle fast. The structures are open — piece activity decides. Trade into favourable endgames when the initiative dries up.',
    strengths: ['Straight to open, fighting chess', 'Far less theory than the Ruy Lopez', 'Sound — no known forced refutation'],
    weaknesses: ['Instant symmetry gives Black easy development', 'Few long-term targets; the edges are small', 'The main lines are deeply analysed'],
  },
  {
    slug: 'kings-gambit',
    name: "King's Gambit",
    eco: 'C30',
    side: 'white',
    moves: ['e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'g5'],
    idea:
      'The most romantic opening ever played: a pawn for open lines, quick development, and a direct hit at f7. Objectively dubious, practically lethal against unprepared opponents.',
    variations: [
      {
        name: 'King’s Gambit Accepted',
        moves: ['e4', 'e5', 'f4', 'exf4'],
        idea: 'Black grabs the pawn; White gets open lines, Bc4/Nf3 development and immediate pressure on f7.',
      },
      {
        name: 'Bishop’s Gambit',
        moves: ['e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'g5'],
        idea: 'The infamous king walk: White blocks with the bishop, castles by hand, and out-develops Black while the queen is offside.',
      },
      {
        name: 'Modern 3...d5',
        moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'd5', 'exd5', 'Nf6'],
        idea: 'The modern antidote: Black strikes the centre immediately, returning the pawn for development and a healthy game.',
      },
      {
        name: 'Falkbeer Counter-Gambit',
        moves: ['e4', 'e5', 'f4', 'd5', 'exd5', 'e4'],
        idea: 'The sharpest refusal: the e4 pawn gains space and cramps White while the c8 bishop finally gets air.',
      },
    ],
    whiteStrategy:
      'Develop with threats (Bc4, Nf3), castle by hand when checked, and aim everything at f7 and the exposed black queen. The compensation is time, not structure — stay tactical and fast.',
    blackStrategy:
      'Return material for time when needed: 3...d5 strikes back instantly. Neutralise the Bc4/Nf3 battery, consolidate the extra pawn, and steer toward a safe endgame.',
    strengths: ['Maximum surprise value', 'Direct attacking chances from move 2', 'A rich romantic history full of traps'],
    weaknesses: ['Objectively unsound in the main lines', 'Modern defences with ...d5 neutralise it', 'The king-walk lines are risky against preparation'],
  },
]

/** Slug -> guide, for fast lookup by the API and the UI. */
export const OPENING_GUIDE_BY_SLUG: ReadonlyMap<string, OpeningGuide> = new Map(
  OPENING_GUIDES.map((g) => [g.slug, g]),
)
