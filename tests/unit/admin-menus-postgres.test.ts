import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { Menu } from '@/types/database'
import { activeAdminMenu, adminMenusOwned, AdminMenuError, findAdminMenu, menuPatch, mutateAdminMenu, readAdminMenus, type AdminMenuQuery } from '@/lib/data/admin-menus'
import { adminMenuTransaction, createAdminMenusPool } from '@/lib/data/admin-menus-runtime'

const tenantId = randomUUID(), id = randomUUID(), foreign = randomUUID()
const context = { tenantId, role: 'store-admin' as const }
const menu = { id, tenant_id: tenantId, name: 'Dinner', slug: 'dinner', position: 1, is_default: false, is_active: false, supported_languages: ['en', 'pt'], price_multiplier: 1.25 } as Menu
function fixture(options: { invalid?: boolean; absent?: boolean; overflow?: boolean; collision?: boolean; drift?: boolean; ar?: boolean } = {}) {
  const calls: Array<{ text: string; values: unknown[] }> = []
  const query: AdminMenuQuery = async (text, values = []) => {
    calls.push({ text, values })
    if (text.startsWith('SELECT EXISTS')) return { rows: [{ invalid: options.invalid ?? false }] }
    if (text.includes('to_regclass')) return { rows: [{ ok: options.ar ?? false }] }
    if (text.includes('pg_catalog.pg_constraint')) return { rows: options.drift ? [{ schema: 'public', edge: 'unexpected:menu_id:menus:id:c', columns: 1, validated: true }] : [] }
    if (text.includes('AS row')) return { rows: options.absent ? [] : [{ row: menu }] }
    if (text.startsWith('SELECT id FROM public.menus')) return { rows: options.collision ? [{ id }] : [] }
    if (text.startsWith('SELECT id')) return { rows: options.overflow ? Array.from({ length: 5001 }, () => ({ id, menu_id: id })) : [{ id, menu_id: id }] }
    return { rows: [] }
  }
  return { query, calls }
}
describe('owned administrative menu lifecycle', () => {
  it('requires the explicit flag and recognized tenant membership before every query', async () => {
    expect(adminMenusOwned({})).toBe(false)
    expect(adminMenusOwned({ OWNED_ADMIN_MENUS_ENABLED: 'TRUE' })).toBe(false)
    expect(adminMenusOwned({ OWNED_ADMIN_MENUS_ENABLED: 'true' })).toBe(true)
    const { query, calls } = fixture()
    await expect(readAdminMenus(query, { tenantId, role: 'customer' })).rejects.toMatchObject({ status: 403 })
    await expect(readAdminMenus(query, { ...context, tenantId: 'anything' })).rejects.toMatchObject({ status: 403 })
    expect(calls).toEqual([])
  })
  it('uses fixed public menu columns and tenant parameters, including inactive administration records', async () => {
    const { query, calls } = fixture()
    expect(await readAdminMenus(query, context)).toEqual([menu])
    expect(calls[0].values).toEqual([tenantId])
    expect(calls[0].text).toContain('m.tenant_id=$1')
    expect(calls[0].text).toContain('LIMIT 1001')
    expect(calls[0].text).not.toMatch(/SELECT\s+\*|is_active=true|api_key|password/i)
    expect(await findAdminMenu(query, context, "' OR true --")).toBeNull()
    expect(calls).toHaveLength(1)
    await findAdminMenu(query, context, foreign)
    expect(calls[1].values).toEqual([tenantId, foreign])
  })
  it('preserves inactive selected/default menus and falls back only inside the tenant list', () => {
    const other = { ...menu, id: foreign, is_default: true }
    expect(activeAdminMenu([menu, other], id)).toBe(menu)
    expect(activeAdminMenu([menu, other], randomUUID())).toBe(other)
    expect(activeAdminMenu([menu, { ...other, is_default: false }])).toBe(menu)
    expect(activeAdminMenu([{ ...menu, is_default: true }, other])?.id).toBe(id)
    expect(activeAdminMenu([], id)).toBeNull()
  })
  it('normalizes languages/translations, keeps zero position and ignores immutable IDs/tenant/slug', () => {
    const patch = menuPatch({ tenant_id: foreign, id: foreign, slug: 'hijack', position: 0, language: 'pt', supported_languages: ['pt', 'pt', 'invalid'], translations: { pt: { name: '  Jantar ' }, en: { name: 'No' } } }, menu)
    expect(patch).toEqual({ position: 0, language: 'pt', supported_languages: ['pt'], translations: { pt: { name: 'Jantar' } } })
    expect(menuPatch({ translations: { pt: { description: '  Texto ' } } }, menu)).toEqual({ translations: { pt: { description: 'Texto' } } })
    for (const body of [null, { name: '' }, { is_default: 'true' }, { price_multiplier: 0 }, { price_multiplier: Infinity }, { position: 1.5 }]) {
      expect(() => menuPatch(body, menu)).toThrow(AdminMenuError)
    }
  })
  it('creates with server tenant/slug and parameterizes even hostile display text', async () => {
    const { query, calls } = fixture({ collision: true })
    const name = "Dinner'); DELETE FROM menus; --"
    const result = await mutateAdminMenu(query, context, { kind: 'create', body: { name, tenant_id: foreign, id: foreign, language: 'pt', supported_languages: ['pt'], translations: { pt: { name: 'Jantar' } } } })
    expect(result).toEqual(menu)
    expect(calls[0].values).toEqual([`xmartmenu-admin-menus:${tenantId}`])
    const insert = calls.at(-1)!
    expect(insert.text).not.toContain(name)
    expect(insert.values[0]).toBe(tenantId)
    expect(insert.values[1]).toBe(name)
    expect(insert.values[2]).toMatch(/^dinner-delete-from-menus-[a-z0-9]+$/)
    expect(insert.values).not.toContain(foreign)
  })
  it('serializes a default promotion and scopes both updates to the authorized tenant', async () => {
    const { query, calls } = fixture()
    await mutateAdminMenu(query, context, { kind: 'patch', id, body: { is_default: true, price_multiplier: 1.15, slug: 'unchanged' } })
    expect(calls[1].text).toContain('FOR UPDATE OF m')
    expect(calls[2].text).toContain('WHERE tenant_id=$1 AND is_default=true')
    expect(calls[2].values).toEqual([tenantId])
    expect(calls[3].text).toContain('m.tenant_id=$1 AND m.id=$2')
    expect(calls[3].text).not.toContain('slug=')
    expect(calls[3].values).toEqual([tenantId, id, true, 1.15])
  })
  it('denies staff writes, preserves hidden ownership and refuses deleting the default', async () => {
    const staff = { ...context, role: 'store-staff' as const }
    const { query, calls } = fixture()
    await expect(mutateAdminMenu(query, staff, { kind: 'create', body: { name: 'No' } })).rejects.toMatchObject({ status: 403 })
    expect(calls).toHaveLength(0)
    await expect(mutateAdminMenu(query, staff, { kind: 'patch', id, body: {} })).rejects.toMatchObject({ status: 403 })
    await expect(mutateAdminMenu(fixture({ absent: true }).query, staff, { kind: 'delete', id })).rejects.toMatchObject({ status: 404 })
    const defaultQuery: AdminMenuQuery = async () => ({ rows: [{ row: { ...menu, is_default: true } }] })
    await expect(mutateAdminMenu(defaultQuery, context, { kind: 'delete', id })).rejects.toMatchObject({ status: 400, message: 'Cannot delete the default menu' })
  })
  it('locks cascading parents and refuses corrupt cross-tenant descendants or oversized deletion', async () => {
    for (const options of [{ invalid: true }, { overflow: true }, { drift: true }]) {
      const { query, calls } = fixture(options)
      await expect(mutateAdminMenu(query, context, { kind: 'delete', id })).rejects.toMatchObject({ status: 409 })
      expect(calls.some(call => call.text.startsWith('DELETE'))).toBe(false)
    }
    const { query, calls } = fixture()
    expect(await mutateAdminMenu(query, context, { kind: 'delete', id })).toEqual({ ok: true })
    // 10 catalog/analytics scopes + the menu's staging copies (menus.staging_of, SET NULL).
    expect(calls.filter(call => call.text.includes('LIMIT 5001 FOR UPDATE'))).toHaveLength(11)
    const integrity = calls.find(call => call.text.startsWith('SELECT EXISTS'))!
    expect(integrity.text).toContain('public.orders')
    expect(integrity.text).toContain("to_jsonb(menus)->>'staging_of'")
    expect(integrity.text).not.toContain('product_ar_models')
    expect(integrity.values).toEqual([tenantId, id, [id], [id], [id], [id]])
    expect(calls.at(-1)?.values).toEqual([tenantId, id])
  })
  it('locks and checks 3D models too once that table exists', async () => {
    const { query, calls } = fixture({ ar: true })
    expect(await mutateAdminMenu(query, context, { kind: 'delete', id })).toEqual({ ok: true })
    expect(calls.find(call => call.text.startsWith('LOCK TABLE'))?.text).toContain('public.product_ar_models')
    expect(calls.filter(call => call.text.includes('LIMIT 5001 FOR UPDATE'))).toHaveLength(12)
    expect(calls.find(call => call.text.startsWith('SELECT EXISTS'))?.text).toContain('public.product_ar_models')
  })
  it('refuses to make a staging copy visible or default outside the publish swap', async () => {
    const staged = { ...menu, staging_of: foreign } as Menu
    const query: AdminMenuQuery = async text => text.includes('AS row') ? { rows: [{ row: staged }] } : { rows: [] }
    await expect(mutateAdminMenu(query, context, { kind: 'patch', id, body: { is_active: true } })).rejects.toMatchObject({ status: 409 })
    await expect(mutateAdminMenu(query, context, { kind: 'patch', id, body: { is_default: true } })).rejects.toMatchObject({ status: 409 })
    await expect(mutateAdminMenu(query, context, { kind: 'patch', id, body: { name: 'Dinner v2' } })).resolves.toBeTruthy()
  })
})

