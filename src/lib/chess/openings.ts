// Compact opening table: longest matching SAN prefix wins. Shared by the
// game review (client) and the insights API (server) so both name openings
// the same way.

const OPENINGS: [string, string][] = [
  ['e4 e5 nf3 nc6 bb5', 'Ruy Lopez'],
  ['e4 e5 nf3 nc6 bc4', 'Italian Game'],
  ['e4 e5 nf3 nc6 d4', 'Scotch Game'],
  ['e4 e5 nf3 nf6', 'Petrov Defence'],
  ['e4 e5 nf3 d6', 'Philidor Defence'],
  ['e4 e5 nc3', 'Vienna Game'],
  ['e4 e5 f4', "King's Gambit"],
  ['e4 e5 bc4', "Bishop's Opening"],
  ['e4 e5 d4', 'Center Game'],
  ['e4 c5 nf3 d6', 'Sicilian, Open'],
  ['e4 c5 nf3 nc6', 'Sicilian, Old'],
  ['e4 c5 nf3 e6', 'Sicilian, French Variation'],
  ['e4 c5', 'Sicilian Defence'],
  ['e4 e6', 'French Defence'],
  ['e4 c6', 'Caro-Kann Defence'],
  ['e4 d5', 'Scandinavian Defence'],
  ['e4 nf6', 'Alekhine Defence'],
  ['e4 d6', 'Pirc Defence'],
  ['e4 g6', 'Modern Defence'],
  ['d4 d5 c4 e6', "Queen's Gambit Declined"],
  ['d4 d5 c4 c6', 'Slav Defence'],
  ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
  ['d4 d5 c4', "Queen's Gambit"],
  ['d4 nf6 c4 g6', "King's Indian Defence"],
  ['d4 nf6 c4 e6 nc3 bb4', 'Nimzo-Indian Defence'],
  ['d4 nf6 c4 b6', "Queen's Indian Defence"],
  ['d4 nf6 c4', 'Indian Game'],
  ['d4 f5', 'Dutch Defence'],
  ['d4 d5 nf3', "Queen's Pawn Game"],
  ['d4 d5', "Queen's Pawn Game"],
  ['nf3 d5 g3', 'Réti Opening'],
  ['nf3 d5 c4', 'Réti Opening'],
  ['nf3', 'Zukertort Opening'],
  ['c4', 'English Opening'],
  ['g3', 'Benko Opening'],
  ['b3', 'Nimzo-Larsen Attack'],
  ['f4', "Bird's Opening"],
  ['e4 e5', "King's Pawn Game"],
  ['e4', "King's Pawn Opening"],
  ['d4', "Queen's Pawn Opening"],
]

export function detectOpening(sans: string[]): string {
  const seq = sans.slice(0, 8).map((s) => s.replace(/[+#]/g, '').toLowerCase())
  let best: string | null = null
  let bestLen = 0
  for (const [prefix, name] of OPENINGS) {
    const parts = prefix.split(' ')
    if (seq.length < parts.length) continue
    if (parts.every((p, i) => seq[i] === p) && parts.length > bestLen) {
      best = name
      bestLen = parts.length
    }
  }
  return best ?? 'Irregular opening'
}
