// Compact ECO opening table + matcher, shared shape with the curated
// identifier in src/app/api/tools/opening/route.ts. The route keeps its own
// inline copy on purpose (frozen route); this module exists so the public
// API can match lines without importing from (or touching) a route file.
// Entries: the most common named lines, deepest 6 plies. SAN is
// canonicalized through chess.js once at module load, so lookups compare
// canonical SAN strings only.
import { Chess } from 'chess.js'

const ECO_TABLE: { eco: string; name: string; moves: string[] }[] = [
  // 1.e4 — the open games
  { eco: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'] },
  { eco: 'C21', name: 'Center Game', moves: ['e4', 'e5', 'd4', 'exd4'] },
  { eco: 'C22', name: 'Center Game, Main Line', moves: ['e4', 'e5', 'd4', 'exd4', 'Qxd4'] },
  { eco: 'C23', name: "Bishop's Opening", moves: ['e4', 'e5', 'Bc4'] },
  { eco: 'C25', name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'] },
  { eco: 'C27', name: 'Vienna Gambit', moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4'] },
  { eco: 'C30', name: "King's Gambit", moves: ['e4', 'e5', 'f4'] },
  { eco: 'C31', name: "King's Gambit Declined, Falkbeer", moves: ['e4', 'e5', 'f4', 'd5'] },
  { eco: 'C33', name: "King's Gambit Accepted", moves: ['e4', 'e5', 'f4', 'exf4'] },
  { eco: 'C35', name: "King's Gambit, Bishop's Gambit", moves: ['e4', 'e5', 'f4', 'exf4', 'Bc4'] },
  { eco: 'C36', name: "King's Gambit Accepted, Modern", moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5'] },
  { eco: 'C40', name: "King's Knight Opening", moves: ['e4', 'e5', 'Nf3'] },
  { eco: 'C41', name: 'Philidor Defense', moves: ['e4', 'e5', 'Nf3', 'd6'] },
  { eco: 'C42', name: 'Petrov Defense (Russian Game)', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'C43', name: 'Petrov, Main Line', moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6'] },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C44', name: 'Ponziani Opening', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'c3'] },
  { eco: 'C45', name: 'Scotch Game, Main Line', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4'] },
  { eco: 'C46', name: 'Three Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3'] },
  { eco: 'C47', name: 'Four Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'] },
  { eco: 'C50', name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C50', name: 'Hungarian Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Be7'] },
  { eco: 'C55', name: 'Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C60', name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C62', name: 'Ruy Lopez, Old Steinitz', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'd6'] },
  { eco: 'C63', name: 'Ruy Lopez, Schliemann', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'f5'] },
  { eco: 'C64', name: 'Ruy Lopez, Classical', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Bc5'] },
  { eco: 'C65', name: 'Ruy Lopez, Berlin', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C70', name: 'Ruy Lopez, Morphy Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },

  // 1.e4 — the semi-open games
  { eco: 'B00', name: "King's Pawn Opening", moves: ['e4'] },
  { eco: 'B00', name: 'Nimzowitsch Defense', moves: ['e4', 'Nc6'] },
  { eco: 'B00', name: "Owen's Defense (St. George)", moves: ['e4', 'b6'] },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
  { eco: 'B01', name: 'Scandinavian Defense, Main Line', moves: ['e4', 'd5', 'exd5', 'Qxd5'] },
  { eco: 'B02', name: 'Alekhine Defense', moves: ['e4', 'Nf6'] },
  { eco: 'B03', name: 'Alekhine, Main Line', moves: ['e4', 'Nf6', 'e5', 'Nd5'] },
  { eco: 'B04', name: 'Alekhine, Modern', moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4'] },
  { eco: 'B06', name: 'Modern Defense', moves: ['e4', 'g6'] },
  { eco: 'B07', name: 'Pirc Defense', moves: ['e4', 'd6'] },
  { eco: 'B08', name: 'Pirc, Classical System', moves: ['e4', 'd6', 'd4', 'Nf6'] },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
  { eco: 'B12', name: 'Caro-Kann, Advance', moves: ['e4', 'c6', 'd4', 'd5', 'e5'] },
  { eco: 'B13', name: 'Caro-Kann, Exchange', moves: ['e4', 'c6', 'd4', 'd5', 'exd5'] },
  { eco: 'B15', name: 'Caro-Kann, Main Line', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3'] },
  { eco: 'B18', name: 'Caro-Kann, Classical', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4'] },
  { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { eco: 'B21', name: 'Smith-Morra Gambit', moves: ['e4', 'c5', 'd4'] },
  { eco: 'B22', name: 'Sicilian, Alapin', moves: ['e4', 'c5', 'c3'] },
  { eco: 'B23', name: 'Sicilian, Closed', moves: ['e4', 'c5', 'Nc3'] },
  { eco: 'B27', name: 'Sicilian Defense', moves: ['e4', 'c5', 'Nf3'] },
  { eco: 'B30', name: 'Sicilian, 2...Nc6', moves: ['e4', 'c5', 'Nf3', 'Nc6'] },
  { eco: 'B31', name: 'Sicilian, Rossolimo', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'B32', name: 'Sicilian, Open', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'B33', name: 'Sicilian, Sveshnikov', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4'] },
  { eco: 'B40', name: 'Sicilian, 2...e6', moves: ['e4', 'c5', 'Nf3', 'e6'] },
  { eco: 'B41', name: 'Sicilian, Kan', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4'] },
  { eco: 'B50', name: 'Sicilian, 2...d6', moves: ['e4', 'c5', 'Nf3', 'd6'] },
  { eco: 'B54', name: 'Sicilian, Open vs ...d6', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'] },
  { eco: 'B56', name: 'Sicilian, Classical', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'] },

  // French
  { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'] },
  { eco: 'C01', name: 'French, Exchange', moves: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5'] },
  { eco: 'C02', name: 'French, Advance', moves: ['e4', 'e6', 'd4', 'd5', 'e5'] },
  { eco: 'C03', name: 'French, Tarrasch', moves: ['e4', 'e6', 'd4', 'd5', 'Nd2'] },
  { eco: 'C11', name: 'French, Classical', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3'] },
  { eco: 'C11', name: 'French, Main Line', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
  { eco: 'C15', name: 'French, Winawer', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'] },

  // 1.d4 — closed and Indian games
  { eco: 'A40', name: "Queen's Pawn Opening", moves: ['d4'] },
  { eco: 'A40', name: 'Englund Gambit', moves: ['d4', 'e5'] },
  { eco: 'A43', name: 'Old Benoni', moves: ['d4', 'c5'] },
  { eco: 'A45', name: "Queen's Pawn, Indian", moves: ['d4', 'Nf6'] },
  { eco: 'A45', name: 'Trompowsky Attack', moves: ['d4', 'Nf6', 'Bg5'] },
  { eco: 'A50', name: 'Indian Game', moves: ['d4', 'Nf6', 'c4'] },
  { eco: 'A51', name: 'Budapest Gambit', moves: ['d4', 'Nf6', 'c4', 'e5'] },
  { eco: 'A52', name: 'Budapest, Rubinstein', moves: ['d4', 'Nf6', 'c4', 'e5', 'dxe5', 'Ng4'] },
  { eco: 'A56', name: 'Benoni Defense', moves: ['d4', 'Nf6', 'c4', 'c5', 'd5'] },
  { eco: 'A57', name: 'Benko Gambit', moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5'] },
  { eco: 'A80', name: 'Dutch Defense', moves: ['d4', 'f5'] },
  { eco: 'A47', name: "Queen's Indian Setup", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3'] },
  { eco: 'D00', name: "Queen's Pawn Game", moves: ['d4', 'd5'] },
  { eco: 'D00', name: 'Blackmar Gambit', moves: ['d4', 'd5', 'e4'] },
  { eco: 'D02', name: 'London System', moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'D02', name: "Queen's Pawn, 2.Nf3", moves: ['d4', 'd5', 'Nf3'] },
  { eco: 'D01', name: 'Richter-Veresov Attack', moves: ['d4', 'd5', 'Nc3'] },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { eco: 'D10', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D15', name: 'Slav, Main Line', moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6'] },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { eco: 'D24', name: 'QGA, 3.Nf3', moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3'] },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D37', name: 'QGD, Main Line', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'] },
  { eco: 'D43', name: 'Semi-Slav Defense', moves: ['d4', 'd5', 'c4', 'c6', 'Nc3', 'Nf6'] },
  { eco: 'D80', name: 'Grünfeld Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { eco: 'E00', name: 'Catalan Opening', moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'] },
  { eco: 'E11', name: 'Bogo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'Bb4+'] },
  { eco: 'E12', name: "Queen's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E61', name: "King's Indian, 3.Nc3", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3'] },

  // Flank openings
  { eco: 'A10', name: 'English Opening', moves: ['c4'] },
  { eco: 'A15', name: 'English, Anglo-Indian', moves: ['c4', 'Nf6'] },
  { eco: 'A16', name: 'English, Anglo-Indian 2.Nc3', moves: ['c4', 'Nf6', 'Nc3'] },
  { eco: 'A20', name: 'English, 1...e5', moves: ['c4', 'e5'] },
  { eco: 'A22', name: 'English, 2.Nc3', moves: ['c4', 'e5', 'Nc3'] },
  { eco: 'A28', name: 'English, Four Knights', moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6'] },
  { eco: 'A30', name: 'English, Symmetrical', moves: ['c4', 'c5'] },
  { eco: 'A04', name: 'Réti Opening', moves: ['Nf3'] },
  { eco: 'A05', name: 'Réti, Indian', moves: ['Nf3', 'Nf6'] },
  { eco: 'A06', name: 'Réti, 1...d5', moves: ['Nf3', 'd5'] },
  { eco: 'A07', name: "King's Indian Attack", moves: ['Nf3', 'd5', 'g3'] },
  { eco: 'A08', name: 'Réti, 2.c4', moves: ['Nf3', 'd5', 'c4'] },
  { eco: 'A01', name: 'Nimzo-Larsen Attack', moves: ['b3'] },
  { eco: 'A02', name: "Bird's Opening", moves: ['f4'] },
  { eco: 'A03', name: "Bird's Opening, 1...d5", moves: ['f4', 'd5'] },
  { eco: 'A00', name: 'Polish (Sokolsky) Opening', moves: ['b4'] },
  { eco: 'A00', name: 'Grob Opening', moves: ['g4'] },
  { eco: 'A00', name: "Benko's Opening (King's Fianchetto)", moves: ['g3'] },
  { eco: 'A00', name: 'Dunst (Van Geet) Opening', moves: ['Nc3'] },
  { eco: 'A00', name: "Van't Kruijs Opening", moves: ['e3'] },
  { eco: 'A00', name: 'Barnes Opening', moves: ['f3'] },
  { eco: 'A00', name: 'Anderssen Opening', moves: ['a3'] },
]

/** Replay SAN tokens from the start; keep the canonical SAN of what parsed. */
function canonicalLine(tokens: string[], maxPlies = 24): string[] {
  const g = new Chess()
  const out: string[] = []
  for (const raw of tokens) {
    if (out.length >= maxPlies) break
    const san = raw.replace(/^\d+\.+/, '').trim()
    if (!san || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(san)) continue
    try {
      const mv = g.move(san)
      if (mv) out.push(mv.san)
    } catch {
      break // first illegal token ends the replayable line
    }
  }
  return out
}

// Canonical SAN for every table entry, computed once.
const ECO_CANON = ECO_TABLE.map((e) => ({ eco: e.eco, name: e.name, canon: canonicalLine(e.moves) }))

export interface EcoMatch {
  eco: string | null
  name: string | null
  /** Plies of the table entry that matched (0 when nothing matched). */
  matchedPlies: number
  /** Plies of the input line that replayed legally. */
  replayedPlies: number
}

/**
 * Longest canonical prefix wins; ties go to the first entry (the main line
 * of each code is listed before its sidelines).
 */
export function identifyEcoLine(tokens: string[]): EcoMatch {
  const line = canonicalLine(tokens)
  let best: { eco: string; name: string; len: number } | null = null
  for (const e of ECO_CANON) {
    if (e.canon.length === 0 || e.canon.length > line.length) continue
    let ok = true
    for (let i = 0; i < e.canon.length; i++) {
      if (e.canon[i] !== line[i]) {
        ok = false
        break
      }
    }
    if (ok && (!best || e.canon.length > best.len)) best = { eco: e.eco, name: e.name, len: e.canon.length }
  }
  return { eco: best?.eco ?? null, name: best?.name ?? null, matchedPlies: best?.len ?? 0, replayedPlies: line.length }
}

/**
 * Liberal tokenizer for move text: "e4,e5,Nf3", "e4 e5 Nf3" and
 * "1. e4 e5 2. Nf3" all work; move numbers and results are stripped later.
 */
export function tokenizeMoves(raw: string): string[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 40)
}
