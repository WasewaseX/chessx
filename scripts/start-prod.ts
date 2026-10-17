// Cross-platform production launcher: sets NODE_ENV without unix-only env
// syntax, spawns the standalone server, and tees its output to server.log.
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'

// Next.js augments ProcessEnv with `readonly NODE_ENV`, so go through a
// writable view of the env object. Same runtime effect as a plain assignment.
;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

const server = spawn('bun', ['.next/standalone/server.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
})

const log = createWriteStream('server.log', { flags: 'a' })
const pipe = (chunk: Buffer) => {
  process.stdout.write(chunk)
  log.write(chunk)
}
server.stdout.setEncoding('utf8').on('data', pipe)
server.stderr.setEncoding('utf8').on('data', pipe)
server.on('exit', (code) => {
  log.end()
  process.exit(code ?? 0)
})
