'use client'

import { useEffect, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'
import { onSpeakingStateChange, speak, stopSpeaking } from '@/lib/speech'
import { cn } from '@/lib/utils'

interface SpeakButtonProps {
  text: string
  voice: string
  speed?: number
  className?: string
  label?: string
}

/** Small speaker control: hears any coach or lesson text out loud. */
export function SpeakButton({ text, voice, speed = 1, className, label }: SpeakButtonProps) {
  const [speaking, setSpeaking] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => onSpeakingStateChange((s) => setSpeaking(s)), [])

  async function toggle() {
    if (speaking) {
      stopSpeaking()
      return
    }
    setLoading(true)
    try {
      await speak({ text, voice, speed })
    } catch {
      /* speech is a nicety; ignore failures */
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading && !speaking}
      aria-label={label ?? (speaking ? 'Stop reading aloud' : 'Read aloud')}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-accent',
        speaking && 'bg-primary/15 text-primary',
        className,
      )}
    >
      {loading && !speaking ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : speaking ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </button>
  )
}
