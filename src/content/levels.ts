import type { Tier } from './schema'
import { newbie } from './tiers/newbie'
import { beginner } from './tiers/beginner'
import { intermediate } from './tiers/intermediate'
import { advanced } from './tiers/advanced'
import { master } from './tiers/master'
import { grandmaster } from './tiers/grandmaster'

export const TIERS: Tier[] = [newbie, beginner, intermediate, advanced, master, grandmaster]

export interface LevelRef {
  tier: Tier
  level: Tier['levels'][number]
  /** global level number, 1..120 */
  globalN: number
}

export const ALL_LEVELS: LevelRef[] = TIERS.flatMap((tier) =>
  tier.levels.map((level, i) => ({ tier, level, globalN: tier.n * 100 + i + 1 })),
)

export function findLevel(levelId: string): LevelRef | undefined {
  return ALL_LEVELS.find((x) => x.level.id === levelId)
}
