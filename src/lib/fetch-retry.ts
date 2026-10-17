'use client'
// Hardened client fetch: every request gets a hard timeout and one silent
// retry. Why: behind the sandbox gateway a pooled keep-alive connection can
// occasionally wedge mid-response; a fresh connection answers instantly.
// The retry turns that rare wedge into a ~3s delay instead of an eternal
// spinner: the aborted attempt frees the wedged keep-alive socket, so the
// retry opens a fresh one and answers instantly. App behavior is otherwise identical (same headers, same
// credentials policy, same response object for consumers).
//
// IMPORTANT: this runs in the browser only (imported from the client page).
// It never touches server-side fetches.

// Attempt timeouts: a wedged keep-alive hop unwedges within ~3s (fresh
// socket), but a cold dev-mode route compile can take 30s — so the ladder
// widens instead of giving up.
const TIMEOUT_MS_LADDER = [3_500, 8_000, 20_000]

function withTimeout(signal: AbortSignal | null | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new DOMException('Timeout', 'TimeoutError')), ms)
  const cancel = () => clearTimeout(timer)
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason)
    else signal.addEventListener('abort', () => ctl.abort(signal.reason), { once: true })
  }
  return { signal: ctl.signal, cancel }
}

export function installFetchHardening(): void {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __fetchHardened?: boolean }
  if (w.__fetchHardened) return
  w.__fetchHardened = true

  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // never harden the HMR/dev overlays or socket polling (they manage their own lifecycles)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/_next/webpack-hmr') || url.includes('/socket.io/')) {
      return original(input as RequestInfo, init)
    }
    let lastError: unknown = null
    for (let attempt = 0; attempt <= TIMEOUT_MS_LADDER.length; attempt++) {
      const { signal, cancel } = withTimeout(init?.signal, TIMEOUT_MS_LADDER[Math.min(attempt, TIMEOUT_MS_LADDER.length - 1)])
      try {
        const res = await original(input as RequestInfo, { ...init, signal })
        cancel()
        // A wedged keep-alive connection can also manifest as a response that
        // never finishes. We cannot re-read the body here, so only status
        // failures are retried; consumers handle their own body errors.
        return res
      } catch (err) {
        cancel()
        lastError = err
        // the caller's own abort must not be retried
        if (init?.signal?.aborted) throw err
        if (attempt < TIMEOUT_MS_LADDER.length) {
          await new Promise((r) => setTimeout(r, 250))
          continue
        }
        throw lastError
      }
    }
    throw lastError
  }
}
