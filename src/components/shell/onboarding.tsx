'use client'
import { readJson } from '@/lib/api-client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApp, type ProfileData } from '@/lib/store'
import { clearSessionToken } from '@/lib/session'
import { CoachCards } from '@/components/shell/coach-choice'
import { cn } from '@/lib/utils'
import { ChevronLeft, Loader2 } from 'lucide-react'

const LEVELS = [
  { id: 'new', title: 'New to chess', desc: 'I know how the pieces move. Barely.' },
  { id: 'beginner', title: 'Beginner', desc: 'I play casually and blunder a lot.' },
  { id: 'intermediate', title: 'Intermediate', desc: 'I know basic tactics and openings.' },
  { id: 'advanced', title: 'Advanced', desc: 'Tournament player, solid fundamentals.' },
  { id: 'expert', title: 'Expert', desc: 'Strong club player or above.' },
]

export function Onboarding() {
  const { setProfile } = useApp()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [coachId, setCoachId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [skill, setSkill] = useState('beginner')
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState(false)
  // Import-first step (chessigma's loop starts at "connect chess.com/lichess"):
  // optional, honest, never a trap — skipping just means the coach starts empty.
  const [platform, setPlatform] = useState<'chesscom' | 'lichess'>('chesscom')
  const [importUser, setImportUser] = useState('')
  const [importState, setImportState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [importMsg, setImportMsg] = useState('')
  const [importPromise, setImportPromise] = useState<Promise<unknown> | null>(null)

  function beginImport() {
    const username = importUser.trim()
    if (!username || importState === 'running') return
    setImportState('running')
    setImportMsg('Contacting ' + (platform === 'chesscom' ? 'chess.com' : 'Lichess') + '…')
    const p = fetch('/api/import/username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, username, months: 3 }),
    })
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; imported?: number; fetched?: number; error?: string }
        if (!res.ok || !d.ok) throw new Error(d.error ?? 'Import failed')
        setImportState('done')
        setImportMsg(`Imported ${d.imported ?? 0} of ${d.fetched ?? 0} games. Your coach will study them — Chess DNA, Today's Plan and Openings to fix all come from real games.`)
      })
      .catch((err: unknown) => {
        setImportState('error')
        setImportMsg(err instanceof Error && err.message ? err.message : 'Import failed. You can retry or skip — email games can be added later.')
      })
    setImportPromise(p)
  }

  async function start() {
    if (!coachId) return
    setBusy(true)
    setStartError(false)
    try {
      // wait for an in-flight import (bounded by the server's own budget) but
      // never let an import failure block account setup
      if (importPromise) await importPromise.catch(() => {})
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Player', skillLevel: skill, coach: coachId, onboarded: true }),
      })
      const data = await readJson<{ profile?: ProfileData }>(res)
      if (!data.profile) throw new Error('no profile in response')
      setProfile(data.profile)
    } catch {
      // never trap the user here: show what happened and let them retry
      setStartError(true)
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearSessionToken()
    window.location.reload()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-sidebar text-sidebar-foreground">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-8 flex items-center gap-3">
            <img src="/brand.svg" alt="ChessX" className="h-12 w-12 rounded-xl" />
            <div className="font-display text-3xl font-extrabold">ChessX</div>
          </div>

          {step === 1 ? (
            <>
              <h1 className="font-display text-2xl font-bold text-white">First, choose your coach.</h1>
              <p className="mt-1 text-sm text-sidebar-foreground/70">
                They teach your lessons, comment your games and speak out loud. Nothing is picked for you.
              </p>
              <div className="mt-5 rounded-2xl border border-white/10 bg-background/95 p-4 text-foreground shadow-xl">
                <CoachCards value={coachId} onChange={setCoachId} columns={2} />
              </div>
              <Button
                className="btn-hero mt-6 w-full py-3 text-base"
                onClick={() => setStep(2)}
                disabled={!coachId}
              >
                {coachId ? 'Next' : 'Pick a coach to continue'}
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <h1 className="font-display text-2xl font-bold text-white">Two quick questions.</h1>

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
                  This sets where lessons begin. Online ratings start at 1000 for everyone, like chess.com, and settle as you play.
                </p>
              </div>

              <div className="mt-8 flex gap-2">
                <Button variant="outline" className="px-4" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button className="btn-hero flex-1 py-3 text-base" onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-white">Bring your games.</h1>
              <p className="mt-1 text-sm text-sidebar-foreground/70">
                Works with Chess.com · Lichess. Your coach studies real games — Chess DNA, Today’s Plan and
                Openings to fix are all derived from them. You can also do this later from Home.
              </p>

              <div className="mt-6 rounded-2xl border border-white/10 bg-background/95 p-4 text-foreground shadow-xl">
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Game source">
                  {([
                    { id: 'chesscom', label: 'Chess.com' },
                    { id: 'lichess', label: 'Lichess' },
                  ] as const).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatform(p.id)}
                      aria-pressed={platform === p.id}
                      className={cn(
                        'rounded-md border px-4 py-2.5 text-sm font-bold transition',
                        platform === p.id
                          ? 'border-[#81b64c] bg-[#81b64c]/15 text-foreground'
                          : 'border-black/10 bg-black/5 text-muted-foreground hover:bg-black/10',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    aria-label={`${platform === 'chesscom' ? 'Chess.com' : 'Lichess'} username`}
                    value={importUser}
                    onChange={(e) => setImportUser(e.target.value)}
                    placeholder={platform === 'chesscom' ? 'e.g. hikaru' : 'e.g. DrNykterstein'}
                    maxLength={30}
                    disabled={importState === 'running'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') beginImport()
                    }}
                  />
                  <Button
                    variant="secondary"
                    className="shrink-0 px-4"
                    onClick={beginImport}
                    disabled={importState === 'running' || importUser.trim().length < 2}
                  >
                    {importState === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Import
                  </Button>
                </div>
                {importState !== 'idle' && importMsg && (
                  <p
                    className={cn(
                      'mt-2 text-xs font-semibold',
                      importState === 'done' ? 'text-[#5d8c3a]' : importState === 'error' ? 'text-red-600' : 'text-muted-foreground',
                    )}
                    role={importState === 'error' ? 'alert' : 'status'}
                  >
                    {importMsg}
                  </p>
                )}
              </div>

              <div className="mt-8 flex gap-2">
                <Button variant="outline" className="px-4" onClick={() => setStep(2)}>
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button className="btn-hero flex-1 py-3 text-base" onClick={start} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? 'Setting up…' : 'Start learning'}
                </Button>
              </div>

              {startError && (
                <div
                  className="mt-3 flex items-center justify-between gap-3 rounded-md border border-red-300/30 bg-red-300/10 px-3 py-2"
                  role="alert"
                >
                  <span className="text-xs font-semibold text-red-200">Could not save your setup. Check your connection.</span>
                  <button
                    type="button"
                    onClick={start}
                    disabled={busy}
                    className="text-xs font-bold text-red-200 underline underline-offset-2 disabled:opacity-50"
                  >
                    Retry
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={signOut}
              className="text-xs font-semibold text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
