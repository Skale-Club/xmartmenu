import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { assertOrderRpcCompatibility, assertUnambiguousOrderOptionPricing, ORDER_RPC_BODY_SHA256, OrderDataError, OwnedOrderRepository, ordersDataOwned, type OrderPriceGroup, type OrderQuery } from '@/lib/data/orders'
import { resolveOptionSelection } from '@/lib/menu/option-pricing'
import { createOrdersPool, orderTransaction } from '@/lib/data/orders-runtime'

const tenantId = randomUUID(), productId = randomUUID(), menuId = randomUUID(), id = randomUUID()
const compatible = { security_definer: false, returns_set: false, argument_defaults: 0,
  argument_names: ['p_order','p_items'], settings: ['search_path=public'], language: 'plpgsql', returns_jsonb: true,
  jsonb_arguments: true, volatile: true, body_sha256: ORDER_RPC_BODY_SHA256, executable: true, independent_of_auth_rls: true, idempotency_index: true }
const product = { id: productId, tenant_id: tenantId, name: 'Catalog dish', price: 12.5, is_available: true,
  menu_id: menuId, menus: { id: menuId, is_active: true, is_private: false, price_multiplier: 1 } }
const order = { tenant_id: tenantId, customer_id: null, status: 'pending', total: 12.5, idempotency_key: 'test-checkout-key', request_fingerprint: 'same' }
const items = [{ product_id: productId, product_name: 'Catalog dish', quantity: 1, unit_price: 12.5 }]
function fixture(options: { compatibility?: Record<string, unknown>; current?: string; changed?: boolean; analyticsFail?: boolean } = {}) {
  const calls: Array<{ text: string; values?: unknown[] }> = []
  const query: OrderQuery = async (text, values) => {
    calls.push({ text, values })
    if (text.includes('FROM pg_proc')) return { rows: [options.compatibility ?? compatible] }
    if (text.includes('FROM public.products p JOIN public.menus')) return { rows: [{ row: product }] }
    if (text.startsWith('SELECT public.create_order_with_items')) return { rows: [{ row: { id, status: 'pending', total: 12.5, order_type: 'dine_in', replayed: false } }] }
    if (text.startsWith('SELECT id,status,order_type')) return { rows: [{ id, status: options.current ?? 'pending', order_type: 'dine_in' }] }
    if (text.startsWith('UPDATE public.orders')) return { rows: options.changed ? [] : [{ id, status: values?.[2] }] }
    if (text.startsWith('INSERT INTO public.menu_events') && options.analyticsFail) throw Error('sensitive provider diagnostics')
    return { rows: [] }
  }
  return { query, calls, repository: new OwnedOrderRepository(query, tenantId) }
}

