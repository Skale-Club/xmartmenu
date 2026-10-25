/**
 * Observability against the real app + database: readiness, request ids that
 * travel from the response to the audit trail, the audit trigger for server
 * and browser writes, and who may read the trail.
 */
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { assertLocalSupabase, db, getOrder, uniqueName } from '../fixtures/db'
import { PASSWORD, TABLES, TENANTS, USER_IDS, product, storageStatePath } from '../fixtures/seed'

const DESSERTS_SELF = 'd0000000-0000-4000-8000-000000000033'

async function auditFor(filter: { table: string; record: string; requestId?: string }) {
  let query = db()
    .from('audit_events')
    .select('actor_id, via, action, changes, request_id, tenant_id')
    .eq('table_name', filter.table)
    .eq('record_id', filter.record)
    .order('id', { ascending: false })
    .limit(5)
  if (filter.requestId) query = query.eq('request_id', filter.requestId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/** A Supabase client signed in as a seeded user, like the admin in the browser. */
async function userClient(email: string) {
  const client = createClient(assertLocalSupabase(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return client
}

test.describe('health', () => {
  test('readiness reports the database and echoes the request id', async ({ request }) => {
    const response = await request.get('/api/health/ready', { headers: { 'x-request-id': 'e2e-health-0001' } })
    expect(response.status()).toBe(200)
    expect(response.headers()['x-request-id']).toBe('e2e-health-0001')
    const body = await response.json()
    expect(body).toMatchObject({ status: expect.stringMatching(/ok|degraded/), checks: { database: { ok: true } }, request_id: 'e2e-health-0001' })
    expect(body.config).toBeUndefined()
  })

  test('every response carries a request id, even when none was sent', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

test.describe('audit trail', () => {
  test.describe.configure({ mode: 'serial' })

  test.describe('server writes (API route, service role)', () => {
    test.use({ storageState: storageStatePath('selfOwner') })

    test('records who changed what, with the request id of the call', async ({ request }) => {
      const requestId = `e2e-audit-${Date.now()}`
      const newName = uniqueName('Desserts')
      const response = await request.patch(`/api/admin/categories/${DESSERTS_SELF}`, {
        headers: { 'x-request-id': requestId },
        data: { name: newName },
      })
      expect(response.status(), await response.text()).toBe(200)
      expect(response.headers()['x-request-id']).toBe(requestId)

      const [event] = await auditFor({ table: 'categories', record: DESSERTS_SELF, requestId })
      expect(event).toMatchObject({ actor_id: USER_IDS.selfOwner, via: 'server', action: 'update', tenant_id: TENANTS.self.id, request_id: requestId })
      expect(event.changes).toEqual({ name: ['Desserts', newName] })

      await request.patch(`/api/admin/categories/${DESSERTS_SELF}`, { data: { name: 'Desserts' } })
    })
  })

  test('browser writes are attributed through the user token', async () => {
    const owner = await userClient('owner@test-self.local')
    const brownie = product('self', 'brownie').id
    const description = uniqueName('Audit browser write')
    const { error } = await owner.from('products').update({ description }).eq('id', brownie)
    expect(error).toBeNull()

    const [event] = await auditFor({ table: 'products', record: brownie })
    expect(event).toMatchObject({ actor_id: USER_IDS.selfOwner, via: 'browser', action: 'update' })
    expect(event.changes).toMatchObject({ description: ['Warm chocolate brownie', description] })

    await owner.from('products').update({ description: 'Warm chocolate brownie' }).eq('id', brownie)
  })

  test.describe('order status', () => {
    test.use({ storageState: storageStatePath('selfStaff') })

    test('records who moved an order, not every order placed', async ({ request }) => {
      const placed = await request.post('/api/orders', {
        data: {
          tenant_id: TENANTS.self.id,
          customer_name: uniqueName('Audit order'),
          customer_phone: '+5511900000000',
          order_type: 'dine_in',
          table_id: TABLES.selfMesa4.id,
          items: [{ product_id: product('self', 'cola').id, product_name: 'Cola', quantity: 1, unit_price: 5, selected_options: {} }],
        },
      })
      const { id } = await placed.json()
      expect(await auditFor({ table: 'orders', record: id })).toHaveLength(0)

      const moved = await request.patch(`/api/orders/${id}`, { data: { status: 'preparing' } })
      expect(moved.status(), await moved.text()).toBe(200)
      expect((await getOrder(id)).status).toBe('preparing')

      const [event] = await auditFor({ table: 'orders', record: id })
      expect(event).toMatchObject({ actor_id: USER_IDS.selfStaff, action: 'update' })
      expect(event.changes).toMatchObject({ status: ['pending', 'preparing'] })
    })
  })

  test('secrets never reach the trail', async () => {
    await db().from('chat_addon_settings').upsert({ tenant_id: TENANTS.self.id, openrouter_api_key: 'sk-or-should-not-leak' }, { onConflict: 'tenant_id' })
    const { data } = await db()
      .from('audit_events')
      .select('changes')
      .eq('table_name', 'chat_addon_settings')
      .eq('tenant_id', TENANTS.self.id)
      .order('id', { ascending: false })
      .limit(1)
    expect(JSON.stringify(data)).not.toContain('sk-or-should-not-leak')
    expect(JSON.stringify(data)).toContain('[redacted]')
  })

  test('owners read only their restaurant, staff read nothing, nobody edits', async () => {
    const owner = await userClient('owner@test-self.local')
    const { data: ownerRows, error } = await owner.from('audit_events').select('tenant_id').limit(200)
    expect(error).toBeNull()
    expect(ownerRows!.length).toBeGreaterThan(0)
    expect(new Set(ownerRows!.map(r => r.tenant_id))).toEqual(new Set([TENANTS.self.id]))

    const staff = await userClient('staff@test-self.local')
    const { data: staffRows } = await staff.from('audit_events').select('id').limit(5)
    expect(staffRows).toEqual([])

    // No write policies: the delete matches nothing, the history stays.
    const before = await db().from('audit_events').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANTS.self.id)
    await owner.from('audit_events').delete().eq('tenant_id', TENANTS.self.id)
    const after = await db().from('audit_events').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANTS.self.id)
    expect(after.count).toBeGreaterThanOrEqual(before.count ?? 1)
  })
})
