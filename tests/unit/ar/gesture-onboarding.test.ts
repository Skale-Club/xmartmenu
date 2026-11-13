import { describe, expect, it } from 'vitest'
import { AR_GESTURE_ONBOARDING_KEY, createGestureOnboardingClaim } from '@/lib/ar/gesture-onboarding'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('AR gesture onboarding claim', () => {
  it('claims an unseen browser once and persists the versioned global key', () => {
    const storage = memoryStorage()
    const claim = createGestureOnboardingClaim()
    expect(claim(storage)).toBe(true)
    expect(storage.getItem(AR_GESTURE_ONBOARDING_KEY)).toBe('shown')
    expect(claim(storage)).toBe(false)
  })

  it('does not repeat for another mount, dish, tenant, or page reload', () => {
    const storage = memoryStorage()
    expect(createGestureOnboardingClaim()(storage)).toBe(true)
    expect(createGestureOnboardingClaim()(storage)).toBe(false)
  })

  it('keeps a memory claim when reading and writing storage throw', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const claim = createGestureOnboardingClaim()
    expect(claim(storage)).toBe(true)
    expect(claim(storage)).toBe(false)
  })

  it('does not repeat when persistence fails after a successful empty read', () => {
    const claim = createGestureOnboardingClaim()
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(claim(storage)).toBe(true)
    expect(claim(storage)).toBe(false)
  })

  it('works without browser globals or a storage object', () => {
    // Creating the helper and importing this module require no DOM or window.
    const claim = createGestureOnboardingClaim()
    expect(claim()).toBe(true)
    expect(claim()).toBe(false)
  })
})
