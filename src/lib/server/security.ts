// Two small security primitives shared by the AI settings path:
//
// 1. secretBox: authenticated encryption (AES-256-GCM) for BYO provider API
//    keys at rest. The master key comes from CHESSX_SECRET; when absent, a
//    random key is generated once and kept in db/.secret (gitignored, outside
//    any backup of the source tree). Ciphertext format: enc.v1.<iv>.<tag>.<ct>
//    in base64url. Plaintext legacy values pass through unchanged so an old
//    database keeps working; it is re-encrypted on the next profile save.
//
// 2. assertSafeAiEndpoint: SSRF guard for student-provided AI base URLs. The
//    server-side fetch carries the student's bearer key, so a crafted URL
//    must never be able to probe loopback, private or link-local ranges.
import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Secret box
// ---------------------------------------------------------------------------

const PREFIX = 'enc.v1'

let cachedKey: Buffer | null = null

function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  const fromEnv = process.env.CHESSX_SECRET
  if (fromEnv && fromEnv.length >= 16) {
    // Derive a stable 32-byte key from whatever secret was provided.
    cachedKey = createHash('sha256').update(`chessx-secret-box:${fromEnv}`).digest()
    return cachedKey
  }
  // No env secret: persist a random key next to the database so restarts can
  // still decrypt what previous sessions encrypted.
  try {
    const file = path.join(process.cwd(), 'db', '.secret')
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim()
      if (existing.length >= 32) {
        cachedKey = Buffer.from(existing, 'base64')
        if (cachedKey.length === 32) return cachedKey
      }
    }
    const fresh = randomBytes(32)
    writeFileSync(file, fresh.toString('base64'), { mode: 0o600 })
    cachedKey = fresh
    return cachedKey
  } catch {
    // A read-only filesystem still gets a process-lifetime key: encryption
    // works this session, and values re-encrypt with the persistent key later.
    cachedKey = randomBytes(32)
    return cachedKey
  }
}

export function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(`${PREFIX}.`)) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const enc = (b: Buffer) => b.toString('base64url')
  return `${PREFIX}.${enc(iv)}.${enc(tag)}.${enc(ct)}`
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!stored.startsWith(`${PREFIX}.`)) return stored // legacy plaintext
  try {
    const [, ivB64, tagB64, ctB64] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()])
    return pt.toString('utf8')
  } catch {
    // Wrong master key or corrupted row: report "not set" instead of crashing.
    return null
  }
}

export function isEncryptedSecret(v: string | null | undefined): boolean {
  return Boolean(v && v.startsWith(`${PREFIX}.`))
}

// ---------------------------------------------------------------------------
// SSRF guard for custom AI endpoints
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
])

function isPrivateV4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT range
  if (a >= 224) return true // multicast + reserved
  return false
}

function isPrivateV6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '::1' || h === '::' || h === '::ffff:0:0') return true
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  // IPv4-mapped (::ffff:10.0.0.1)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h)
  if (mapped) return isPrivateV4(mapped[1])
  return false
}

export class EndpointError extends Error {}

/**
 * Validate a student-provided AI base URL. Throws EndpointError with a
 * student-safe message when the destination is not a public https/http API.
 * Set AI_ALLOW_PRIVATE_ENDPOINTS=1 to permit loopback endpoints (local
 * Ollama, LM Studio) in a trusted dev environment.
 */
export function assertSafeAiEndpoint(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new EndpointError('That base URL does not parse. Use a full https:// address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EndpointError('Only http and https base URLs are supported.')
  }
  if (url.protocol === 'http:' && process.env.NODE_ENV === 'production' && process.env.AI_ALLOW_INSECURE_HTTP !== '1') {
    throw new EndpointError('Custom endpoints must use https in production.')
  }
  const host = url.hostname.toLowerCase()
  if (process.env.AI_ALLOW_PRIVATE_ENDPOINTS === '1') return // explicit dev override
  if (BLOCKED_HOSTNAMES.has(host)) throw new EndpointError('That host is not allowed as a custom AI endpoint.')
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new EndpointError('That host is not allowed as a custom AI endpoint.')
  }
  if (isPrivateV4(host)) throw new EndpointError('Private network addresses are not allowed as custom AI endpoints.')
  if (host.includes(':') && isPrivateV6(host)) throw new EndpointError('Private network addresses are not allowed as custom AI endpoints.')
}
