// Node-only boot logic for instrumentation. This module is reached ONLY
// through the NEXT_RUNTIME-guarded dynamic import in ../instrumentation.ts,
// which makes it a split chunk compiled for the nodejs runtime alone. It must
// stay free of any import from a non-node entry point: pulling bank-bootstrap
// into the root instrumentation graph (or the root layout) drags
// node:child_process into graphs compiled for other runtimes and every page
// 500s with UnhandledSchemeError.
import { kickBankBootstrap } from '@/lib/server/bank-bootstrap'

export function nodeBoot(): void {
  try {
    kickBankBootstrap()
  } catch {
    // Best effort only. The puzzle API routes kick the same idempotent
    // installer as a backstop on first use.
  }
}
