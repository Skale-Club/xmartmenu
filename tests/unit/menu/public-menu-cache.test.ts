import { describe, expect, it } from 'vitest'
import { DEFAULT_PUBLIC_MENU_CACHE_SECONDS, menuCacheKey, menuCacheTags, menuSlugTag, PLATFORM_MENU_TAG, publicMenuCacheSeconds } from '@/lib/menu/public-menu-cache'
import { menuCacheActionFor } from '@/lib/menu/menu-cache-hooks'
import { pickTable, withoutPrivateContent } from '@/lib/menu/public-menu-data'

describe('public menu cache keys and tags', () => {
  it('keys one entry per restaurant and section, case-insensitively', () => {
    expect(menuCacheKey('Celes-Confections', undefined)).toEqual(['public-menu', 'v1', 'celes-confections', ''])
    expect(menuCacheKey('celes-confections', 'Main')).toEqual(['public-menu', 'v1', 'celes-confections', 'main'])
  })

  it('tags every entry with its restaurant and the platform', () => {
    expect(menuSlugTag('Aurora')).toBe('menu:slug:aurora')
    expect(menuCacheTags('aurora')).toEqual(['menu:slug:aurora', PLATFORM_MENU_TAG])
  })

  it('reads the TTL from the environment, with 0 meaning no cache', () => {
    expect(publicMenuCacheSeconds({})).toBe(DEFAULT_PUBLIC_MENU_CACHE_SECONDS)
    expect(publicMenuCacheSeconds({ PUBLIC_MENU_CACHE_SECONDS: '' })).toBe(DEFAULT_PUBLIC_MENU_CACHE_SECONDS)
    expect(publicMenuCacheSeconds({ PUBLIC_MENU_CACHE_SECONDS: '0' })).toBe(0)
    expect(publicMenuCacheSeconds({ PUBLIC_MENU_CACHE_SECONDS: '120' })).toBe(120)
    expect(publicMenuCacheSeconds({ PUBLIC_MENU_CACHE_SECONDS: 'soon' })).toBe(DEFAULT_PUBLIC_MENU_CACHE_SECONDS)
    expect(publicMenuCacheSeconds({ PUBLIC_MENU_CACHE_SECONDS: '-5' })).toBe(DEFAULT_PUBLIC_MENU_CACHE_SECONDS)
  })
})

describe('menuCacheActionFor', () => {
  const id = 'b0000000-0000-4000-8000-000000000001'

  it('ignores reads and failed-by-design routes', () => {
    expect(menuCacheActionFor('GET', '/api/admin/categories')).toBeNull()
    expect(menuCacheActionFor('HEAD', '/api/superadmin/settings')).toBeNull()
    expect(menuCacheActionFor('POST', '/api/admin/revalidate')).toBeNull()
    expect(menuCacheActionFor('POST', '/api/orders')).toBeNull()
    expect(menuCacheActionFor('POST', '/api/public/scan')).toBeNull()
  })

  it('drops the signed-in restaurant after admin and billing writes', () => {
    expect(menuCacheActionFor('POST', '/api/admin/categories')).toEqual({ kind: 'current' })
    expect(menuCacheActionFor('PATCH', '/api/admin/service-settings')).toEqual({ kind: 'current' })
    expect(menuCacheActionFor('DELETE', `/api/admin/menus/${id}/`)).toEqual({ kind: 'current' })
    expect(menuCacheActionFor('POST', '/api/tenant/subscription/checkout')).toEqual({ kind: 'current' })
  })

  it('drops the restaurant a superadmin route names by id', () => {
    expect(menuCacheActionFor('PATCH', `/api/superadmin/tenants/${id}/settings`)).toEqual({ kind: 'tenant', tenantId: id })
    expect(menuCacheActionFor('POST', `/api/superadmin/tenants/${id.toUpperCase()}/seed`)).toEqual({ kind: 'tenant', tenantId: id })
    expect(menuCacheActionFor('POST', '/api/superadmin/tenants')).toBeNull()
    expect(menuCacheActionFor('POST', '/api/superadmin/tenants/not-an-id/seed')).toBeNull()
  })

  it('drops every restaurant after platform, plan and Stripe changes', () => {
    expect(menuCacheActionFor('PATCH', '/api/superadmin/settings')).toEqual({ kind: 'all' })
    expect(menuCacheActionFor('PUT', `/api/superadmin/plans/${id}`)).toEqual({ kind: 'all' })
    expect(menuCacheActionFor('POST', '/api/stripe/webhooks')).toEqual({ kind: 'all' })
  })
})

describe('per-request part of the public menu', () => {
  const tables = [{ id: 't1', name: 'Mesa 1' }, { id: 't2', name: 'Mesa 2' }]

  it('picks the ?table= row only when the restaurant serves at the table', () => {
    expect(pickTable(tables, 't2', { guestOrdering: true, waiterCalls: true })).toEqual({ id: 't2', name: 'Mesa 2' })
    expect(pickTable(tables, 't2', { guestOrdering: false, waiterCalls: true })).toEqual({ id: 't2', name: 'Mesa 2' })
    expect(pickTable(tables, 't2', { guestOrdering: false, waiterCalls: false })).toBeNull()
    expect(pickTable(tables, 'missing', { guestOrdering: true, waiterCalls: true })).toBeNull()
    expect(pickTable(tables, null, { guestOrdering: true, waiterCalls: true })).toBeNull()
  })

  it('leaves nothing of a private menu for a caller who may not see it', () => {
    const data = {
      menu: { id: 'm', is_private: true },
      categories: [{ id: 'c' }],
      products: [{ id: 'p' }],
      optionGroupsByProductId: { p: [{ id: 'g' }] },
      productIngredientsByProductId: { p: [{ id: 'i' }] },
      productMediaByProductId: { p: [{ id: 'm' }] },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripped = withoutPrivateContent(data as any)
    expect(stripped.menu).toEqual({ id: 'm', is_private: true })
    expect(stripped.categories).toEqual([])
    expect(stripped.products).toEqual([])
    expect(stripped.optionGroupsByProductId).toEqual({})
    expect(stripped.productIngredientsByProductId).toEqual({})
    expect(stripped.productMediaByProductId).toEqual({})
  })
})
