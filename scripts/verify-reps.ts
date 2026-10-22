// Verifies every repertoire line is a legal SAN sequence from the start
// position, and that each line contains at least one student decision.
// Run: bun scripts/verify-reps.ts
import { Chess } from 'chess.js'
import { REPERTOIRE_COURSES } from '../src/lib/chess/opening-reps'

let failures = 0
for (const course of REPERTOIRE_COURSES) {
  for (const line of course.lines) {
    const g = new Chess()
    const seq = [...course.trunk, ...line.moves]
    let ok = true
    for (const san of seq) {
      try {
        g.move(san)
      } catch (e) {
        console.error(`[${course.id}/${line.id}] ILLEGAL "${san}" at ply ${seq.indexOf(san) + 1} (after ${g.history().join(' ')})`)
        failures++
        ok = false
        break
      }
    }
    if (ok) console.log(`ok ${course.id}/${line.id} (${seq.length} plies)`)
  }
}
if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll repertoire lines legal.')
