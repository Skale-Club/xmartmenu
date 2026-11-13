import { afterEach, describe, expect, it } from 'vitest'
import { BRAND_HOST, BRAND_HOSTS, BRAND_NAME, BRAND_URL, LEGACY_HOSTS, isPlatformHost } from '@/lib/brand'

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
})

describe('brand constants', () => {
  it('names the product and its address consistently', () => {
    expect(BRAND_NAME).toBe('Xprout')
    expect(BRAND_URL).toBe(`https://${BRAND_HOST}`)
    expect(BRAND_HOSTS).toContain(BRAND_HOST)
    expect(LEGACY_HOSTS).toContain('xmartmenu.skale.club')
  })
})

describe('isPlatformHost', () => {
  it('accepts the brand hosts, ignoring case and port', () => {
    expect(isPlatformHost('xprout.app')).toBe(true)
    expect(isPlatformHost('WWW.Xprout.App')).toBe(true)
    expect(isPlatformHost('xprout.app:443')).toBe(true)
  })

  it('accepts the legacy hosts', () => {
    expect(isPlatformHost('xmartmenu.skale.club')).toBe(true)
    expect(isPlatformHost('xmartmenu-stage.skale.club:3000')).toBe(true)
  })

  it('accepts the host of NEXT_PUBLIC_APP_URL when set', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(isPlatformHost('localhost')).toBe(false)
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    expect(isPlatformHost('localhost:3000')).toBe(true)
    expect(isPlatformHost('localhost')).toBe(true)
  })

  it('rejects restaurant custom domains, subdomains and look-alikes', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(isPlatformHost('bella-vista.com')).toBe(false)
    expect(isPlatformHost('aurora.xmartmenu.skale.club')).toBe(false)
    expect(isPlatformHost('xprout.app.evil.com')).toBe(false)
    expect(isPlatformHost('')).toBe(false)
  })
})
