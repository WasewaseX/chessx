// Next.js instrumentation hook: runs once when the server boots. The puzzle
// bank bootstrap is kicked here so a fresh environment starts healing itself
// immediately. All node-only work is behind a NEXT_RUNTIME-guarded dynamic
// import: instrumentation is compiled for every runtime, and the node-only
// module tree (child_process, fs, node:sqlite) must never enter another
// runtime's webpack graph.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  try {
    const { nodeBoot } = await import('./lib/server/instrumentation-node')
    nodeBoot()
  } catch {
    // Never let bootstrap scheduling take the server down. API routes will
    // kick it again on the first puzzle request.
  }
}
