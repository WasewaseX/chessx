/* Content validator: run with: bun run src/content/validate.ts
 *
 * Replays every FEN / move line in the curriculum and the puzzle pack with
 * chess.js and enforces:
 *   - FEN parses and is legal
 *   - every move in a line is legal in sequence
 *   - SAN suffixes tell the truth: "x" must capture, "+" must check,
 *     "#" must be checkmate
 *   - exercise lines end where they claim (mate lines end in mate)
 *   - puzzle material wins actually win material
 * Exits non-zero on any failure. CI for content.
 */
import { Chess } from 'chess.js'
import { CONCEPTS } from './schema'
import type { GtmStep, LessonStep, Level, Puzzle, Tier } from './schema'

let errors = 0
let checked = 0
let conceptChecks = 0
const CONCEPT_SET = new Set<string>(CONCEPTS)

function err(where: string, msg: string) {
  errors++
  console.error(`  FAIL [${where}] ${msg}`)
}

function checkLine(where: string, fen: string, moves: string[], expectMateEnd = false) {
  let game: Chess
  try {
    game = new Chess(fen)
  } catch (e) {
    err(where, `bad FEN: ${fen} (${e})`)
    return
  }
  checked++
  for (let i = 0; i < moves.length; i++) {
    const san = moves[i]
    try {
      const mv = game.move(san)
      if (!mv) throw new Error('null move')
      if (san.includes('x') && !mv.captured) err(where, `"${san}" says capture but is not (ply ${i + 1})`)
      if (mv.captured && !san.includes('x')) err(where, `"${san}" is a capture but SAN hides it (ply ${i + 1})`)
      if (san.includes('#') && !game.isCheckmate()) err(where, `"${san}" says mate but position is not mate (ply ${i + 1})`)
      if (san.includes('+') && !game.isCheck()) err(where, `"${san}" says check but position is not check (ply ${i + 1})`)
      if (game.isCheckmate() && !san.includes('#')) err(where, `position is mate but SAN lacks "#" (ply ${i + 1}: ${san})`)
      if (game.isCheck() && !san.includes('+') && !san.includes('#')) err(where, `position is check but SAN lacks "+" (ply ${i + 1}: ${san})`)
    } catch {
      err(where, `illegal move "${san}" at ply ${i + 1} in line [${moves.join(' ')}] from ${fen}`)
      return
    }
  }
  if (expectMateEnd && !game.isCheckmate()) {
    err(where, `line should end in mate but doesn't: [${moves.join(' ')}]`)
  }
}

function checkFen(where: string, fen: string): boolean {
  try {
    const g = new Chess(fen)
    // reject positions with no kings or wrong side
    checked++
    return true
  } catch {
    err(where, `bad FEN: ${fen}`)
    return false
  }
}

function checkStep(where: string, step: LessonStep) {
  if (step.type === 'demo') {
    if (!checkFen(where, step.fen)) return
    if (step.moves && step.moves.length) checkLine(where, step.fen, step.moves)
  } else if (step.type === 'quiz') {
    if (step.fen) checkFen(where, step.fen)
    if (!step.options.some((o) => o.correct)) err(where, 'quiz has no correct option')
    const correctCount = step.options.filter((o) => o.correct).length
    if (correctCount > 1) err(where, 'quiz has multiple correct options')
  } else if (step.type === 'exercise') {
    if (!checkFen(where, step.fen)) return
    const last = step.solution[step.solution.length - 1] ?? ''
    checkLine(where, step.fen, step.solution, last.includes('#'))
  } else if (step.type === 'playout') {
    checkFen(where, step.fen)
  } else if (step.type === 'gtm') {
    checkGtm(where, step)
  }
}

function checkGtm(where: string, step: GtmStep) {
  if (!checkFen(where, step.fen)) return
  const prelude = step.prelude ?? []
  // full main line must be legal: prelude + san + reply, alternating
  const mainLine: string[] = []
  for (const m of step.moves) {
    mainLine.push(m.san)
    if (m.reply) mainLine.push(m.reply)
  }
  checkLine(where, step.fen, [...prelude, ...mainLine])
  // every alternative must be legal in the exact position it would be played
  const probe = new Chess(step.fen)
  for (const san of prelude) {
    try {
      probe.move(san)
    } catch {
      return // already reported by checkLine
    }
  }
  for (let i = 0; i < step.moves.length; i++) {
    const m = step.moves[i]
    const alts = [...(m.alsoGood ?? []), ...(m.okay ?? [])]
    for (const alt of alts) {
      const attempt = new Chess(probe.fen())
      try {
        const mv = attempt.move(alt)
        if (mv) {
          checked++
          if (alt.includes('x') && !mv.captured) err(where, `alt "${alt}" says capture but is not (move ${i + 1})`)
          if (mv.captured && !alt.includes('x')) err(where, `alt "${alt}" is a capture but SAN hides it (move ${i + 1})`)
          if (alt.includes('#') && !attempt.isCheckmate()) err(where, `alt "${alt}" says mate but is not (move ${i + 1})`)
          if (alt.includes('+') && !attempt.isCheck()) err(where, `alt "${alt}" says check but is not (move ${i + 1})`)
        }
      } catch {
        err(where, `illegal alternative "${alt}" at guess ${i + 1} from ${probe.fen()}`)
      }
    }
    // walk the main line forward for the next guess position
    try {
      probe.move(m.san)
      if (m.reply) probe.move(m.reply)
    } catch {
      return // already reported by checkLine
    }
  }
  // the guessing side must alternate correctly: prelude parity + turn order
  const turnAtGuess = new Chess(step.fen)
  try {
    for (const san of prelude) turnAtGuess.move(san)
  } catch {
    /* reported */
  }
  const expectedSide = turnAtGuess.turn()
  for (let i = 0; i < step.moves.length; i++) {
    const probeG = new Chess(step.fen)
    try {
      for (const san of prelude) probeG.move(san)
      for (let j = 0; j < i; j++) {
        probeG.move(step.moves[j].san)
        if (step.moves[j].reply) probeG.move(step.moves[j].reply)
      }
      if (probeG.turn() !== expectedSide) {
        err(where, `guess ${i + 1} is not ${expectedSide} to move, check prelude/reply parity`)
      }
    } catch {
      /* reported */
    }
    checked++
  }
  if (step.moves.length < 2) err(where, 'gtm should have at least 2 guesses')
}

