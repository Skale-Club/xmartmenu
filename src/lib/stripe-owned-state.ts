import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIFETIME = 15 * 60 * 1000, DOMAIN = 'xmartmenu-owned-stripe-connect:'
function secret() {
  const value = process.env.OAUTH_STATE_SECRET || process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY
  if (!value) throw new Error('Stripe OAuth state is unavailable')
  return value
}
function signature(payload: string) { return createHmac('sha256', secret()).update(DOMAIN).update(payload).digest() }
export function signOwnedStripeState(actorId: string, tenantId: string, now = Date.now()): string {
  if (!UUID.test(actorId) || !UUID.test(tenantId) || !Number.isSafeInteger(now) || now <= 0) throw new Error('Stripe OAuth state is unavailable')
  const payload = Buffer.from(JSON.stringify({ actorId, tenantId, timestamp: now, nonce: randomBytes(24).toString('base64url') })).toString('base64url')
  return `${payload}.${signature(payload).toString('base64url')}`
}
/** Separate signature domain: a legacy tenant-only state is never owned proof. */
export function verifyOwnedStripeState(state: string, now = Date.now()): { actorId: string; tenantId: string; nonceHash: string; expiresAt: number } | null {
  if (typeof state !== 'string' || state.length > 2048 || !Number.isSafeInteger(now)) return null
  const parts = state.split('.')
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null
  const [payload, encodedSignature] = parts, provided = Buffer.from(encodedSignature, 'base64url'), expected = signature(payload)
  if (provided.length !== expected.length || provided.toString('base64url') !== encodedSignature || !timingSafeEqual(provided, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof value.actorId !== 'string' || !UUID.test(value.actorId) || typeof value.tenantId !== 'string' || !UUID.test(value.tenantId)
      || !Number.isSafeInteger(value.timestamp) || value.timestamp <= 0 || now - value.timestamp > LIFETIME || value.timestamp - now > 30000
      || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(value.nonce)) return null
    return { actorId: value.actorId, tenantId: value.tenantId, nonceHash: createHash('sha256').update(value.nonce).digest('hex'), expiresAt: value.timestamp + LIFETIME }
  } catch { return null }
}
