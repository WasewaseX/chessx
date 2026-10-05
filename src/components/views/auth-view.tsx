'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Loader2, Lock, Mail, UserRound } from 'lucide-react'

type Mode = 'login' | 'signup'

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [identity, setIdentity] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const body = mode === 'signup' ? { email, username, password } : { identity, password }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.')
        return
      }
      onAuthed()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-10 px-4 py-10 lg:flex-row lg:gap-16">
        {/* brand side */}
        <div className="w-full max-w-sm text-center lg:text-left">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <img src="/brand.svg" alt="ChessX" className="h-14 w-14 rounded-xl shadow-lg" />
            <div className="font-display text-4xl font-extrabold tracking-tight text-white">ChessX</div>
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold leading-snug text-white">
            Train with a speaking coach. Play real opponents. Watch the rating prove it.
          </h1>
          <ul className="mt-6 space-y-2.5 text-sm text-sidebar-foreground/80">
            <li className="flex items-start gap-2">
              <Check /> 6 tiers, 120 interactive lessons with a coach who speaks
            </li>
            <li className="flex items-start gap-2">
              <Check /> Rated online games with real Glicko ratings, like chess.com
            </li>
            <li className="flex items-start gap-2">
              <Check /> 14 character bots with estimated Elo for casual practice
            </li>
          </ul>
        </div>

        {/* form side */}
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-6 text-foreground shadow-2xl">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1" role="tablist">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m)
                  setError(null)
                }}
                className={cn(
                  'rounded-md py-2 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                  mode === m ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="su-username">Username</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="su-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="MagnusFan_99"
                      autoComplete="username"
                      maxLength={20}
                      className="pl-9"
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">3 to 20 characters, letters, numbers, underscore.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="su-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      maxLength={254}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="li-identity">Email or username</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="li-identity"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    maxLength={254}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pw"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  maxLength={128}
                  className="pl-9 pr-16"
                  required
                  minLength={mode === 'signup' ? 8 : 1}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="btn-hero w-full py-3 text-base" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {mode === 'signup'
              ? 'Your password is hashed with bcrypt. Sessions are server-side and httpOnly.'
              : 'New here? Switch to Sign up above. It takes ten seconds.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function Check() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#81b64c]/20 text-xs font-bold text-[#a3d160]">
      ✓
    </span>
  )
}
