// UCI engine child process. The stockfish wasm glue probes browser globals
// and worker state at load time, which makes it fragile inside a bundled
// Next.js server. Running it here, under plain bun with the same shims the
// puzzle verifier uses, gives a plain UCI engine over stdio that the server
// can talk to like any native engine binary.
//
// Protocol: UCI on stdin/stdout, one line per message. Output lines are the
// engine's own; nothing else may print to stdout.
;(globalThis as unknown as { self: unknown }).self = globalThis
const G = globalThis as Record<string, unknown>
G.self = G
G.location = { hash: '', href: 'file:///engine.js', search: '', pathname: '/engine.js' }
G.document = {}

async function main() {
  const { createRequire } = await import('module')
  const require_ = createRequire(import.meta.url)
  const init = require_('stockfish') as (p?: string) => Promise<Record<string, unknown>>
  const engine = await init('node_modules/stockfish/bin/stockfish-19-single.js')

  const send = (cmd: string) => {
    const ccall = engine.ccall as (...args: unknown[]) => unknown
    return ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })
  }

  // UCI commands are processed in order. The async ccalls (go) are chained so
  // a new command can never interleave with a running search.
  let chain: Promise<unknown> = Promise.resolve()
  const enqueue = (cmd: string) => {
    chain = chain.then(
      () => send(cmd),
      () => send(cmd),
    )
  }

  const readline = require_('readline') as typeof import('readline')
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line: string) => {
    const cmd = line.trim()
    if (!cmd) return
    enqueue(cmd)
    if (cmd === 'quit') {
      Promise.resolve(chain).finally(() => process.exit(0))
    }
  })
  rl.on('close', () => process.exit(0))
}

main().catch((e) => {
  console.error(`engine-child failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
