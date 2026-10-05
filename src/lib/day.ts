// Client-side day key (yyyy-mm-dd in the user's local timezone).
// The app is single-user and local-first: the browser's clock is the clock.
export function dayKeyLocal(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a dayKey string by n days (local calendar math). */
export function dayKeyShift(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return dayKeyLocal(date)
}

/** List of dayKeys ending at `end` (inclusive), walking back `count` days. */
export function dayKeyRange(count: number, end = dayKeyLocal()): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(dayKeyShift(end, -i))
  return out
}