describe('bounded PostgreSQL administrative transactions', () => {
  it('defaults the reused bounded pool to read-only', async () => {
    const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: 'private-db', PROD_DATABASE_NAME: 'menu', ADMIN_MENUS_DATABASE_URL: `postgres://reader:${randomUUID()}@private-db:5432/menu`, ADMIN_MENUS_DATABASE_SSL: 'disable' })
    expect(pool.options.max).toBe(2)
    expect(pool.options.options).toContain('default_transaction_read_only=on')
    expect(pool.options.statement_timeout).toBe(5000)
    await pool.end()
  })
  it('uses explicit read/write boundaries and rolls back partial default updates without retry/log leaks', async () => {
    for (const failed of [false, true]) {
      const calls: string[] = [], release = vi.fn()
      const source = { connect: async () => ({ query: async (text: string) => { calls.push(text); return { rows: [] } }, release }) } as unknown as Pick<pg.Pool, 'connect'>
      const operation = async (query: AdminMenuQuery) => { await query('UPDATE default'); if (failed) throw Error(randomUUID()); return 'done' }
      if (failed) await expect(adminMenuTransaction(source, true, operation)).rejects.toMatchObject({ status: 503, message: 'Menu service is unavailable' })
      else expect(await adminMenuTransaction(source, true, operation)).toBe('done')
      expect(calls).toEqual(['BEGIN READ WRITE', 'UPDATE default', failed ? 'ROLLBACK' : 'COMMIT'])
      expect(release).toHaveBeenCalledTimes(1)
    }
  })
  it('bounds hung admission and destroys a late lease once before any query', async () => {
    let admit!: (client: pg.PoolClient) => void
    const query = vi.fn(), release = vi.fn()
    const source = { connect: () => new Promise<pg.PoolClient>(resolve => { admit = resolve }) } as unknown as Pick<pg.Pool, 'connect'>
    await expect(adminMenuTransaction(source, false, async () => null, 5)).rejects.toMatchObject({ status: 503 })
    admit({ query, release } as unknown as pg.PoolClient)
    await Promise.resolve()
    expect(query).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('destroys a stalled active transaction without rollback/query after release', async () => {
    const release = vi.fn(), query = vi.fn(() => new Promise(() => {}))
    const source = { connect: async () => ({ query, release }) } as unknown as Pick<pg.Pool, 'connect'>
    await expect(adminMenuTransaction(source, true, async () => null, 5)).rejects.toMatchObject({ status: 503 })
    expect(query).toHaveBeenCalledExactlyOnceWith('BEGIN READ WRITE', undefined)
    expect(release).toHaveBeenCalledExactlyOnceWith(true)
  })
})
