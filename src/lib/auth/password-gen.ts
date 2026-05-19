import { randomInt, randomBytes } from 'crypto'

// Round-2 P1-01 fix: Math.random() is a PRNG (V8 xorshift128+) whose state
// can be recovered from a few samples. For credentials, use Node's crypto.

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/**
 * Generate a cryptographically-secure password of `length` characters
 * from an unambiguous alphabet (no 0/O/1/l/I).
 */
export function generatePassword(length = 12): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[randomInt(0, PASSWORD_CHARS.length)]
  }
  return out
}

/**
 * Cryptographically-random URL-safe suffix for synthetic email addresses,
 * etc. Returns base64url, lowercase, no padding.
 */
export function randomSuffix(byteLength = 6): string {
  return randomBytes(byteLength).toString('base64url').toLowerCase()
}
