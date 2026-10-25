/**
 * POST /api/orders against the real app and the local database: who may
 * order under which plan, how tables reach the order, and that prices come
 * from the database, not the client.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getOrder, uniqueName, updateSettings } from '../fixtures/db'
import { TABLES, TENANTS, product, steakSize, steakSizeGroup, storageStatePath, type TenantKey } from '../fixtures/seed'

type Item = { product_id: string; quantity: number; unit_price: number; editor_state?: unknown }

function orderBody(tenant: TenantKey, items: Item[], extra: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANTS[tenant].id,
    customer_name: uniqueName('API test'),
    customer_phone: '+5511900000000',
    order_type: 'dine_in',
    items: items.map(i => ({ product_name: 'x', selected_options: {}, ...i })),
    ...extra,
  }
}

async function placeOrder(request: APIRequestContext, body: Record<string, unknown>) {
  const response = await request.post('/api/orders', { data: body })
  const json = await response.json().catch(() => ({}))
  return { status: response.status(), json: json as { id?: string; status?: string; error?: string; requires_payment?: boolean } }
}

const burger = (tenant: TenantKey, quantity = 1): Item => ({ product_id: product(tenant, 'burger').id, quantity, unit_price: product(tenant, 'burger').price })

test.describe('guest orders (anonymous menu)', () => {
  test('self-service plan accepts the order and keeps it at the table', async ({ request }) => {
    const { status, json } = await placeOrder(request, orderBody('self', [burger('self', 2)], { table_id: TABLES.selfMesa4.id }))
    expect(status, json.error).toBe(200)
    const order = await getOrder(json.id!)
    expect(order).toMatchObject({ tenant_id: TENANTS.self.id, status: 'pending', order_type: 'dine_in', table_id: TABLES.selfMesa4.id, table_name: 'Mesa 4' })
    expect(Number(order.total)).toBe(40)
  })

  test('menu-only plan refuses guest orders even with ordering switched on', async ({ request }) => {
    const { status, json } = await placeOrder(request, orderBody('menu', [burger('menu')]))
    expect(status).toBe(403)
    expect(json.error).toMatch(/does not take orders/)
  })

  test('waiter plan refuses guest orders', async ({ request }) => {
    const { status } = await placeOrder(request, orderBody('waiter', [burger('waiter')]))
    expect(status).toBe(403)
  })

  test('ignores tables that are inactive, from another restaurant, or typed by the client', async ({ request }) => {
    for (const extra of [
      { table_id: TABLES.selfInactive.id },
      { table_id: TABLES.waiterMesa1.id },
      { table_id: 'not-a-uuid', table_name: 'VIP 1' },
    ]) {
      const { status, json } = await placeOrder(request, orderBody('self', [burger('self')], extra))
      expect(status, json.error).toBe(200)
      const order = await getOrder(json.id!)
      expect(order, JSON.stringify(extra)).toMatchObject({ table_id: null, table_name: null })
    }
  })

  test('a table only applies to orders eaten there', async ({ request }) => {
    const { json } = await placeOrder(request, orderBody('self', [burger('self')], { table_id: TABLES.selfMesa5.id, order_type: 'pickup' }))
    const order = await getOrder(json.id!)
    expect(order).toMatchObject({ order_type: 'pickup', table_id: null, table_name: null })
  })

  test('prices come from the database, not the request', async ({ request }) => {
    const steak = product('self', 'steak')
    const { json } = await placeOrder(request, orderBody('self', [
      { product_id: product('self', 'burger').id, quantity: 1, unit_price: 0.01 },
      {
        product_id: steak.id,
        quantity: 1,
        unit_price: 1,
        // "Large" (+10.00), chosen like the product modal does.
        editor_state: { singleSelections: { [steakSizeGroup('self')]: steakSize('self', 'large') }, halfSelections: {}, multiSelections: {}, ingredientSteppers: {}, addedIngredients: [], note: '' },
      },
    ]))
    const order = await getOrder(json.id!)
    const burgerItem = order.order_items.find(i => i.product_id === product('self', 'burger').id)
    const steakItem = order.order_items.find(i => i.product_id === steak.id)
    expect(Number(burgerItem?.unit_price)).toBe(20)
    expect(Number(steakItem?.unit_price)).toBe(55)
    expect(Number(order.total)).toBe(75)
  })

  test('rejects products from another restaurant', async ({ request }) => {
    const { status } = await placeOrder(request, orderBody('self', [burger('waiter')]))
    expect(status).toBe(400)
  })
})

test.describe('staff orders (waiter app)', () => {
  test.describe('waiter plan', () => {
    test.use({ storageState: storageStatePath('waiterStaff') })

    test('staff order goes through with the table, no online payment', async ({ request }) => {
      const { status, json } = await placeOrder(request, orderBody('waiter', [burger('waiter')], { table_id: TABLES.waiterMesa1.id, table_name: 'ignored' }))
      expect(status, json.error).toBe(200)
      expect(json.requires_payment).toBe(false)
      const order = await getOrder(json.id!)
      expect(order).toMatchObject({ status: 'pending', table_id: TABLES.waiterMesa1.id, table_name: 'Mesa 1' })
    })

    test('staff may still type a table when there is no id', async ({ request }) => {
      const { json } = await placeOrder(request, orderBody('waiter', [burger('waiter')], { table_name: 'Balcão 2' }))
      const order = await getOrder(json.id!)
      expect(order).toMatchObject({ table_id: null, table_name: 'Balcão 2' })
    })
  })

  test.describe('menu-only plan', () => {
    test.use({ storageState: storageStatePath('menuOwner') })

    test('even the owner cannot place orders', async ({ request }) => {
      const { status, json } = await placeOrder(request, orderBody('menu', [burger('menu')]))
      expect(status).toBe(403)
      expect(json.error).toMatch(/Waiter ordering/)
    })
  })
})

test.describe('restaurant switches inside the plan', () => {
  // Flips settings of its own restaurant (test-switch), one test at a time.
  test.describe.configure({ mode: 'serial' })

  test('guest ordering off blocks guests but not the waiter', async ({ request, browser }) => {
    await updateSettings(TENANTS.switch.id, { direct_orders_enabled: false })
    try {
      const guest = await placeOrder(request, orderBody('switch', [burger('switch')]))
      expect(guest.status).toBe(403)

      const staffContext = await browser.newContext({ storageState: storageStatePath('switchStaff') })
      const staff = await placeOrder(staffContext.request, orderBody('switch', [burger('switch')], { table_id: TABLES.switchMesa9.id }))
      expect(staff.status, staff.json.error).toBe(200)
      expect((await getOrder(staff.json.id!)).table_name).toBe('Mesa 9')
      await staffContext.close()
    } finally {
      await updateSettings(TENANTS.switch.id, { direct_orders_enabled: true })
    }
  })

  test('waiter app off blocks staff but not guests', async ({ request, browser }) => {
    await updateSettings(TENANTS.switch.id, { table_management_enabled: false })
    try {
      const staffContext = await browser.newContext({ storageState: storageStatePath('switchStaff') })
      const staff = await placeOrder(staffContext.request, orderBody('switch', [burger('switch')]))
      expect(staff.status).toBe(403)
      await staffContext.close()

      const guest = await placeOrder(request, orderBody('switch', [burger('switch')]))
      expect(guest.status, guest.json.error).toBe(200)
    } finally {
      await updateSettings(TENANTS.switch.id, { table_management_enabled: true })
    }
  })

  test('master switch off blocks everyone', async ({ request }) => {
    await updateSettings(TENANTS.switch.id, { orders_enabled: false })
    try {
      const { status } = await placeOrder(request, orderBody('switch', [burger('switch')]))
      expect(status).toBe(403)
    } finally {
      await updateSettings(TENANTS.switch.id, { orders_enabled: true })
    }
  })
})
