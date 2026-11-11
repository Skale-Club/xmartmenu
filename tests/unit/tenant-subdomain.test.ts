import { describe, expect, it } from 'vitest'
import { RESERVED_SUBDOMAINS, subdomainBase, subdomainLabelFromHost, suggestedSubdomain, tenantSubdomainHost, validateSubdomainLabel } from '@/lib/tenant-subdomain'
import { getCanonicalUrl, PLATFORM_BASE, tenantOwnHost } from '@/lib/seo'
import { readHostTenantSlug } from '@/lib/data/tenant-domain'
import { resolveCustomDomainRoute } from '@/lib/custom-domain-routing'

const base = 'xmartmenu.skale.club'

describe('restaurant subdomains', () => {
  it('is off until a valid base is configured', () => {
    expect(subdomainBase({})).toBeNull()
    expect(subdomainBase({ TENANT_SUBDOMAIN_BASE: '' })).toBeNull()
    expect(subdomainBase({ TENANT_SUBDOMAIN_BASE: 'not a host' })).toBeNull()
    expect(subdomainBase({ TENANT_SUBDOMAIN_BASE: ' .XmartMenu.Skale.Club. ' })).toBe(base)
  })

  it('accepts one DNS label and refuses reserved, malformed or punycode names', () => {
    expect(validateSubdomainLabel(' Aurora ')).toEqual({ ok: true, label: 'aurora' })
    expect(validateSubdomainLabel('')).toEqual({ ok: true, label: null })
    expect(validateSubdomainLabel(null)).toEqual({ ok: true, label: null })
    for (const bad of ['-aurora', 'aurora-', 'au_rora', 'a.b', 'a'.repeat(64), 'xn--80ak6aa92e', 'a--b', 'www', 'api', 'preview', 'staging', 42]) {
      expect(validateSubdomainLabel(bad).ok).toBe(false)
    }
    expect(RESERVED_SUBDOMAINS.has('admin')).toBe(true)
    expect(suggestedSubdomain('aurora-kitchen-bar')).toBe('aurora-kitchen-bar')
    expect(suggestedSubdomain('admin')).toBeNull()
  })

  it('reads the label of exactly one level under the base', () => {
    expect(subdomainLabelFromHost('Aurora.XmartMenu.Skale.Club:443', base)).toBe('aurora')
    expect(subdomainLabelFromHost('aurora.xmartmenu.skale.club.', base)).toBe('aurora')
    expect(subdomainLabelFromHost('xmartmenu.skale.club', base)).toBeNull()
    expect(subdomainLabelFromHost('a.b.xmartmenu.skale.club', base)).toBeNull()
    expect(subdomainLabelFromHost('www.xmartmenu.skale.club', base)).toBeNull()
    expect(subdomainLabelFromHost('aurora.evil-xmartmenu.skale.club', base)).toBeNull()
    expect(subdomainLabelFromHost('aurora.xmartmenu.skale.club.evil.com', base)).toBeNull()
    expect(subdomainLabelFromHost('aurora.xmartmenu.skale.club', null)).toBeNull()
    expect(tenantSubdomainHost('aurora', base)).toBe('aurora.xmartmenu.skale.club')
    expect(tenantSubdomainHost('aurora', null)).toBeNull()
    expect(tenantSubdomainHost('www', base)).toBeNull()
  })

  it('canonical address: verified custom domain, then subdomain, then the platform path', () => {
    const tenant = { slug: 'aurora', subdomain: 'aurora', custom_domain: 'menu.aurora.com', custom_domain_verified: false }
    expect(tenantOwnHost(tenant, base)).toBe('aurora.xmartmenu.skale.club')
    expect(tenantOwnHost({ ...tenant, custom_domain_verified: true }, base)).toBe('menu.aurora.com')
    expect(tenantOwnHost(tenant, null)).toBeNull()
    expect(tenantOwnHost({ slug: 'aurora' }, base)).toBeNull()
    // Unit tests run without TENANT_SUBDOMAIN_BASE: the default stays the platform path.
    expect(getCanonicalUrl(tenant, '/drinks')).toBe(`${PLATFORM_BASE}/aurora/drinks`)
  })

  it('a subdomain host is served like a custom domain: pages rewritten, platform routes kept', () => {
    expect(resolveCustomDomainRoute('/', 'aurora')).toEqual({ kind: 'rewrite', pathname: '/aurora' })
    expect(resolveCustomDomainRoute('/preview/abc', 'aurora')).toEqual({ kind: 'rewrite', pathname: '/aurora/preview/abc' })
    expect(resolveCustomDomainRoute('/api/orders', 'aurora')).toEqual({ kind: 'pass' })
  })

  it('host lookup asks for the subdomain only after the column exists, and custom domains otherwise', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = []
    const ready = (has: boolean) => async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (text.includes('information_schema')) return { rows: [{ ready: has }] }
      return { rows: [{ slug: 'aurora' }] }
    }
    expect(await readHostTenantSlug(ready(false), 'aurora.xmartmenu.skale.club', base)).toBeNull()
    expect(calls.some(call => call.text.includes('subdomain=$1'))).toBe(false)
    expect(await readHostTenantSlug(ready(true), 'aurora.xmartmenu.skale.club', base)).toBe('aurora')
    expect(calls.at(-1)?.values).toEqual(['aurora'])
    calls.length = 0
    expect(await readHostTenantSlug(ready(true), 'menu.aurora.com', base)).toBe('aurora')
    expect(calls[0].text).toContain('custom_domain=$1')
  })
})
