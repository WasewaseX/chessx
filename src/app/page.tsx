import ClientApp from '@/components/shell/client-app'

// WHY THIS PAGE IS STATIC — the platform's preview/health probes hit GET /
// every ~2.5 seconds around the clock (measured Oct 24: 17 probes per 45s,
// all arriving through the platform proxy on [::1]). When this page was a
// 'use client' component, EVERY probe paid a full dev-mode server render of
// the whole client shell (~60-90ms render + compile-staleness checks) — a
// permanent, self-inflicted load floor on a 4GB box: constant CPU, allocator
// churn against the 1536MB heap cap, and real OOM/overload pressure exactly
// when compiles and boot windows need headroom. That baseline load is the
// "overload" half of the render-fail class.
//
// The page is a pure client shell: auth, theme, and routing all resolve on
// the client (via /api/auth/me etc.), and the layout uses no dynamic APIs —
// so the server-rendered output is identical on every request and can be
// prerendered once. force-static turns the probe flood into cache hits:
// near-zero CPU per probe, on the same HTML the browser gets.
//
// Nothing user-facing changes: the served shell, hydration, OAuth fragment
// flow (?dna= token handling happens in a client effect) and every view are
// untouched. Only the per-request server cost disappears.
export const dynamic = 'force-static'

export default function Page() {
  return <ClientApp />
}
