// Restructures the live curriculum to match the teaching order of
// "How to Win at Chess" (Levy Rozman). Fixes the structural disease where the
// book-derived hw* levels are spread-appended AFTER each tier's graduation
// level, stranding them out of place and duplicating existing titles.
//
// What this does:
//   - inlines every unique hw level into its book-correct position
//   - drops true duplicates (nb-hw1, nb-hw2, bg-hw2, bg-hw3, int-hw1,
//     int-hw3, adv-hw1, adv-hw3, ms-hw1) in favor of the richer inline twins
//   - moves int-24 (CCA) -> Beginner and bg-14 (Passed pawns) + adv-14
//     (Philidor) -> Intermediate, per the book's banding
//   - moves gm-hw1 before the Capstone (doctrine promises this order)
//   - strips the book-module imports and spreads from every tier file
//   - renumbers n to array position + 1 (validator contract)
// Ids never change, so stored user progress survives the reorder.
import fs from 'node:fs'

const DIR = '/home/z/my-project/src/content/tiers'
const BOOK = '/home/z/my-project/src/content/book/how-to-win-at-chess.ts'

const ORDERS = {
  newbie: [
    'nb-01', 'nb-21', 'nb-23', 'nb-02', 'nb-03', 'nb-04', 'nb-05', 'nb-06',
    'nb-07', 'nb-10', 'nb-11', 'nb-12', 'nb-08', 'nb-22', 'nb-09', 'nb-13',
    'nb-hw3', 'nb-19', 'nb-14', 'nb-15', 'nb-16', 'nb-17', 'nb-18', 'nb-20',
  ],
  beginner: [
    'bg-01', 'bg-02', 'bg-03', 'bg-21', 'bg-12', 'bg-13', 'bg-11', 'bg-23',
    'bg-ends', 'bg-04', 'bg-05', 'bg-hw1', 'bg-06', 'bg-07', 'bg-08', 'bg-09',
    'bg-10', 'bg-22', 'int-24', 'bg-15', 'bg-16', 'bg-17', 'bg-18', 'bg-19',
    'bg-20',
  ],
  intermediate: [
    'int-21', 'int-22', 'int-23', 'int-14', 'int-15', 'bg-14', 'int-16',
    'adv-14', 'int-17', 'int-18', 'int-01', 'int-02', 'int-03', 'int-04',
    'int-05', 'int-10', 'int-hw4', 'int-06', 'int-07', 'int-08', 'int-09',
    'int-trades', 'int-11', 'int-12', 'int-hw2', 'int-13', 'int-19', 'int-20',
  ],
  advanced: [
    'adv-01', 'adv-02', 'adv-03', 'adv-04', 'adv-hw4', 'adv-05', 'adv-06',
    'adv-hw2', 'adv-07', 'adv-08', 'adv-reroute', 'adv-09', 'adv-breaks',
    'adv-10', 'adv-11', 'adv-12', 'adv-13', 'adv-15', 'adv-16', 'adv-17',
    'adv-21', 'adv-18', 'adv-19', 'adv-20',
  ],
  master: [
    'ms-01', 'ms-02', 'ms-03', 'ms-hw2', 'ms-04', 'ms-21', 'ms-05', 'ms-06',
    'ms-07', 'ms-08', 'ms-09', 'ms-10', 'ms-11', 'ms-12', 'ms-13', 'ms-14',
    'ms-15', 'ms-16', 'ms-17', 'ms-18', 'ms-19', 'ms-20',
  ],
  grandmaster: [
    'gm-01', 'gm-02', 'gm-03', 'gm-04', 'gm-05', 'gm-06', 'gm-07', 'gm-08',
    'gm-09', 'gm-10', 'gm-11', 'gm-12', 'gm-13', 'gm-14', 'gm-15', 'gm-16',
    'gm-17', 'gm-18', 'gm-19', 'gm-hw1', 'gm-20',
  ],
}

const DROPPED = new Set([
  'nb-hw1', 'nb-hw2', 'bg-hw2', 'bg-hw3', 'int-hw1', 'int-hw3', 'adv-hw1',
  'adv-hw3', 'ms-hw1',
])

// brace depth outside single-quoted string literals (\' escapes; text bodies
// may contain braces)
function depthDelta(line) {
  let inStr = false
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === "'") inStr = false
    } else if (ch === "'") inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth
}

