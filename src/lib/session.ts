// Client-side session storage + fetch bridge.
//
// The preview panel embeds the app in a cross-site iframe. Some browsers block
// third-party cookies there entirely, so the httpOnly session cookie alone
// cannot keep a session alive. The auth endpoints therefore also return the
// raw session token in the JSON body; it is mirrored into localStorage and
// attached as an Authorization header to every same-origin /api request.
// The token is a random 256-bit value, equivalent to what the cookie carries.
const TOKEN_KEY = 'chessx.session.token'

export function saveSessionToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // storage unavailable: the cookie path still works where allowed
  }
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // nothing to clear
  }
}

/**
 * Google OAuth cannot hand localStorage to the client, and in a blocked-cookie
 * iframe its redirect would lose the session entirely. The callback therefore
 * appends the token as a URL fragment (#session=...), which is consumed here
 * once and immediately stripped from the address bar.
 */
export function consumeSessionFragment(): void {
  if (typeof window === 'undefined') return
  const m = window.location.hash.match(/^#session=([A-Za-z0-9_-]{20,})$/)
  if (m) {
    saveSessionToken(m[1])
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

let installed = false

/**
 * Wraps window.fetch once so every same-origin /api request automatically
 * carries the Authorization header when a local token exists. Cookie-only
 * clients are unaffected. Same-origin /api only: never attached cross-origin.
 */
function installFetchBridge(): void {
  if (installed || typeof window === 'undefined') return
  if (typeof window.fetch !== 'function') return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url

    if (!url.startsWith('/api/')) return original(input, init)

    const token = getSessionToken()
    if (!token) return original(input, init)

    const headers = new Headers(
      init?.headers ?? (typeof input === 'string' || input instanceof URL ? undefined : input.headers),
    )
    if (headers.has('authorization')) return original(input, init)
    headers.set('authorization', `Bearer ${token}`)
    return original(input, { ...(init ?? {}), headers })
  }
}
installFetchBridge()
