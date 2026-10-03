import type { Level } from './schema'
import { level1 } from './levels/first-moves'
import { level2 } from './levels/opening-play'
import { level3 } from './levels/winning-material'
import { level4 } from './levels/endgame-strategy'
import { level5 } from './levels/master-class'

export const LEVELS: Level[] = [level1, level2, level3, level4, level5]

export const ALL_LESSONS = LEVELS.flatMap((l) =>
  l.lessons.map((lesson) => ({ level: l, lesson })),
)

export function findLesson(lessonId: string) {
  return ALL_LESSONS.find((x) => x.lesson.id === lessonId)
}
