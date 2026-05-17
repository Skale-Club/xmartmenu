import crypto from 'crypto'

const STATE_EXPIRY_MS = 15 * 60 * 1000

interface StatePayload {
  tenantId: string
  timestamp: number
}

function getSecret(): string {
  // Reuse the webhook secret as the HMAC key — it's the only server-side
  // Stripe secret guaranteed to exist when Stripe Connect is enabled. If
  // it's missing, fall back to STRIPE_SECRET_KEY rather than failing
  // silently with an empty key.
  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY required to sign OAuth state')
  }
  return secret
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(normalized, 'base64')
}

export function signOAuthState(tenantId: string): string {
  const payload: StatePayload = { tenantId, timestamp: Date.now() }
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest()
  return `${payloadB64}.${base64url(sig)}`
}

export function verifyOAuthState(state: string): { tenantId: string } | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts

  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest()
  const providedSig = base64urlDecode(sigB64)
  if (expectedSig.length !== providedSig.length) return null
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null

  let payload: StatePayload
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.tenantId || typeof payload.timestamp !== 'number') return null
  if (Date.now() - payload.timestamp > STATE_EXPIRY_MS) return null
  return { tenantId: payload.tenantId }
}
