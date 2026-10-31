// Cross-platform production launcher: sets NODE_ENV without unix-only env
// syntax, spawns the standalone server, and tees its output to server.log.
//
// Runtime choice (the Oct 22 lesson, updated Oct 24): the standalone
// server.js runs under NODE by default, and parts of the server legitimately
// need node-only builtins — node:sqlite in the gh-snapshot restore path
// (boot-maintenance.ts). Bun does not implement node:sqlite, and running the
// server under bun silently disabled the user-data restore on boot. The
// puzzle core no longer needs node:sqlite at all (light pack + lichess API),
// but the restore path still does, so node stays the launcher default.
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'

// Next.js augments ProcessEnv with `readonly NODE_ENV`, so go through a
// writable view of the env object. Same runtime effect as a plain assignment.
;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

function spawnServer(cmd: 'node' | 'bun') {
  const child = spawn(cmd, ['.next/standalone/server.js'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })
  const log = createWriteStream('server.log', { flags: 'a' })
  const pipe = (chunk: Buffer) => {
    process.stdout.write(chunk)
    log.write(chunk)
  }
  child.stdout.setEncoding('utf8').on('data', pipe)
  child.stderr.setEncoding('utf8').on('data', pipe)
  child.on('error', (err) => {
    if (cmd === 'node' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('[start-prod] node not found; retrying with bun (node:sqlite features unavailable)')
      spawnServer('bun')
      return
    }
    console.error('[start-prod] server failed:', err)
    process.exit(1)
  })
  child.on('exit', (code) => {
    log.end()
    process.exit(code ?? 0)
  })
}

spawnServer('node')
