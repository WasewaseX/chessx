// Node-only boot logic for instrumentation. This module is reached ONLY
// through the NEXT_RUNTIME-guarded dynamic import in ../instrumentation.ts,
// which makes it a split chunk compiled for the nodejs runtime alone. It must
// stay free of any import from a non-node entry point: pulling bank-bootstrap
// into the root instrumentation graph (or the root layout) drags
// node:child_process into graphs compiled for other runtimes and every page
// 500s with UnhandledSchemeError.
//
// The admin bootstrap is loaded through the same guard shape the root
// instrumentation uses: the import() must sit AFTER the NEXT_RUNTIME early
// return so the edge compilation dead-eliminates the whole branch (its
// module tree needs node-only 'crypto' and cannot enter another runtime's
// webpack graph).
import { kickBankBootstrap } from '@/lib/server/bank-bootstrap'

export function nodeBoot(): void {
  try {
    kickBankBootstrap()
  } catch {
    // Best effort only. The puzzle API routes kick the same idempotent
    // installer as a backstop on first use.
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  void import('./admin-bootstrap')
    .then((m) => m.ensureAdminAccount())
    .catch(() => {
      // Best effort only: a missing admin account must never block boot.
    })
  // Daily snapshot + empty-database admin guard (boot-maintenance.ts). Same
  // guarded dynamic-import shape: its module tree lazily requires node
  // builtins, which must never enter another runtime's webpack graph.
  void import('./boot-maintenance')
    .then((m) => m.kickBootMaintenance())
    .catch(() => {
      // Best effort only: failed maintenance must never block boot.
    })
}
