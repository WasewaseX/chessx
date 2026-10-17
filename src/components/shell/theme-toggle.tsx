'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useApp, type ProfileData } from '@/lib/store'
import { readJson } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/**
 * Quick light/dark switch, chess.com-style: one icon button that flips the
 * theme instantly. The icons crossfade via .dark CSS (next-themes sets the
 * class before first paint, so there is no hydration mismatch and no
 * mounted-state dance). When the stored preference is "system", the button
 * shows the resolved look and flipping it stores an explicit choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { profile, patchProfile } = useApp()
  const { setTheme, resolvedTheme } = useTheme()

  // undefined during the very first render → default the label to "dark";
  // the visible icon is CSS-driven so it is always correct.
  const isDark = resolvedTheme === 'dark'

  async function toggle() {
    const next = isDark ? 'light' : 'dark'
    // optimistic: paint immediately, then persist to the account
    setTheme(next)
    patchProfile({ darkMode: next })
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ darkMode: next }),
      })
      const d = await readJson<{ profile?: ProfileData }>(res)
      if (d.profile) patchProfile(d.profile)
    } catch {
      // cosmetic preference: keep the optimistic theme even if the save fails
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/70 transition-all duration-150 hover:bg-sidebar-accent hover:text-white active:scale-90',
        className,
      )}
    >
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
      <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
    </button>
  )
}
