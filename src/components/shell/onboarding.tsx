'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'

const LEVELS = [
  { id: 'new', title: 'New to chess', desc: 'I know how the pieces move — barely.' },
  { id: 'beginner', title: 'Beginner', desc: 'I play casually and blunder a lot.' },
  { id: 'intermediate', title: 'Intermediate', desc: 'I know basic tactics and openings.' },
  { id: 'advanced', title: 'Advanced', desc: 'Tournament player, solid fundamentals.' },
  { id: 'expert', title: 'Expert', desc: 'Strong club player or above.' },
]

export function Onboarding() {
  const { setProfile } = useApp()
  const [name, setName] = useState('')
  const [skill, setSkill] = useState('beginner')
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Player', skillLevel: skill, onboarded: true }),
      })
      const data = await res.json()
      setProfile(data.profile)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-8 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Ply" className="h-12 w-12 rounded-xl" />
            <div>
              <div className="font-display text-3xl font-extrabold">Ply</div>
              <div className="text-sm text-sidebar-foreground/60">Learn chess properly</div>
            </div>
          </div>

          <h1 className="font-display text-2xl font-bold text-white">Two questions, then we start.</h1>

          <div className="mt-6">
            <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">
              What should we call you?
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A name or nickname"
              maxLength={24}
              className="max-w-xs border-white/15 bg-white/10 text-white placeholder:text-white/40"
            />
          </div>

          <div className="mt-6">
            <div className="mb-1.5 text-sm font-semibold">How would you rate your chess?</div>
            <div className="grid gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSkill(l.id)}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-4 py-3 text-left transition',
                    skill === l.id
                      ? 'border-[#81b64c] bg-[#81b64c]/15'
                      : 'border-white/10 bg-white/5 hover:bg-white/10',
                  )}
                  aria-pressed={skill === l.id}
                >
                  <div>
                    <div className="text-sm font-bold text-white">{l.title}</div>
                    <div className="text-xs text-sidebar-foreground/70">{l.desc}</div>
                  </div>
                  <div
                    className={cn(
                      'h-4 w-4 rounded-full border-2',
                      skill === l.id ? 'border-[#a3d160] bg-[#81b64c]' : 'border-white/25',
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-sidebar-foreground/60">
              This sets your starting ratings and where lessons begin. Ratings stay provisional for your first 10 games.
            </p>
          </div>

          <Button className="btn-hero mt-8 w-full py-3 text-base" onClick={start} disabled={busy}>
            {busy ? 'Setting up…' : 'Start learning'}
          </Button>
        </div>
      </div>
    </div>
  )
}
