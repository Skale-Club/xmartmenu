import { randomInt } from 'node:crypto'
import { getIdentityServices } from '@/lib/auth/identity-services'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import type { VerifiedGoogleIdentity } from '@/lib/auth/google-identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Development-only phone sign-in, the way Xpot signs in on localhost (owner decision 2026-11-09): no SMS and
 * no Google. `start` returns a short-lived development code that the screen fills in; `verify` signs in the
 * dev account whose profile holds that phone, through the same identity store as a real sign-in (an
 * operator-recovery binding for a `dev-phone-<digits>` subject, then a normal session cookie).
 *
 * It answers 404 unless NODE_ENV is development, the owned sign-in is on and the request is for localhost,
 * so a production build never exposes it.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const E164 = /^\+[1-9]\d{7,14}$/
const CODE_MS = 5 * 60_000
const codes = new Map<string, { code: string; expires: number; tries: number }>()

const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function available(request: Request): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.GOOGLE_AUTH_ENABLED !== 'true' || !ownedAuthSelected()) return false
  return LOCAL_HOSTS.has(new URL(request.url).hostname)
}

export async function POST(request: Request) {
  if (!available(request)) return json({ message: 'Not found' }, 404)
  let body: { action?: unknown; phone?: unknown; code?: unknown }
  try { body = await request.json() } catch { return json({ message: 'Invalid request' }, 400) }
  const phone = typeof body.phone === 'string' ? body.phone : ''
  if (!E164.test(phone)) return json({ message: 'Check the number and the selected country.' }, 400)

  if (body.action === 'start') {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    codes.set(phone, { code, expires: Date.now() + CODE_MS, tries: 0 })
    return json({ ok: true, devCode: code })
  }
  if (body.action !== 'verify') return json({ message: 'Invalid request' }, 400)

  const entry = codes.get(phone)
  if (!entry || entry.expires < Date.now() || entry.tries >= 5) { codes.delete(phone); return json({ message: 'Request another code.' }, 400) }
  if (body.code !== entry.code) { entry.tries++; return json({ message: 'Wrong code.' }, 400) }
  codes.delete(phone)

  const { config, pool, store } = getIdentityServices()
  const owners = await pool.query<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
     WHERE a.disabled_at IS NULL AND btrim(coalesce(p.phone,'')) LIKE '+%' AND '+'||regexp_replace(p.phone,'[^0-9]','','g')=$1
     LIMIT 2`, [phone])
  if (owners.rowCount !== 1) return json({ message: 'No development account has this phone. Put it on a profile in the dev database.' }, 404)

  const identity: VerifiedGoogleIdentity = {
    projectId: config.web.projectId, subject: `dev-phone-${phone.slice(1)}`, provider: 'phone', phone,
    authenticatedAt: Math.floor(Date.now() / 1000),
  }
  await store.bind(identity, owners.rows[0].id, 'operator-recovery')
  const session = await store.createSession(identity)
  const response = json({ authenticated: true })
  const age = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
  // Same cookie as the identity runtime on an http origin (identity-http.ts: `xm_identity`, no __Host- prefix).
  response.headers.append('Set-Cookie', `xm_identity=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`)
  return response
}