/** Every level must carry 2..4 concept ids drawn from the CONCEPTS taxonomy. */
function checkConcepts(where: string, level: Level) {
  const list = level.concepts
  conceptChecks++
  if (!list || !Array.isArray(list) || list.length === 0) {
    err(where, 'level has no concepts tags')
    return
  }
  if (list.length < 2) err(where, `only ${list.length} concept tag, need 2 to 4: [${list.join(', ')}]`)
  if (list.length > 4) err(where, `${list.length} concept tags, max is 4: [${list.join(', ')}]`)
  for (const c of list) {
    conceptChecks++
    if (!CONCEPT_SET.has(c)) err(where, `unknown concept "${c}" (not in CONCEPTS)`)
  }
}

function materialBalance(fen: string): number {
  const vals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
  const g = new Chess(fen)
  let bal = 0
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue
      bal += sq.color === 'w' ? vals[sq.type] : -vals[sq.type]
    }
  }
  return bal
}

function checkPuzzle(where: string, p: Puzzle) {
  if (!checkFen(where, p.fen)) return
  const moves = p.solution.split(' ').filter(Boolean)
  checkLine(where, p.fen, moves, p.themes.includes('mate'))
  if (p.themes.includes('mate')) {
    const g = new Chess(p.fen)
    try {
      for (const m of moves) g.move(m)
      if (!g.isCheckmate()) err(where, 'mate puzzle does not end in mate')
    } catch {
      /* already reported */
    }
  }
  if (p.themes.includes('winningMaterial')) {
    const g = new Chess(p.fen)
    const before = materialBalance(p.fen)
    try {
      for (const m of moves) g.move(m)
      const after = materialBalance(g.fen())
      const side = new Chess(p.fen).turn() === 'w' ? 1 : -1
      const gain = (after - before) * side
      if (gain < 2) err(where, `winningMaterial puzzle gains only ${gain}, should be >= 2`)
    } catch {
      /* already reported */
    }
  }
  if (p.rating < 300 || p.rating > 2600) err(where, `suspicious rating ${p.rating}`)
  if (!p.themes.length) err(where, 'no themes')
}

async function main() {
  console.log('Validating lesson content...')
  const levelsMod = await import('./levels')
  const tiers: Tier[] = levelsMod.TIERS
  let levels = 0
  let steps = 0
  for (const tier of tiers) {
    if (tier.levels.length !== 20) {
      err(`tier ${tier.id}`, `tier must have exactly 20 levels, has ${tier.levels.length}`)
    }
    for (const level of tier.levels) {
      levels++
      checkConcepts(`t${tier.n}/${level.id} concepts`, level)
      for (const step of level.steps) {
        steps++
        checkStep(`t${tier.n}/${level.id} step "${step.title}"`, step)
      }
    }
  }
  console.log(
    `  ${tiers.length} tiers, ${levels} levels, ${steps} steps checked, ${conceptChecks} concept tags checked (${errors} errors so far)`,
  )

  console.log('Validating puzzles...')
  const puzzlesMod = await import('./puzzles')
  const puzzles: Puzzle[] = puzzlesMod.PUZZLES
  for (const p of puzzles) checkPuzzle(`puzzle ${p.id}`, p)
  console.log(`  ${puzzles.length} puzzles checked`)

  // unique ids, 1..20 numbering per tier
  const levelIds = new Set<string>()
  for (const tier of tiers) {
    tier.levels.forEach((level, i) => {
      if (level.n !== i + 1) err(`tier ${tier.id}`, `level ${i} has n=${level.n}, expected ${i + 1}`)
      if (levelIds.has(level.id)) err('dup', `duplicate level id ${level.id}`)
      levelIds.add(level.id)
    })
  }
  const puzzleIds = new Set<string>()
  for (const p of puzzles) {
    if (puzzleIds.has(p.id)) err('dup', `duplicate puzzle id ${p.id}`)
    puzzleIds.add(p.id)
  }

  if (errors > 0) {
    console.error(`\n${errors} content errors. Fix before shipping.`)
    process.exit(1)
  }
  console.log(`\nAll content valid. (${checked} checks)`)
}

main()
