/* Per-tier content validator for tier authoring tasks.
 * Run: bun scripts/validate-tier.ts src/content/tiers/<name>.ts
 * Replays every FEN / move line with chess.js and enforces SAN truthfulness.
 * Exits non-zero on any failure.
 */
import { Chess } from 'chess.js'
import type { LessonStep, Tier } from '../src/content/schema'

const file = process.argv[2]
if (!file) {
  console.error('usage: bun scripts/validate-tier.ts <tier-file>')
  process.exit(1)
}

let errors = 0
let checked = 0

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
    new Chess(fen)
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
    if (step.options.filter((o) => o.correct).length > 1) err(where, 'quiz has multiple correct options')
  } else if (step.type === 'exercise') {
    if (!checkFen(where, step.fen)) return
    const last = step.solution[step.solution.length - 1] ?? ''
    checkLine(where, step.fen, step.solution, last.includes('#'))
  } else if (step.type === 'playout') {
    checkFen(where, step.fen)
  }
}

async function main() {
  const mod = await import(file.replace(/^src\//, '../src/').replace(/\.ts$/, ''))
  const first = mod[Object.keys(mod)[0]]
  const isTier = first && !Array.isArray(first) && Array.isArray(first.levels)
  const tier: Tier | null = isTier ? first : null
  const levels: Tier['levels'] = isTier ? first.levels : Array.isArray(first) ? first : []
  if (levels.length === 0) {
    console.error('not a tier or level-array file')
    process.exit(1)
  }
  let steps = 0
  for (const level of levels) {
    for (const step of level.steps) {
      steps++
      checkStep(`${level.id} step "${step.title}"`, step)
    }
  }
  // structural checks
  if (tier && tier.levels.length !== 20) err(`tier ${tier.id}`, `must have exactly 20 levels, has ${tier.levels.length}`)
  const ids = new Set<string>()
  levels.forEach((l, i) => {
    if (l.n !== i + 1) err('n', `level index ${i} has n=${l.n}, expected ${i + 1}`)
    if (ids.has(l.id)) err('dup', `duplicate level id ${l.id}`)
    ids.add(l.id)
    if (l.steps.length < 4) err(l.id, `only ${l.steps.length} steps; need at least 4`)
  })
  // copy hygiene: no em dashes anywhere in strings
  const scan = (obj: unknown, path: string) => {
    if (typeof obj === 'string') {
      if (obj.includes('\u2014')) err(path, 'contains an em dash')
    } else if (Array.isArray(obj)) obj.forEach((v, i) => scan(v, `${path}[${i}]`))
    else if (obj && typeof obj === 'object') Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => scan(v, `${path}.${k}`))
  }
  scan(tier ?? levels, tier?.id ?? 'levels')

  console.log(`${tier?.id ?? file}: ${levels.length} levels, ${steps} steps, ${checked} chess checks, ${errors} errors`)
  if (errors > 0) process.exit(1)
  console.log('OK')
}

main()
