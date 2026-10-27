import { describe, expect, it } from 'vitest'
import { resolveCustomDomainRoute } from '@/lib/custom-domain-routing'

const slug = 'pizza'
const route = (path: string) => resolveCustomDomainRoute(path, slug)

describe('resolveCustomDomainRoute', () => {
  it('serves the restaurant pages from its namespace', () => {
    expect(route('/')).toEqual({ kind: 'rewrite', pathname: '/pizza' })
    expect(route('/drinks')).toEqual({ kind: 'rewrite', pathname: '/pizza/drinks' })
    expect(route('/me')).toEqual({ kind: 'rewrite', pathname: '/pizza/me' })
    expect(route('/me/login')).toEqual({ kind: 'rewrite', pathname: '/pizza/me/login' })
    expect(route('/blog/how-we-bake')).toEqual({ kind: 'rewrite', pathname: '/pizza/blog/how-we-bake' })
    expect(route('/waiter')).toEqual({ kind: 'rewrite', pathname: '/pizza/waiter' })
    expect(route('/robots.txt')).toEqual({ kind: 'rewrite', pathname: '/pizza/robots.txt' })
    expect(route('/sitemap.xml')).toEqual({ kind: 'rewrite', pathname: '/pizza/sitemap.xml' })
    expect(route('/opengraph-image')).toEqual({ kind: 'rewrite', pathname: '/pizza/opengraph-image' })
  })

  it('keeps platform routes global: ordering, paying and signing in work', () => {
    for (const path of ['/api/orders', '/api/stripe/webhooks', '/api/public/chat/pizza', '/checkout/abc', '/checkout/abc/confirmation', '/auth/callback', '/auth/login', '/oauth/authorize', '/onboarding', '/privacy', '/terms', '/.well-known/oauth-protected-resource', '/manifest.webmanifest', '/favicon.ico']) {
      expect(route(path), path).toEqual({ kind: 'pass' })
    }
  })

  it('matches the tenant prefix on a whole segment', () => {
    expect(route('/pizza')).toEqual({ kind: 'pass' })
    expect(route('/pizza/drinks')).toEqual({ kind: 'pass' })
    expect(route('/pizzas')).toEqual({ kind: 'rewrite', pathname: '/pizza/pizzas' })
    expect(route('/apis')).toEqual({ kind: 'rewrite', pathname: '/pizza/apis' })
    expect(route('/checkouts')).toEqual({ kind: 'rewrite', pathname: '/pizza/checkouts' })
  })
})
