/**
 * Payment state comes from the provider, not from the browser or the board
 * (EX-04): a typed ?redirect_status=succeeded does not confirm anything, staff
 * cannot mark an order paid, and the board follows its state machine
 * (including out_for_delivery for delivery orders). The signed-webhook flow
 * itself needs Stripe test keys and runs against the staging checkout.
 */
import { expect, test, request as playwrightRequest } from '@playwright/test'
import { db, uniqueName } from '../fixtures/db'
import { TENANTS, product, storageStatePath } from '../fixtures/seed'

const tenant = TENANTS.waiter

async function insertOrder(status: string, orderType = 'dine_in') {
  const { data, error } = await db().from('orders').insert({
    tenant_id: tenant.id,
    customer_name: uniqueName('Payments'),
    customer_phone: '+5511900000002',
    status,
    total: 20,
    order_type: orderType,
  }).select('id').single()
  if (error) throw error
  await db().from('order_items').insert({
    order_id: data.id, product_id: product('waiter', 'burger').id, product_name: 'Classic Burger', quantity: 1, unit_price: 20,
  })
  return data.id as string
}

test.describe('payment confirmation', () => {
  test('a typed redirect_status=succeeded does not confirm an unpaid order', async ({ request }) => {
    const id = await insertOrder('awaiting_payment')
    const response = await request.get(`/checkout/${id}/confirmation?redirect_status=succeeded&payment_intent=pi_fake`)
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('Order Confirmed')
    expect(html).toContain('Processing Payment')
  })

  test('a paid order is confirmed whatever the query string says', async ({ request }) => {
    const id = await insertOrder('paid')
    const html = await (await request.get(`/checkout/${id}/confirmation?redirect_status=failed`)).text()
    expect(html).toContain('Order Confirmed')
  })
})

test.describe('order board transitions', () => {
  const asStaff = (baseURL: string | undefined) => playwrightRequest.newContext({ baseURL, storageState: storageStatePath('waiterStaff') })

  test('staff cannot mark an online order paid', async ({ baseURL }) => {
    const staff = await asStaff(baseURL)
    const id = await insertOrder('awaiting_payment')
    const response = await staff.patch(`/api/orders/${id}`, { data: { status: 'paid' } })
    expect(response.status()).toBe(409)
    const { data } = await db().from('orders').select('status').eq('id', id).single()
    expect(data?.status).toBe('awaiting_payment')
    await staff.dispose()
  })

  test('the board cannot move an order backwards', async ({ baseURL }) => {
    const staff = await asStaff(baseURL)
    const id = await insertOrder('done')
    expect((await staff.patch(`/api/orders/${id}`, { data: { status: 'pending' } })).status()).toBe(409)
    await staff.dispose()
  })

  test('delivery orders go out for delivery, others cannot', async ({ baseURL }) => {
    const staff = await asStaff(baseURL)
    const delivery = await insertOrder('ready', 'delivery')
    expect((await staff.patch(`/api/orders/${delivery}`, { data: { status: 'out_for_delivery' } })).status()).toBe(200)
    const dineIn = await insertOrder('ready', 'dine_in')
    expect((await staff.patch(`/api/orders/${dineIn}`, { data: { status: 'out_for_delivery' } })).status()).toBe(409)
    await staff.dispose()
  })
})
