/**
 * Order history follows proven identity (EX-07): two numbers that share their
 * last 8 digits never share history, a typed phone is contact data only, and
 * an anonymous order is attached to an account only when that account
 * verified the order's full number.
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { db, uniqueName } from '../fixtures/db'
import { TENANTS, product } from '../fixtures/seed'

const tenant = TENANTS.self
const burger = product('self', 'burger')

async function order(request: import('@playwright/test').APIRequestContext, phone: string) {
  const response = await request.post('/api/orders', {
    data: {
      tenant_id: tenant.id,
      customer_name: uniqueName('History'),
      customer_phone: phone,
      order_type: 'dine_in',
      items: [{ product_id: burger.id, quantity: 1, unit_price: burger.price }],
    },
  })
  const json = await response.json()
  expect(response.status(), json.error).toBe(200)
  return json.id as string
}

test('same last 8 digits, different people: only the verified owner gets the order', async ({ request }) => {
  const suffix = String(Math.floor(10_000_000 + Math.random() * 89_999_999))
  const mine = `+5511${suffix}`
  const theirs = `+5521${suffix}`
  const myOrder = await order(request, mine)
  const theirOrder = await order(request, theirs)

  const { data: rows } = await db().from('orders').select('id, customer_id, customer_phone_e164, customer_phone_key').in('id', [myOrder, theirOrder])
  const byId = new Map((rows ?? []).map((r) => [r.id, r]))
  expect(byId.get(myOrder)?.customer_phone_key).toBe(byId.get(theirOrder)?.customer_phone_key) // legacy key collides
  expect(byId.get(myOrder)?.customer_phone_e164).toBe(mine)
  expect(byId.get(theirOrder)?.customer_phone_e164).toBe(theirs)
  expect(byId.get(myOrder)?.customer_id).toBeNull() // a typed phone proves nothing

  // The owner of `mine` verifies it (a confirmed phone account), then visits /me.
  const { data: created, error } = await db().auth.admin.createUser({ phone: mine.slice(1), phone_confirm: true, password: randomUUID() })
  expect(error).toBeNull()
  const userId = created.user!.id
  try {
    const { data: linked, error: linkError } = await db().rpc('link_orders_to_verified_phone', {
      p_tenant_id: tenant.id, p_user_id: userId, p_phone_e164: mine,
    })
    expect(linkError).toBeNull()
    expect(linked).toBeGreaterThanOrEqual(1)

    const { data: after } = await db().from('orders').select('id, customer_id, customer_link_method').in('id', [myOrder, theirOrder])
    const m = new Map((after ?? []).map((r) => [r.id, r]))
    expect(m.get(myOrder)).toMatchObject({ customer_id: userId, customer_link_method: 'verified_phone' })
    expect(m.get(theirOrder)?.customer_id).toBeNull()
  } finally {
    await db().from('orders').update({ customer_id: null, customer_linked_at: null, customer_link_method: null }).eq('customer_id', userId)
    await db().auth.admin.deleteUser(userId)
  }
})

test('an ambiguous local number is not normalized by guesswork', async ({ request }) => {
  // The seed restaurant has no country configured.
  const id = await order(request, '11 98888-7777')
  const { data } = await db().from('orders').select('customer_phone_e164').eq('id', id).single()
  expect(data?.customer_phone_e164).toBeNull()
})

test('the customer panel requires a verified phone session', async ({ request }) => {
  const response = await request.get(`/${tenant.slug}/me`, { maxRedirects: 0 })
  expect([302, 303, 307, 308]).toContain(response.status())
  expect(response.headers()['location']).toContain(`/${tenant.slug}/me/login`)
})