describe('owned order database boundary', () => {
  it('defaults off and pins the current migration function body without provider calls', async () => {
    expect(ordersDataOwned({})).toBe(false)
    expect(ordersDataOwned({ OWNED_ORDER_DATA_ENABLED: 'true' })).toBe(true)
    const source = (await readFile('supabase/migrations/20261027095000_order_customer_identity.sql', 'utf8')).replaceAll('\r\n','\n')
    const body = source.match(/CREATE OR REPLACE FUNCTION public\.create_order_with_items\(p_order JSONB, p_items JSONB\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1]
    expect(body).toBeTruthy()
    expect(createHash('sha256').update(body!).digest('hex')).toBe(ORDER_RPC_BODY_SHA256)
    expect(body).not.toMatch(/auth\.(uid|role)\s*\(/)
  })
  it('refuses changed RPC body/signature/ACL/RLS/index before invoking the restored function', async () => {
    for (const patch of [{ executable: false }, { body_sha256: randomUUID() }, { security_definer: true }, { jsonb_arguments: false }, { idempotency_index: false }, { independent_of_auth_rls: false }]) {
      const { repository, calls } = fixture({ compatibility: { ...compatible, ...patch } })
      await expect(repository.create(order, items, null)).rejects.toMatchObject({ status: 503 })
      expect(calls.some(call => call.text.startsWith('SELECT public.create_order_with_items'))).toBe(false)
    }
    await expect(assertOrderRpcCompatibility(async () => ({ rows: [] }))).rejects.toBeInstanceOf(OrderDataError)
  })
  it('calls the same RPC with JSONB parameters and never inserts a header/items independently', async () => {
    const { repository, calls } = fixture()
    expect((await repository.create(order, items, null)).data?.id).toBe(id)
    const rpc = calls.at(-1)!
    expect(rpc.text).toBe('SELECT public.create_order_with_items($1::jsonb,$2::jsonb) AS row')
    expect(rpc.values).toEqual([JSON.stringify(order),JSON.stringify(items)])
    expect(calls.some(call => /INSERT INTO public\.(orders|order_items)/.test(call.text))).toBe(false)
  })
  it('refuses tenant/customer spoofing and unreviewed payload columns before SQL', async () => {
    const { repository, calls } = fixture()
    for (const changed of [{ ...order, tenant_id: randomUUID() }, { ...order, customer_id: randomUUID() }, { ...order, payment_intent_id: 'not-accepted' }]) {
      await expect(repository.create(changed, items, null)).rejects.toMatchObject({ status: 400 })
    }
    expect(calls).toHaveLength(0)
    await expect(repository.list({ tenantId, role: 'customer' }, new Date().toISOString())).rejects.toMatchObject({ status: 403 })
  })
  it('tenant-scopes every catalog join and keeps mutations parameterized', async () => {
    const { repository, calls } = fixture()
    await repository.optionGroups([productId]); await repository.ingredients([productId]); await repository.deliveryZones()
    for (const call of calls) { expect(call.values?.[0]).toBe(tenantId); expect(call.text).not.toContain(tenantId) }
    expect(calls[0].text).toContain('o.tenant_id=$1')
    expect(calls[1].text).toContain('i.tenant_id=$1')
    expect(calls[1].text).toContain('pi.tenant_id=$1')
  })
  it('never treats ambiguous active payment configuration as permission to skip payment', async () => {
    const query: OrderQuery = async text => text.includes('SELECT CASE WHEN')
      ? { rows: [{ features: ['stripe-connect'] }] } : { rows: [{ id: randomUUID() },{ id: randomUUID() }] }
    await expect(new OwnedOrderRepository(query,tenantId).stripeEnabled()).rejects.toMatchObject({ status: 503 })
  })
  it('keeps kitchen/payment separation and uses tenant+old-status compare-and-set', async () => {
    const { repository, calls } = fixture()
    await expect(repository.move({ tenantId, role: 'store-staff' }, id, 'paid')).rejects.toMatchObject({ status: 409 })
    expect(await repository.move({ tenantId, role: 'store-staff' }, id, 'preparing')).toEqual({ id, status: 'preparing' })
    expect(calls.at(-1)?.values).toEqual([tenantId,id,'preparing','pending'])
    expect(calls.at(-1)?.text).toContain('WHERE tenant_id=$1 AND id=$2 AND status=$4')
    await expect(fixture({ changed: true }).repository.move({ tenantId, role: 'store-admin' }, id, 'preparing')).rejects.toMatchObject({ status: 409 })
  })
  it('isolates best-effort analytics failure with a savepoint instead of aborting an order', async () => {
    const { repository, calls } = fixture({ analyticsFail: true })
    await repository.recordAnalytics(id, 'order_created')
    expect(calls.map(call => call.text.split('\n')[0])).toEqual(['SAVEPOINT order_analytics',expect.stringContaining('INSERT INTO public.menu_events'),'ROLLBACK TO SAVEPOINT order_analytics','RELEASE SAVEPOINT order_analytics'])
  })
  it('rolls back optional analytics lookup SQL failures and returns no attribution', async () => {
    for (const code of ['42P01','42501','57014']) {
      const calls: string[] = []
      const query: OrderQuery = async text => {
        calls.push(text)
        if (text.includes('FROM public.menu_sessions')) throw Object.assign(Error('sensitive SQL diagnostics'),{ code })
        return { rows: [] }
      }
      expect(await new OwnedOrderRepository(query,tenantId).analyticsSession(id)).toEqual({ data:null,error:null })
      expect(calls[0]).toBe('SAVEPOINT order_analytics_lookup')
      expect(calls.slice(-2)).toEqual(['ROLLBACK TO SAVEPOINT order_analytics_lookup','RELEASE SAVEPOINT order_analytics_lookup'])
    }
  })
  it('refuses tied selected reset/add pricing while permitting unique positions and commuting additions', () => {
    const additive = randomUUID(), reset = randomUUID(), a = randomUUID(), b = randomUUID()
    const groups: OrderPriceGroup[] = [
      { id:additive,name:'Extras',position:0,type:'multiple',options:[{ id:a,base_price:null,price_modifier:2 }] },
      { id:reset,name:'Size',position:0,type:'single',options:[{ id:b,base_price:20,price_modifier:0 }] },
    ]
    const editor = { multiSelections:{ [additive]:[a] },singleSelections:{ [reset]:b } }
    expect(resolveOptionSelection(10,editor,groups).unit).toBe(20)
    expect(resolveOptionSelection(10,editor,[...groups].reverse()).unit).toBe(22)
    expect(() => assertUnambiguousOrderOptionPricing(10,editor,groups)).toThrowError(OrderDataError)
    expect(() => assertUnambiguousOrderOptionPricing(10,editor,[groups[0],{ ...groups[1],position:1 }])).not.toThrow()
    const commuting = [groups[0],{ ...groups[1],options:[{ id:b,base_price:null,price_modifier:3 }] }]
    expect(() => assertUnambiguousOrderOptionPricing(10,editor,commuting)).not.toThrow()
    expect(resolveOptionSelection(10,editor,commuting).unit).toBe(resolveOptionSelection(10,editor,[...commuting].reverse()).unit)
    expect(() => assertUnambiguousOrderOptionPricing(10,{ multiSelections:{ [additive]:[a] } },groups)).not.toThrow()
  })
  it('refuses tied duplicate label overwrites that would change the checkout fingerprint', () => {
    const one = randomUUID(), two = randomUUID(), a = randomUUID(), b = randomUUID()
    const groups: OrderPriceGroup[] = [
      { id:one,name:'Same label',position:0,type:'single',options:[{ id:a,name:'First',base_price:null,price_modifier:1 }] },
      { id:two,name:'Same label',position:0,type:'single',options:[{ id:b,name:'Second',base_price:null,price_modifier:1 }] },
    ]
    expect(() => assertUnambiguousOrderOptionPricing(10,{ singleSelections:{ [one]:a,[two]:b } },groups)).toThrowError(OrderDataError)
  })
})

describe('bounded owned order transactions', () => {
  it('uses a two-connection pool, read-only default and explicit independent ORDERS target', async () => {
    const pool = createOrdersPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: 'private-db', PROD_DATABASE_NAME: 'menu',
      ORDERS_DATABASE_URL: `postgres://runtime:${randomUUID()}@private-db:5432/menu`, ORDERS_DATABASE_SSL: 'disable' })
    expect(pool.options.max).toBe(2)
    expect(pool.options.options).toContain('default_transaction_read_only=on')
    expect(pool.options.application_name).toBe('xprout-orders')
    await pool.end()
  })
  it('keeps READ COMMITTED for RPC retries and converts only P0409 into a safe domain conflict', async () => {
    const calls: string[] = [], release = vi.fn()
    const source = { connect: async () => ({ query: async (text: string) => { calls.push(text); return { rows: [] } }, release }) } as unknown as Pick<pg.Pool,'connect'>
    await expect(orderTransaction(source,true,async () => { throw Object.assign(Error(randomUUID()),{ code: 'P0409' }) })).rejects.toMatchObject({ status: 409 })
    expect(calls).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE','ROLLBACK'])
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('destroys a late pool lease without executing SQL after admission timed out', async () => {
    let resolve!: (client: unknown) => void
    const query = vi.fn(), release = vi.fn()
    const source = { connect: () => new Promise(r => { resolve = r }) } as unknown as Pick<pg.Pool,'connect'>
    await expect(orderTransaction(source,true,async () => 'unused',5)).rejects.toMatchObject({ status: 503 })
    resolve({ query, release }); await new Promise(r => setTimeout(r,1))
    expect(query).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledExactlyOnceWith(true)
  })
})
