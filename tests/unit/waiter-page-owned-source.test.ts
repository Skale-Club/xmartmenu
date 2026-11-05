import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('waiter page in native mode', () => {
  const source = readFileSync('src/app/(public)/[slug]/waiter/page.tsx', 'utf8')
  it('reads the native principal and only touches Supabase auth in the non-native branch', () => {
    expect(source).toContain('getOwnedPrincipal()')
    const authNative = source.slice(source.indexOf('if (owned) {'), source.indexOf('} else {'))
    expect(authNative).not.toContain('supabase')
    expect(source.match(/supabase\.auth\.getUser/g)).toHaveLength(1)
  })
  it('loads tenant, tables and menu from the owned database and returns before any Supabase service client', () => {
    const start = source.indexOf('readOwnedWaiter(slug)')
    const end = source.indexOf('const service = createServiceClient()')
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
    expect(source.slice(source.indexOf('if (owned) {', start - 200), end)).not.toMatch(/createServiceClient|service\.from|createClient/)
    expect(source.slice(source.lastIndexOf('if (owned) {', end), end)).toContain('return (')
  })
})

describe('identity runtime', () => {
  it('exposes first-login lookups only through the native-auth gate', () => {
    const runtime = readFileSync('src/lib/auth/identity-runtime.ts', 'utf8')
    expect(runtime).toContain('gateFirstLogin(store, () => ownedAuthSelected())')
  })
})
