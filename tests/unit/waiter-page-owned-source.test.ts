import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('waiter page in native mode', () => {
  const source = readFileSync('src/app/(public)/[slug]/waiter/page.tsx', 'utf8')
  it('reads the native principal and only touches Supabase auth in the non-native branch', () => {
    expect(source).toContain('ownedAuthSelected()')
    expect(source).toContain('getOwnedPrincipal()')
    const native = source.slice(source.indexOf('if (owned)'), source.indexOf('} else {'))
    expect(native).not.toContain('supabase')
    expect(source.match(/supabase\.auth\.getUser/g)).toHaveLength(1)
  })
})
