'use client'

import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { hasSpeech, onSpeakingStateChange, speak, stopSpeaking } from '@/lib/speech'
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

  useEffect(() => onSpeakingStateChange((s) => setSpeaking(s)), [])

  function toggle() {
    if (!hasSpeech()) return
    if (speaking) {
      stopSpeaking()
      return
    }
    void speak({ text, voice, speed }).catch(() => {
      /* speech is a nicety; ignore failures */
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label ?? (speaking ? 'Stop reading aloud' : 'Read aloud')}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-accent',
        speaking && 'bg-primary/15 text-primary',
        className,
      )}
    >
      {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  )
}
