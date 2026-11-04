import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { PUBLIC_MENU_COLUMNS, publicMenuSource, readOwnedPublicMenu, type PublicMenuQuery } from '@/lib/data/public-menu'
import { createPublicMenuPool, readPublicMenuSnapshot } from '@/lib/data/public-menu-runtime'

const tenantId = randomUUID(), menuId = randomUUID(), productId = randomUUID(), groupId = randomUUID()
function fixture(patch: Record<string, unknown[]> = {}) {
  const data: Record<string, unknown[]> = {
    tenants: [{ id: tenantId, slug: 'restaurant', tenant_settings: { orders_enabled: true, direct_orders_enabled: true, table_management_enabled: true, delivery_enabled: true, ingredient_customization_enabled: true } }],
    platform_settings: [{ menu_footer_brand: 'Brand' }], menus: [{ id: menuId, slug: 'main', is_default: true, is_private: false }],
    locations: [], tenant_subscriptions: [{ status: 'active', features: ['payments'], chat_addon_available: true, chat_addon_active: true }],
    chat_addon_settings: [{ enabled: true, audio_enabled: true, text_enabled: false }], restaurant_tables: [{ id: randomUUID(), name: 'One' }],
    delivery_zones: [{ id: randomUUID() }], categories: [{ id: randomUUID() }], products: [{ id: productId, price: 12.25 }],
    product_option_groups: [{ id: groupId, product_id: productId }], product_options: [{ id: randomUUID(), group_id: groupId, is_available: true, price_modifier: 2.5 }],
    product_ingredients: [{ product_id: productId, ingredient: { name: 'Onion' } }], product_media: [{ id: randomUUID(), product_id: productId }], ...patch,
  }
  const queries: Array<{ text: string; values: unknown[] }> = []
  const query: PublicMenuQuery = async (text, values = []) => {
    queries.push({ text, values })
    const table = /FROM public\.([a-z_]+)/.exec(text)?.[1]
    if (!table || !(table in data)) throw new Error('Unexpected SQL')
    return { rows: data[table].map(row => ({ row })) }
  }
  return { query, queries }
}

describe('independent PostgreSQL public catalog', () => {
  it('preserves menu selection, original IDs, numeric DTOs, capabilities and grouped details', async () => {
    const { query, queries } = fixture()
    const result = await readOwnedPublicMenu(query, 'restaurant', undefined)
    expect(result.kind).toBe('menu')
    if (result.kind !== 'menu') throw Error()
    expect(result.tenant.id).toBe(tenantId)
    expect(result.menu.id).toBe(menuId)
    expect(result.products[0]).toEqual({ id: productId, price: 12.25 })
    expect(result.capabilities.guestOrdering).toBe(true)
    expect(result.chatAddonEnabled).toBe(true)
    expect(result.chatAddonAudioEnabled).toBe(true)
    expect(result.chatAddonTextEnabled).toBe(false)
    expect(result.optionGroupsByProductId[productId][0].options[0].price_modifier).toBe(2.5)
    expect(result.productIngredientsByProductId[productId][0].ingredient.name).toBe('Onion')
    expect(result.productMediaByProductId[productId]).toHaveLength(1)
    for (const { text, values } of queries.filter(item => !/FROM public\.(tenants|platform_settings)\b/.test(item.text))) {
      expect(values[0]).toBe(tenantId)
      expect(text).toContain('$1')
    }
    for (const { text, values } of queries.filter(item => /FROM public\.(product_options|product_option_groups|product_ingredients|product_media)\b/.test(item.text))) {
      expect(values).toEqual([tenantId, menuId, [productId]])
      expect(text).toMatch(/p\.tenant_id=/)
      expect(text).toContain('p.menu_id=$2')
    }
    expect(queries.every(item => !/SELECT\s+\*|auth\.|storage\.|api_key|stripe_|xphere_/i.test(item.text))).toBe(true)
  })
  it('does not query details or a foreign tenant when the slug is missing/inactive', async () => {
    const { query, queries } = fixture({ tenants: [] })
    expect(await readOwnedPublicMenu(query, 'missing', undefined)).toEqual({ kind: 'not_found' })
    expect(queries).toHaveLength(1)
    expect(queries[0].values).toEqual(['missing'])
    expect(queries[0].text).toContain('t.is_active=true')
  })
  it('treats SQL metacharacters only as parameter values', async () => {
    const { query, queries } = fixture({ tenants: [] })
    const slug = "restaurant' OR true --"
    await readOwnedPublicMenu(query, slug, undefined)
    expect(queries[0].text).not.toContain(slug)
    expect(queries[0].values).toEqual([slug])
    expect(await readOwnedPublicMenu(query, '', undefined)).toEqual({ kind: 'not_found' })
    expect(queries).toHaveLength(1)
  })
  it('uses the existing branch picker and branch fallback rules', async () => {
    const branch = { id: randomUUID(), name: 'North', slug: 'north', menu_id: menuId, private_extra: 'not public' }
    const picker = await readOwnedPublicMenu(fixture({ locations: [branch, { ...branch, id: randomUUID(), slug: 'south' }] }).query, 'restaurant', undefined)
    expect(picker.kind).toBe('branches')
    if (picker.kind !== 'branches') throw Error()
    expect(picker.locations[0]).not.toHaveProperty('private_extra')
    const menu = await readOwnedPublicMenu(fixture({ locations: [{ ...branch, menu_id: null }] }).query, 'restaurant', 'north')
    expect(menu.kind === 'menu' && menu.menu.id).toBe(menuId)
    expect(await readOwnedPublicMenu(fixture().query, 'restaurant', 'missing')).toEqual({ kind: 'not_found' })
  })
  it('revokes paid service features for cancelled/past-due subscriptions and omits dependent reads', async () => {
    for (const status of ['cancelled', 'past_due']) {
      const { query, queries } = fixture({ tenant_subscriptions: [{ status, features: ['payments'] }] })
      const result = await readOwnedPublicMenu(query, 'restaurant', undefined)
      expect(result.kind === 'menu' && result.capabilities.guestOrdering).toBe(false)
      expect(queries.some(item => /FROM public\.(delivery_zones|product_ingredients)\b/.test(item.text))).toBe(false)
    }
  })
  it('refuses ambiguous tenant/settings and bounded-limit overflows instead of choosing partial data', async () => {
    await expect(readOwnedPublicMenu(fixture({ tenants: [{ id: tenantId }, { id: randomUUID() }] }).query, 'restaurant', undefined)).rejects.toThrow('Public menu is unavailable')
    await expect(readOwnedPublicMenu(fixture({ products: Array.from({ length: 2001 }, () => ({ id: randomUUID() })) }).query, 'restaurant', undefined)).rejects.toThrow('Public menu is unavailable')
  })
  it('sanitizes failures and never logs provider/credential-bearing details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = randomUUID()
    await expect(readOwnedPublicMenu(async () => { throw Error(secret) }, 'restaurant', undefined)).rejects.toThrow(/^Public menu is unavailable$/)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
  it('selects only an explicit own flag and exposes no private column in fixed projections', () => {
    expect(publicMenuSource({})).toBe('legacy')
    expect(publicMenuSource({ OWNED_PUBLIC_MENU_ENABLED: 'true' })).toBe('owned-v1')
    expect(Object.values(PUBLIC_MENU_COLUMNS).join(' ')).not.toMatch(/api_key|stripe_|xphere_|password|secret|token/)
    const pool = createPublicMenuPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: 'private-db', PROD_DATABASE_NAME: 'menu',
      PUBLIC_MENU_DATABASE_URL: `postgres://reader:${randomUUID()}@private-db:5432/menu?sslmode=require`, PUBLIC_MENU_DATABASE_SSL: 'disable' })
    expect(pool.options.max).toBe(2)
    expect(pool.options.options).toContain('default_transaction_read_only=on')
    expect(pool.options.ssl).toBe(false)
    void pool.end()
  })
})

