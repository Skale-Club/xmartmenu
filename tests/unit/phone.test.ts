import { describe, expect, it } from 'vitest'
import { callingCodeForCountry, phoneMatchKey, sessionPhoneE164, toE164 } from '@/lib/phone'

describe('toE164', () => {
  it('keeps an explicit international number', () => {
    expect(toE164('+55 (11) 99999-8888')).toBe('+5511999998888')
    expect(toE164('0055 11 99999 8888')).toBe('+5511999998888')
    expect(toE164('+1 415 555 0100', 'BR')).toBe('+14155550100')
  })

  it('uses the restaurant country for a local number', () => {
    expect(toE164('11 99999-8888', 'BR')).toBe('+5511999998888')
    expect(toE164('(011) 99999-8888', 'Brasil')).toBe('+5511999998888')
    expect(toE164('5511999998888', 'BR')).toBe('+5511999998888')
    // Area code 55 (Rio Grande do Sul) is not mistaken for the country code.
    expect(toE164('55 99999-8888', 'BR')).toBe('+5555999998888')
    expect(toE164('415 555 0100', 'US')).toBe('+14155550100')
  })

  it('never guesses a country', () => {
    expect(toE164('11 99999-8888')).toBeNull()
    expect(toE164('11 99999-8888', 'Atlantis')).toBeNull()
    expect(toE164('')).toBeNull()
    expect(toE164('+12')).toBeNull()
  })
})

describe('identity, not suffixes', () => {
  it('two numbers sharing the last 8 digits are different people', () => {
    const a = toE164('+55 11 99999-8888')
    const b = toE164('+55 21 99999-8888')
    expect(phoneMatchKey(a)).toBe(phoneMatchKey(b)) // the old, unsafe key collides
    expect(a).not.toBe(b) // the identity used now does not
  })

  it('reads the Supabase session phone (digits without +)', () => {
    expect(sessionPhoneE164('5511999998888')).toBe('+5511999998888')
    expect(sessionPhoneE164('')).toBeNull()
    expect(sessionPhoneE164(null)).toBeNull()
  })

  it('maps configured countries', () => {
    expect(callingCodeForCountry('br')).toBe('55')
    expect(callingCodeForCountry(' Portugal ')).toBe('351')
    expect(callingCodeForCountry(null)).toBeNull()
  })
})
