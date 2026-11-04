import { SOURCE_SUPABASE_PROJECT } from '../../../scripts/lib/database-target.mjs'
import { identityLegacyProofConfig } from './identity-runtime-config'
import { UUID } from './owned-principal'

const MAX_BODY = 65_536
export function legacyPasswordProofConfig(env: Record<string, string | undefined> = process.env) {
  const configured = identityLegacyProofConfig(env), url = new URL(configured.url)
  const ref = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname)?.[1]
  if (!ref || (env.NODE_ENV === 'production' && ref !== SOURCE_SUPABASE_PROJECT) || url.protocol !== 'https:' || url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Existing account proof unavailable')
  const key = configured.anonKey
  if (!key || key.length > 8192 || /\s/.test(key)) throw new Error('Existing account proof unavailable')
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error('Existing account proof unavailable')
    const claims: unknown = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'))
    if (!claims || typeof claims !== 'object' || (claims as Record<string, unknown>).role !== 'anon'
      || (claims as Record<string, unknown>).ref !== ref) throw new Error('Existing account proof unavailable')
  }
  return { origin: url.origin, key }
}

async function body(response: Response): Promise<Record<string, unknown> | null> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (!response.ok || response.redirected || !Number.isFinite(length) || length < 0 || length > MAX_BODY) {
    void response.body?.cancel().catch(() => {}); return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY) { void reader.cancel().catch(() => {}); return null }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes))
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null
}

/** Explicit previous-password possession proof, no SDK, persistence or contact matching.
 * The source Auth session returned by the grant exists only in this function's memory.
 * Only the subsequently online-verified immutable UID leaves this boundary. */
export async function readLegacyPasswordOwner(email: unknown, password: unknown, options: {
  env?: Record<string, string | undefined>; request?: typeof fetch; signal?: AbortSignal; timeoutMs?: number
} = {}): Promise<string | null> {
  if (typeof email !== 'string' || !email.trim() || email.length > 320 || /[\r\n]/.test(email)
    || typeof password !== 'string' || !password || password.length > 4096) return null
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const config = legacyPasswordProofConfig(options.env)
    const requested = options.timeoutMs ?? 8000, timeout = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested,8000) : 8000
    const deadline = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('Existing account proof unavailable'))
      signal.addEventListener('abort',abort,{ once: true }); timer = setTimeout(() => controller.abort(),timeout)
    })
    const prove = async () => {
      const request = options.request ?? fetch
      const issued = await body(await request(`${config.origin}/auth/v1/token?grant_type=password`, { method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }),
        cache: 'no-store', redirect: 'error', signal }))
      signal.throwIfAborted()
      const token = issued?.access_token
      if (typeof token !== 'string' || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null
      const user = await body(await request(`${config.origin}/auth/v1/user`, { method: 'GET', headers: { apikey: config.key, Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal }))
      signal.throwIfAborted()
      if (!user || typeof user.id !== 'string' || !UUID.test(user.id) || user.deleted_at != null) return null
      if (user.banned_until != null && (typeof user.banned_until !== 'string' || !Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now())) return null
      return user.id.toLowerCase()
    }
    return await Promise.race([prove(),deadline])
  } catch { return null }
  finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort',abort); controller.abort() }
}
