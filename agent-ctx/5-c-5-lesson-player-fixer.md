# Task 5-c-5 work record: lesson-player-fixer

Date: 2026-10-05
Task: fix 4 critique findings (C5, U1, U2, U3) in the lesson player completion flow and the Study locked-row wording.

## Read first
- worklog.md (Task 0 and 5-b entries), src/lib/unlock.ts, src/content/levels.ts, src/content/graduation.ts, src/lib/chess/sounds.ts, src/lib/store.ts ViewName.
- Scoped to exactly two files: src/components/views/lesson-player.tsx and src/components/learn/lesson-contents.tsx. No content, unlock.ts, API or view changes; no new dependencies; dev server not restarted.

## Fixes
- C5 (silent correct quiz answers): in QuizStepView.choose(), on a FIRST-try correct option (misses === 0) call playSound('correct', soundEnabled) once, using the same soundEnabled prop every other playSound call in the file receives. Wrong answers and retry-corrects stay silent, matching drills/playouts behavior elsewhere.
- U1 (chapter boundary recommends a done level): computed fallbackNext = nextUnlockedId(new Set([...doneIds, lesson.id])) whenever the flat next level is already done (skip-ahead or replay), resolved to its Level via findLevel. Both the teaser line and the CTA now use targetNext = nextAlreadyDone ? fallbackNext : nextLevel; onContinue navigates to targetNext or falls back to 'lessons'. The fallback teaser always reads the plain "Next up: title. subtitle" shape (no wrong "Level 1:" opener line). The unlock badge (unlockedNow) still keys off the flat next level, so it stays quiet exactly when the finish unlocked nothing new; the chapter-complete headline is untouched.
- U2 (gm-20 gets the generic chapter treatment): courseComplete = lesson.id === ALL_LEVELS[ALL_LEVELS.length - 1]?.level.id renders a distinct course celebration: headline "120 levels. Every one of them yours.", honest subline "You started not knowing how the knights jump. You finish reading positions like a grandmaster.", existing confetti and superpower card kept, and two CTAs (Play, Puzzles) wired through new onPlay/onPuzzles props to the same navigate mechanism ('play' / 'puzzles' are valid ViewNames). Only that one level gets this screen.
- U3 (awkward locked-row wording): lesson-contents locked rows now read "Unlocks after Level 3, The knight" by embedding the unlockRequirement output minus its leading "Finish " verb; the dead `?? 'Finish the earlier levels'` fallback is dropped (locked implies n > 1 implies a requirement exists). The aria rowAria path was already fine and untouched.

## Verification
- bun run lint: clean, 0 errors.
- tsc --noEmit: lesson-contents 0 errors; lesson-player error set byte-identical to the HEAD version of the file (same 15 pre-existing errors, 0 new; verified by swapping the HEAD file in and diffing normalized error sets).
- git diff of both files scanned for em/en dashes: 0. Diff is 55 added / 12 removed lines, all in the two allowed files.
- GET / on the dev server returns 200, dev.log shows no compile errors after the edits.
- Behavior invariants kept: normal next levels and normal chapter ends render exactly as before ("Level 1:" template only reachable with n === 1; CTA label logic unchanged for those paths; "Back to the course" remains for the exotic out-of-order course end that is not the last ALL_LEVELS entry).

## Notes
- GRADUATION covers all 120 level ids, so the course-complete card always has its superpower line.
- nextUnlockedId can only return null when the course is finished, so a missing fallback coexists with the U2 screen only via the strict gm-20 check the brief asked for.