// Parse a `levels: [...]` array inside a tier file or the book module.
// Tier files: array opens at '  levels: [', blocks at '    {', close '  ],'.
// Book module: arrays open at 'export const hwX: Level[] = [', blocks at
// '  {', close ']'. Detect the block indent from the first block line.
function parseArray(lines, startIdx) {
  const isBookArray = /^export const hw\w+: Level\[\] = \[$/.test(lines[startIdx])
  const blockStart = isBookArray ? '  {' : '    {'
  const closeMarker = isBookArray ? ']' : '  ],'
  const head = lines.slice(0, startIdx + 1)
  let closeIdx = -1
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === closeMarker) { closeIdx = i; break }
  }
  if (closeIdx === -1) throw new Error(`array close not found after line ${startIdx + 1}`)
  const tail = lines.slice(closeIdx)
  const blocks = []
  let i = startIdx + 1
  while (i < closeIdx) {
    if (lines[i] === blockStart) {
      let depth = 1
      const start = i
      i++
      while (i < closeIdx && depth > 0) {
        depth += depthDelta(lines[i])
        if (depth === 0) break
        i++
      }
      blocks.push(lines.slice(start, i + 1))
      i++
    } else {
      i++
    }
  }
  const byId = new Map()
  for (const b of blocks) {
    const m = b.join('\n').match(/id: '([^']+)'/)
    if (!m) throw new Error(`block without id near:\n${b.slice(0, 4).join('\n')}`)
    byId.set(m[1], b)
  }
  return { head, tail, byId }
}

function parseTierFile(file) {
  const src = fs.readFileSync(`${DIR}/${file}.ts`, 'utf8')
  const lines = src.split('\n')
  const arrayStart = lines.findIndex((l) => l === '  levels: [')
  if (arrayStart === -1) throw new Error(`${file}: levels: [ not found`)
  const parsed = parseArray(lines, arrayStart)
  return { file, ...parsed }
}

// The book module: one array per hw export.
function parseBookModule() {
  const src = fs.readFileSync(BOOK, 'utf8')
  const lines = src.split('\n')
  const byId = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (/^export const hw\w+: Level\[\] = \[$/.test(lines[i])) {
      const parsed = parseArray(lines, i)
      for (const [id, block] of parsed.byId) byId.set(id, block)
    }
  }
  return byId
}

const pools = new Map()
for (const f of Object.keys(ORDERS)) {
  const p = parseTierFile(f)
  pools.set(f, p)
}
const bookBlocks = parseBookModule()
// merge book blocks into a global pool (tier blocks win on collision)
const globalPool = new Map()
for (const [id, block] of bookBlocks) globalPool.set(id, block)
for (const p of pools.values()) for (const [id, block] of p.byId) globalPool.set(id, block)

// validation: every order id exists (except marked-new ones), dropped ids are
// not referenced, and every pool id is either ordered or dropped
const NEW_IDS = new Set(['bg-e5', 'bg-kr', 'int-forcing'])
for (const [f, order] of Object.entries(ORDERS)) {
  for (const id of order) {
    if (NEW_IDS.has(id)) continue
    if (!globalPool.has(id)) throw new Error(`order ${f}: unknown id ${id}`)
  }
}
const used = new Set(Object.values(ORDERS).flat())
for (const id of globalPool.keys()) {
  if (!used.has(id) && !DROPPED.has(id)) {
    throw new Error(`id ${id} exists but is in no order and not dropped`)
  }
}

function renumber(block, n) {
  const out = []
  let seenN = false
  for (const line of block) {
    if (!seenN && /^\s+n: \d+,$/.test(line)) { out.push(line.replace(/n: \d+/, `n: ${n}`)); seenN = true }
    else out.push(line)
  }
  if (!seenN) throw new Error(`block missing n line: ${block.slice(0, 4).join(' | ')}`)
  return out
}

// book-module blocks sit at 2-space indent; tier blocks at 4-space. Normalize
// when inlining: shift every non-empty line right by 2. The module's BOOK
// constant becomes a literal (tier files do not define it).
function reindent(block) {
  let out = block
  if (block[0] === '  {') out = block.map((l) => (l.length ? `  ${l}` : l))
  return out.map((l) => l.replace(/\bBOOK\b/g, "'How to Win at Chess (Levy Rozman), applied at this level.'"))
}

for (const [f, order] of Object.entries(ORDERS)) {
  const p = pools.get(f)
  // head without the book-module import and any spread marker knowledge:
  // strip hw import lines
  const head = p.head.filter((l) => !/import \{ hw\w+ \} from '\.\.\/book\//.test(l))
  const out = [...head]
  order.forEach((id, idx) => {
    if (NEW_IDS.has(id)) return // inserted later by hand
    const block = renumber(reindent(globalPool.get(id)), idx + 1)
    // the captured block already ends with its own close line ('    },' for
    // tier blocks, '  },' reindented for book blocks) — never add a second
    const endsWithClose = /^\s*\},\s*$/.test(block[block.length - 1] ?? '')
    out.push(...block)
    if (!endsWithClose) {
      out.push('    },')
    }
    out.push('')
  })
  // tail: drop the spread line
  const tail = p.tail.filter((l) => !/^\s*\.\.\.hw\w+,$/.test(l))
  out.push(...tail)
  fs.writeFileSync(`${DIR}/${f}.ts`, out.join('\n'))
  console.log(`${f}: wrote ${order.filter((id) => !NEW_IDS.has(id)).length} levels`)
}
console.log('restructure complete — book module now orphaned, delete it after review')