describe('one bounded repeatable-read catalog snapshot', () => {
  it('commits/releases a successful snapshot and rolls back a failed read', async () => {
    for (const failed of [false, true]) {
      const calls: string[] = [], releases: unknown[] = []
      const source = { connect: async () => ({ query: async (text: string) => {
        calls.push(text)
        if (text.startsWith('SELECT')) { if (failed) throw Error(randomUUID()); return { rows: [] } }
        return { rows: [] }
      }, release: (destroy?: boolean) => { releases.push(destroy) } }) } as unknown as Pick<pg.Pool, 'connect'>
      if (failed) await expect(readPublicMenuSnapshot(source, 'missing', undefined)).rejects.toThrow('Public menu is unavailable')
      else expect(await readPublicMenuSnapshot(source, 'missing', undefined)).toEqual({ kind: 'not_found' })
      expect(calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      expect(calls.at(-1)).toBe(failed ? 'ROLLBACK' : 'COMMIT')
      expect(releases).toEqual([undefined])
    }
  })
  it('destroys a stalled connection once and never hands its transaction to another caller', async () => {
    const released: unknown[] = []
    const source = { connect: async () => ({ query: () => new Promise(() => {}), release: (destroy?: boolean) => released.push(destroy) }) } as unknown as Pick<pg.Pool, 'connect'>
    await expect(readPublicMenuSnapshot(source, 'restaurant', undefined, 5)).rejects.toThrow('Public menu is unavailable')
    expect(released).toEqual([true])
  })
  it('sanitizes pool admission failures before the snapshot starts', async () => {
    const source = { connect: async () => { throw Error(randomUUID()) } } as unknown as Pick<pg.Pool, 'connect'>
    await expect(readPublicMenuSnapshot(source, 'restaurant', undefined)).rejects.toThrow(/^Public menu is unavailable$/)
  })
  it('bounds a pool admission that never resolves', async () => {
    const source = { connect: () => new Promise(() => {}) } as unknown as Pick<pg.Pool, 'connect'>
    await expect(readPublicMenuSnapshot(source, 'restaurant', undefined, 5)).rejects.toThrow(/^Public menu is unavailable$/)
  })
  it('destroys a late pool lease once without starting a snapshot', async () => {
    let admit!: (client: pg.PoolClient) => void
    const query = vi.fn(), release = vi.fn()
    const source = { connect: () => new Promise<pg.PoolClient>(resolve => { admit = resolve }) } as unknown as Pick<pg.Pool, 'connect'>
    await expect(readPublicMenuSnapshot(source, 'restaurant', undefined, 5)).rejects.toThrow(/^Public menu is unavailable$/)
    admit({ query, release } as unknown as pg.PoolClient)
    await Promise.resolve()
    expect(query).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledExactlyOnceWith(true)
  })
})
