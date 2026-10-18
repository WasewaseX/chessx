'use client'

import { AuthScreen } from '@/components/views/auth-view'

/**
 * Standalone sign-in entry for the desktop shell's Google handoff. The shell
 * opens this URL in the player's SYSTEM browser with
 * ?desktop_port=<port>&desktop_state=<state> so the OAuth round trip starts
 * in a browser that owns the Google session and ends on the shell's loopback
 * listener. Email sign-in works here too: the login response sets the
 * standard session cookie, and the browser returns to the main app. In a
 * normal browser (no desktop params) this page is simply a sign-in screen.
 */
export default function SignInPage() {
  return <AuthScreen onAuthed={() => window.location.replace('/')} />
}
