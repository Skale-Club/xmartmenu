/**
 * AES-256-GCM encryption helpers for tenant-owned API keys (SEED-024).
 *
 * The master key must live in env var CHAT_ADDON_ENCRYPTION_KEY as a 32-byte
 * value, hex- or base64-encoded. Plaintext keys are encrypted at rest in
 * chat_addon_settings; they are only ever decrypted server-side at request
 * time and never leave the server.
 *
 * Ciphertext format: base64(iv | authTag | ciphertext)  (12 | 16 | n bytes)
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getMasterKey(): Buffer {
  const raw = process.env.CHAT_ADDON_ENCRYPTION_KEY
  if (!raw) throw new Error('CHAT_ADDON_ENCRYPTION_KEY is not set')
  // Try hex first, then base64. Must decode to exactly 32 bytes.
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }
  if (key.length !== 32) {
    throw new Error('CHAT_ADDON_ENCRYPTION_KEY must decode to 32 bytes (hex or base64)')
  }
  return key
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return ''
  const key = getMasterKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptApiKey(ciphertext: string): string {
  if (!ciphertext) return ''
  const key = getMasterKey()
  const buf = Buffer.from(ciphertext, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('Ciphertext too short')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/** Masks an API key for display: shows first 4 + last 4 chars, dots in middle. */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

/** SHA-256 hash a phone number scoped to a tenant. */
export function hashPhone(phone: string, tenantId: string): string {
  return createHash('sha256').update(`${tenantId}:${phone}`).digest('hex')
}

/** Mask a phone number for admin UI: keeps country/area + last 4 digits. */
export function maskPhone(phone: string): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 6) return phone
  const last4 = digits.slice(-4)
  const head = digits.slice(0, Math.max(2, digits.length - 8))
  return `+${head} ••••-${last4}`
}
