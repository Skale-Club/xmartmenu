import { encryptApiKey, maskApiKey } from '../crypto'

/** A displayed masked key means preserve the existing ciphertext. */
export function isMaskedKey(value: string): boolean { return value.includes('••') }
/** undefined preserves, null removes, otherwise encrypt server-side. */
export function nextStoredKey(input: unknown): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null || input === '') return null
  if (typeof input !== 'string') return undefined
  const key = input.trim()
  if (!key) return null
  return isMaskedKey(key) ? undefined : encryptApiKey(key)
}
export function maskedOrEmpty(plain: string | null): string { return plain ? maskApiKey(plain) : '' }
