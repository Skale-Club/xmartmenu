/**
 * POST /api/orders refuses what the catalog does not allow and never prices a
 * line below what it costs (EX-03): unknown or foreign options, missing
 * required choices, products and branches of another restaurant. A retried
 * request with the same Idempotency-Key returns the same order, and what is
 * stored comes from the catalog, not the payload.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { db, getOrder, uniqueName } from '../fixtures/db'
import { TENANTS, product, steakSize, steakSizeGroup } from '../fixtures/seed'

const tenant = TENANTS.self
const steak = product('self', 'steak')
const burger = product('self', 'burger')

function body(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    tenant_id: tenant.id,
    customer_name: uniqueName('Integrity'),
    customer_phone: '+5511900000001',
    order_type: 'dine_in',
    items,
    ...extra,
  }
}

const steakLine = (sizeOption: string, group = steakSizeGroup('self')) => ({
  product_id: steak.id,
  quantity: 1,
  unit_price: 0.01,
  product_name: 'Free steak',
  editor_state: { singleSelections: { [group]: sizeOption } },
})

async function post(request: APIRequestContext, data: unknown, key?: string) {
  const response = await request.post('/api/orders', {
    data,
    headers: key ? { 'Idempotency-Key': key } : undefined,
  })
  const json = await response.json().catch(() => ({}))
  return { status: response.status(), json: json as { id?: string; error?: string; total?: number } }
}

test.describe('order integrity', () => {
  test('an unknown option is refused, never priced as zero', async ({ request }) => {
    const { status } = await post(request, body([steakLine(randomUUID())]))
    expect(status).toBe(400)
  })

  test('a required choice cannot be left out', async ({ request }) => {
    const { status, json } = await post(request, body([{ product_id: steak.id, quantity: 1, unit_price: 1 }]))
    expect(status, json.error).toBe(400)
  })

  test('an option of another restaurant is refused', async ({ request }) => {
    const { status } = await post(request, body([steakLine(steakSize('waiter', 'large'), steakSizeGroup('waiter'))]))
    expect(status).toBe(400)
  })

  test('a product of another restaurant is refused', async ({ request }) => {
    const { status } = await post(request, body([{ product_id: product('waiter', 'burger').id, quantity: 1, unit_price: 1 }]))
    expect(status).toBe(400)
  })

  test('a branch of another restaurant is refused', async ({ request }) => {
    const { data: foreign } = await db().from('locations').select('id').neq('tenant_id', tenant.id).limit(1).maybeSingle()
    const { status } = await post(request, body([{ product_id: burger.id, quantity: 1, unit_price: 1 }], { location_id: foreign?.id ?? randomUUID() }))
    expect(status).toBe(400)
  })

  test('names, options and prices stored come from the catalog', async ({ request }) => {
    const { status, json } = await post(request, body([steakLine(steakSize('self', 'large'))]))
    expect(status, json.error).toBe(200)
    const order = await getOrder(json.id!)
    expect(Number(order.order_items[0].unit_price)).toBe(steak.price + 10)
    const { data: item } = await db().from('order_items').select('product_name, selected_options').eq('order_id', json.id!).single()
    expect(item?.product_name).toBe(steak.name)
    expect(item?.selected_options).toEqual({ Size: 'Large' })
    const { data: snapshot } = await db().from('orders').select('currency, subtotal, delivery_fee_cents').eq('id', json.id!).single()
    expect(snapshot?.currency).toBe('BRL')
    expect(Number(snapshot?.subtotal)).toBe(steak.price + 10)
  })

  test('the same Idempotency-Key returns the same order once', async ({ request }) => {
    const key = randomUUID()
    const payload = body([{ product_id: burger.id, quantity: 2, unit_price: burger.price }])
    const [a, b] = await Promise.all([post(request, payload, key), post(request, payload, key)])
    expect(a.status, a.json.error).toBe(200)
    expect(b.status, b.json.error).toBe(200)
    expect(b.json.id).toBe(a.json.id)
    const { count } = await db().from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('idempotency_key', key)
    expect(count).toBe(1)
  })

  test('the same key with a different order is a conflict', async ({ request }) => {
    const key = randomUUID()
    const first = await post(request, body([{ product_id: burger.id, quantity: 1, unit_price: burger.price }]), key)
    expect(first.status, first.json.error).toBe(200)
    const second = await post(request, body([{ product_id: burger.id, quantity: 3, unit_price: burger.price }]), key)
    expect(second.status).toBe(409)
  })

  test('an order always has its items (one transaction)', async ({ request }) => {
    const { json } = await post(request, body([{ product_id: burger.id, quantity: 1, unit_price: burger.price }]))
    const order = await getOrder(json.id!)
    expect(order.order_items.length).toBe(1)
  })
})
