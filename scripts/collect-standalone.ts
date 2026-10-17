// Cross-platform replacement for `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`.
// Copies the client assets into the standalone output so the production
// server can serve them; works on Windows, macOS and Linux alike.
import { cpSync, existsSync } from 'fs'
import path from 'path'

const root = process.cwd()
const standalone = path.join(root, '.next', 'standalone')

if (!existsSync(standalone)) {
  console.error('collect-standalone: .next/standalone missing. Run `next build` first.')
  process.exit(1)
}

cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true })
cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
console.log('collect-standalone: static and public copied into .next/standalone')
