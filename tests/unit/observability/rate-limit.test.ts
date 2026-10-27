import { afterEach, describe, expect, it } from 'vitest'
import { durationMs, getClientIp, memoryRateLimit } from '@/lib/rate-limit'

const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers })

describe('getClientIp', () => {
  afterEach(() => { delete process.env.TRUSTED_PROXY_HOPS })

  it('prefers Cloudflare\'s client address', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('reads x-forwarded-for from the right, so a client cannot choose its own identity', () => {
    // The client sent "6.6.6.6"; our proxy appended the address it saw.
    expect(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }))).toBe('198.51.100.7')
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('honours more trusted proxy hops when configured', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.2' }))).toBe('198.51.100.7')
  })
})

describe('memoryRateLimit (no Redis)', () => {
  it('limits instead of letting everything through', () => {
    const name = `t-${Math.random()}`
    const now = 1_000_000
    const results = Array.from({ length: 5 }, (_, i) => memoryRateLimit(name, 'ip', 3, 60_000, now + i).ok)
    expect(results).toEqual([true, true, true, false, false])
  })

  it('frees the window as time passes, per identifier', () => {
    const name = `t-${Math.random()}`
    for (let i = 0; i < 3; i++) memoryRateLimit(name, 'a', 3, 1000, 0)
    expect(memoryRateLimit(name, 'a', 3, 1000, 500).ok).toBe(false)
    expect(memoryRateLimit(name, 'b', 3, 1000, 500).ok).toBe(true)
    expect(memoryRateLimit(name, 'a', 3, 1000, 1500).ok).toBe(true)
  })

  it('parses windows', () => {
    expect(durationMs('1 m')).toBe(60_000)
    expect(durationMs('10 m')).toBe(600_000)
    expect(durationMs('1 d')).toBe(86_400_000)
  })
})
