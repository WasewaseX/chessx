'use client'
import { readJson } from '@/lib/api-client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CharacterFace } from '@/components/chess/characters'
import { cn } from '@/lib/utils'
import { saveSessionToken } from '@/lib/session'
import { Check, Loader2, Lock, Mail, UserRound } from 'lucide-react'

type Mode = 'login' | 'signup'

// Italian Game, a position every club player recognizes: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5
const HERO_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R'
const COACH_IDS = ['nina', 'victor', 'elena', 'sasha'] as const

function HeroBoard() {
  const rows = HERO_FEN.split('/').map((row) => {
    const cells: string[] = []
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < Number(ch); i++) cells.push('')
      } else {
        cells.push(ch)
      }
    }
    return cells
  })
  return (
    <div className="auth-float overflow-hidden rounded-xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/15">
      <div className="grid grid-cols-8" role="img" aria-label="A chess board in the Italian Game opening">
        {rows.flatMap((cells, r) =>
          cells.map((piece, c) => (
            <div
              key={`${r}-${c}`}
              className={cn('h-9 w-9 sm:h-10 sm:w-10', (r + c) % 2 === 0 ? 'bg-[#ebecd0]' : 'bg-[#739552]')}
            >
              {piece && (
                <img
                  src={`/pieces/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`}
                  alt=""
                  className="h-full w-full"
                  draggable={false}
                />
              )}
            </div>
          )),
        )}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5h-4v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"
      />
    </svg>
  )
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-sidebar-foreground/85">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#81b64c]/20">
        <Check className="h-3 w-3 text-[#a3d160]" strokeWidth={3} />
      </span>
      {children}
    </li>
  )
}

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [identity, setIdentity] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleNotice, setGoogleNotice] = useState<string | null>(null)

  // Google redirects back with ?authError=...; surface it as a normal inline error.
  useEffect(() => {
    const kind = new URLSearchParams(window.location.search).get('authError')
    if (!kind) return
    setError(kind === 'unsupported' ? 'This account is not supported' : 'Google sign-in failed. Try again.')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)

    // same neutral answer the server gives, just without the round trip
    if (mode === 'signup') {
      const at = email.lastIndexOf('@')
      const domain = at > 0 ? email.slice(at + 1).trim().toLowerCase() : ''
      if (domain !== 'gmail.com') {
        setError('This account is not supported')
        return
      }
    }

    setBusy(true)
    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const body = mode === 'signup' ? { email, username, password } : { identity, password }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        token?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.')
        return
      }
      // Mirror the session token for browsers that block cookies in the
      // preview iframe. The cookie (when allowed) keeps working in parallel.
      if (data.token) saveSessionToken(data.token)
      onAuthed()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function googleFlow() {
    if (googleBusy) return
    setGoogleBusy(true)
    setError(null)
    setGoogleNotice(null)
    try {
      const res = await fetch('/api/auth/google/start')
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      setGoogleNotice('Google sign-in is not configured on this deployment yet. Use email meanwhile.')
    } catch {
      setGoogleNotice('Could not start Google sign-in. Try again.')
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-sidebar text-sidebar-foreground">
      <style>{`
        @keyframes authFloat { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-10px) rotate(0.5deg); } }
        .auth-float { animation: authFloat 7s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .auth-float { animation: none; } }
      `}</style>

      {/* ambient glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/3 h-[420px] w-[720px] rounded-full bg-[#81b64c]/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-[320px] w-[420px] rounded-full bg-[#f7c331]/5 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-full w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 lg:grid-cols-[1.05fr_440px] lg:gap-16">
        {/* hero, desktop only */}
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <img src="/brand.svg" alt="ChessX" className="h-12 w-12 rounded-xl shadow-lg" />
            <span className="font-display text-3xl font-extrabold tracking-tight text-white">ChessX</span>
          </div>

          <h1 className="mt-8 max-w-md font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-white">
            The study. Not the arcade.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-sidebar-foreground/75">
            A coach who speaks walks you through every lesson. Character bots spar with you for
            free. Your rating comes from real games against real people, earned the same way
            chess.com does it.
          </p>

          <ul className="mt-6 max-w-md space-y-3">
            <Feature>
              All 120 lessons free and open, no weekly cap. chess.com keeps most of its lesson
              library behind a paid plan.
            </Feature>
            <Feature>
              Every lesson plays out on a real board, move by move, with a coach who corrects each
              step as you go. Not videos to sit through.
            </Feature>
            <Feature>
              One Elo, seeded at the level you pick, moved only by rated games, with the same Glicko
              math chess.com runs. A 1100 there is a 1100 here, not a 700 and not a 1600.
            </Feature>
          </ul>

          <div className="mt-10 flex items-center gap-8">
            <HeroBoard />
            <div>
              <div className="flex -space-x-2.5">
                {COACH_IDS.map((id) => (
                  <div key={id} className="h-11 w-11 overflow-hidden rounded-full ring-2 ring-sidebar">
                    <CharacterFace id={id} label={id} />
                  </div>
                ))}
              </div>
              <p className="mt-3 max-w-[200px] text-sm leading-snug text-sidebar-foreground/70">
                Four coaches to choose from. They talk you through every mistake.
              </p>
            </div>
          </div>
        </section>

        {/* compact brand, mobile only */}
        <div className="flex items-center justify-center gap-3 lg:hidden">
          <img src="/brand.svg" alt="ChessX" className="h-11 w-11 rounded-xl shadow-lg" />
          <span className="font-display text-3xl font-extrabold tracking-tight text-white">ChessX</span>
        </div>

        {/* auth card */}
        <section className="w-full rounded-2xl border border-white/10 bg-background p-6 text-foreground shadow-2xl sm:p-8">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'login' ? 'Your lessons and ratings are waiting.' : 'Free to join. It takes ten seconds.'}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1" role="tablist">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m)
                  setError(null)
                  setGoogleNotice(null)
                }}
                className={cn(
                  'rounded-md py-2 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                  mode === m
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={googleFlow}
              disabled={googleBusy}
              className="h-11 w-full bg-white text-[#1f1f1f] hover:bg-white/90"
            >
              {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              Continue with Google
            </Button>
            {googleNotice && (
              <p role="status" className="mt-2 text-center text-xs font-medium text-muted-foreground">
                {googleNotice}
              </p>
            )}
          </div>

          <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
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
                      placeholder="you@gmail.com"
                      autoComplete="email"
                      maxLength={254}
                      className="pl-9"
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Gmail addresses only for new accounts.</p>
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
                    placeholder="you@gmail.com"
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

            <div aria-live="polite">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {error}
                </div>
              )}
            </div>

            <Button type="submit" className="btn-hero h-11 w-full text-base" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            {mode === 'signup'
              ? 'Your password is hashed and never stored in plain text.'
              : 'New here? Switch to Sign up above.'}
          </p>
        </section>
      </div>

      <p className="relative pb-6 text-center text-xs text-sidebar-foreground/40">© ChessX</p>
    </div>
  )
}
