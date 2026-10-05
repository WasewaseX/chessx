// Active-minute heartbeat. While the player is actually interacting with the
// app the client posts one minute at a time; idle time never counts.
'use client'

import { useEffect, useRef } from 'react'
import { dayKeyLocal } from '@/lib/day'

const TICK_MS = 60_000
const IDLE_LIMIT_MS = 120_000

export function useActivityHeartbeat(enabled: boolean) {
  const lastActive = useRef(Date.now())

  useEffect(() => {
    if (!enabled) return
    const mark = () => {
      lastActive.current = Date.now()
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    for (const e of events) window.addEventListener(e, mark, { passive: true })

    const timer = setInterval(() => {
      if (document.hidden) return
      if (Date.now() - lastActive.current > IDLE_LIMIT_MS) return
      fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayKey: dayKeyLocal(), minutes: 1 }),
      }).catch(() => {})
    }, TICK_MS)

    return () => {
      for (const e of events) window.removeEventListener(e, mark)
      clearInterval(timer)
    }
  }, [enabled])
}
