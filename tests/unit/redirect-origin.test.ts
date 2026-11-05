import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRequestOrigin } from '@/lib/site-url'

const bind = 'http://0.0.0.0:3000/demo'
describe('public origin for redirects behind the proxy', () => {
  it('uses the forwarded host and protocol, never 0.0.0.0', () => {
    const request = new Request(bind, { headers: { 'x-forwarded-host': 'menu.example.test', 'x-forwarded-proto': 'https' } })
    expect(getRequestOrigin(request)).toBe('https://menu.example.test')
  })
  it('falls back to the configured app URL when the proxy sends nothing usable', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test/'
    try { expect(getRequestOrigin(new Request(bind, { headers: { 'x-forwarded-host': '0.0.0.0:3000' } }))).toBe('https://app.example.test') }
    finally { delete process.env.NEXT_PUBLIC_APP_URL }
  })
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
describe('route handlers never build a redirect from the bind address', () => {
  it('no handler under src/app redirects to an origin taken from request.url', () => {
    const offenders = files('src/app').filter(path => {
      const source = readFileSync(path, 'utf8')
      return /NextResponse\.redirect|Response\.redirect/.test(source) && /\borigin\b[^\n]*=\s*new URL\((request|req)\.url\)|new URL\((request|req)\.url\)\.origin/.test(source)
    })
    expect(offenders).toEqual([])
  })
  it('the demo, enter-preview and exit-preview redirects use getRequestOrigin', () => {
    for (const path of ['src/app/demo/route.ts', 'src/app/api/admin/enter-preview/route.ts', 'src/app/api/admin/exit-preview/route.ts']) {
      expect(readFileSync(path, 'utf8')).toContain('getRequestOrigin(request)')
    }
  })
})
