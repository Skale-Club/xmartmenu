import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ cache: new Map<string, Promise<unknown>>(), keys: [] as string[][], own: vi.fn(), assert: vi.fn(), legacy: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: (reader: () => Promise<unknown>, keys: string[]) => () => {
  state.keys.push(keys)
  const key = keys.join('|')
  if (!state.cache.has(key)) state.cache.set(key, reader())
  return state.cache.get(key)
}, revalidateTag: vi.fn() }))
vi.mock('@/lib/data/public-menu-runtime', () => ({ loadOwnedPublicMenuBase: state.own, assertPublicMenuTarget: state.assert }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(() => { throw Error('No legacy private check expected') }), createServiceClient: state.legacy }))
import { getPublicMenuBase, loadPublicMenuData } from '@/lib/menu/public-menu-data'
import { resolveTenantCapabilities } from '@/lib/service-modes'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.cache.clear(); state.keys.length = 0 })
const base = () => ({ kind: 'menu', tenant: { id: randomUUID() }, footerBrand: 'Brand', menu: { is_private: true }, location: null,
  categories: [{ id: randomUUID() }], products: [{ id: randomUUID() }], capabilities: resolveTenantCapabilities(null, null),
  optionGroupsByProductId: {}, productIngredientsByProductId: {}, productMediaByProductId: {}, deliveryZones: [],
  chatAddonEnabled: false, chatAddonAudioEnabled: false, chatAddonTextEnabled: false, tables: [] })

describe('public menu source and private-access boundary', () => {
  it('does not reuse a legacy cache entry when the independent source is enabled', async () => {
    state.legacy.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }), single: async () => ({ data: null }) }) }) })
    vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED', 'false')
    expect(await getPublicMenuBase('restaurant', undefined)).toEqual({ kind: 'not_found' })
    state.own.mockResolvedValue(base())
    vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED', 'true')
    expect((await getPublicMenuBase('restaurant', undefined)).kind).toBe('menu')
    expect(state.keys.map(key => key.at(-1))).toEqual(['legacy', 'owned-v1'])
    expect(state.legacy).toHaveBeenCalledTimes(1)
  })
  it('rechecks private access for every visitor outside the shared SQL-data cache', async () => {
    vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED', 'true')
    state.own.mockResolvedValue(base())
    const granted = await loadPublicMenuData({ slug: 'restaurant', tableId: null, checkPrivateAccess: async () => true })
    const denied = await loadPublicMenuData({ slug: 'restaurant', tableId: null, checkPrivateAccess: async () => false })
    expect(granted.kind === 'menu' && granted.products).toHaveLength(1)
    expect(denied.kind === 'menu' && denied.products).toEqual([])
    expect(denied.kind === 'menu' && denied.categories).toEqual([])
    expect(state.own).toHaveBeenCalledTimes(1)
    expect(state.legacy).not.toHaveBeenCalled()
  })
  it('refuses missing/changed owned configuration even with a warmed cache, with no legacy fallback', async () => {
    vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED', 'true')
    state.own.mockResolvedValue(base())
    await getPublicMenuBase('restaurant', undefined)
    state.assert.mockImplementationOnce(() => { throw Error('Configuration required') })
    await expect(getPublicMenuBase('restaurant', undefined)).rejects.toThrow('Configuration required')
    expect(state.own).toHaveBeenCalledTimes(1)
    expect(state.legacy).not.toHaveBeenCalled()
  })
})
