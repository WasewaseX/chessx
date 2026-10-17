// Edge proxy: sits on :3000 (where the gateway points) and forwards every
// request to the Next dev server on :3001 with `Connection: close` — one
// fresh upstream connection per request. This kills the gateway's pooled
// keep-alive wedge (half-closed sockets answered with silence) permanently.
// WebSockets (HMR) are tunnelled byte-for-byte after the upgrade.
import http from 'node:http'
import net from 'node:net'

const UP_HOST = '127.0.0.1'
const UP_PORT = 3001
const PORT = 3000

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      host: UP_HOST,
      port: UP_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, connection: 'close', host: `${UP_HOST}:${UP_PORT}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`edge-proxy upstream error: ${err.message}`)
  })
  req.pipe(upstream)
})

// WebSocket passthrough (dev HMR): tunnel raw bytes after the upgrade.
server.on('upgrade', (req, clientSocket, head) => {
  const upstream = net.connect(UP_PORT, UP_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      const value = req.rawHeaders[i + 1]
      lines.push(`${name}: ${name.toLowerCase() === 'connection' ? 'Upgrade' : name.toLowerCase() === 'host' ? `${UP_HOST}:${UP_PORT}` : value}`)
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

server.listen(PORT, () => console.log(`[edge-proxy] :${PORT} -> :${UP_PORT} (connection: close)`))
