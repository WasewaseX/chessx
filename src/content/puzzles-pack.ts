import type { Puzzle } from './schema'

// Extended puzzle pack. Every entry here is replayed by validate.ts —
// legality, SAN suffixes, mate endings and material wins are all enforced.
export const PUZZLES_PACK: Puzzle[] = []
