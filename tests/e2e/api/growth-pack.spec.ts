/**
 * Plans on new restaurants, calling a waiter from the table, the owner's
 * activity screen, sales attributed to "Complete your order", screen time,
 * and dish videos — against the real app and the local database.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { db, uniqueName } from '../fixtures/db'
import { TABLES, TENANTS, product, storageStatePath, type UserKey } from '../fixtures/seed'

const ORDERS_PLAN = '22222222-2222-2222-2222-222222222222'
const PAYMENTS_PLAN = '33333333-3333-3333-3333-333333333333'

const as = (user: UserKey, baseURL: string | undefined) => request.newContext({ baseURL, storageState: storageStatePath(user) })

test.describe('plans on restaurants', () => {
  let superadmin: APIRequestContext
  let createdTenant: string | null = null
  let createdUser: string | null = null

  test.beforeAll(async ({}, testInfo) => { superadmin = await as('superadmin', testInfo.project.use.baseURL) })
  test.afterAll(async () => {
    if (createdTenant) await db().from('tenants').delete().eq('id', createdTenant)
    if (createdUser) await db().auth.admin.deleteUser(createdUser)
    await superadmin?.dispose()
  })

  test('a new restaurant gets its plan, and tenants.plan follows plan changes', async () => {
    const slug = `e2e-${Date.now().toString(36)}`
    const email = `${slug}@test.local`
    const response = await superadmin.post('/api/superadmin/tenants', { data: { name: uniqueName('Plan test'), slug, email, plan_id: ORDERS_PLAN } })
    expect(response.status(), await response.text()).toBeLessThan(300)
    const { data: tenant } = await db().from('tenants').select('id, plan').eq('slug', slug).single()
    createdTenant = tenant!.id
    const { data: users } = await db().auth.admin.listUsers({ perPage: 200 })
    createdUser = users.users.find(u => u.email === email)?.id ?? null
    expect(tenant!.plan).toBe('orders')

    const change = await superadmin.put(`/api/superadmin/tenants/${tenant!.id}/subscription`, { data: { plan_id: PAYMENTS_PLAN } })
    expect(change.status(), await change.text()).toBe(200)
    const { data: after } = await db().from('tenants').select('plan').eq('id', tenant!.id).single()
    expect(after!.plan).toBe('payments')
  })
})

test.describe('call the waiter from the table', () => {
  test.describe.configure({ mode: 'serial' })
  let staff: APIRequestContext

  test.beforeAll(async ({}, testInfo) => {
    staff = await as('waiterStaff', testInfo.project.use.baseURL)
    await db().from('waiter_calls').delete().eq('tenant_id', TENANTS.waiter.id)
  })
  test.afterAll(async () => {
    await db().from('waiter_calls').delete().eq('tenant_id', TENANTS.waiter.id)
    await staff?.dispose()
  })

  test('guest calls, a repeat reuses the call, staff see it live and close it', async ({ request: guest }) => {
    const first = await guest.post(`/api/public/waiter-call/${TENANTS.waiter.slug}`, { data: { table_id: TABLES.waiterMesa1.id, reason: 'bill' } })
    expect(first.status(), await first.text()).toBe(201)
    const { id } = await first.json()

    const again = await guest.post(`/api/public/waiter-call/${TENANTS.waiter.slug}`, { data: { table_id: TABLES.waiterMesa1.id, reason: 'bill' } })
    expect(await again.json()).toEqual({ id, repeated: true })

    const list = await (await staff.get('/api/admin/waiter-calls')).json()
    expect(list.calls).toEqual([expect.objectContaining({ id, table_name: 'Mesa 1', reason: 'bill', status: 'open' })])

    const done = await staff.patch(`/api/admin/waiter-calls/${id}`, { data: { status: 'done' } })
    expect((await done.json()).call.status).toBe('done')
    expect((await (await staff.get('/api/admin/waiter-calls')).json()).calls).toEqual([])
  })

  test('refused without table service, for unknown or inactive tables', async ({ request: guest }) => {
    const menuOnly = await guest.post(`/api/public/waiter-call/${TENANTS.menu.slug}`, { data: { table_id: TABLES.waiterMesa1.id } })
    expect(menuOnly.status()).toBe(403)
    const otherRestaurant = await guest.post(`/api/public/waiter-call/${TENANTS.self.slug}`, { data: { table_id: TABLES.waiterMesa1.id } })
    expect(otherRestaurant.status()).toBe(400)
    const inactive = await guest.post(`/api/public/waiter-call/${TENANTS.self.slug}`, { data: { table_id: TABLES.selfInactive.id } })
    expect(inactive.status()).toBe(400)
  })

  test('the menu shows the buttons on a table link', async ({ request: guest }) => {
    const html = await (await guest.get(`/${TENANTS.waiter.slug}?table=${TABLES.waiterMesa1.id}`)).text()
    expect(html).toContain('Call waiter')
    expect(html).toContain('Ask for the bill')
  })
})

test.describe('owner activity screen', () => {
  test('owner sees the trail, staff are sent away', async ({}, testInfo) => {
    const owner = await as('selfOwner', testInfo.project.use.baseURL)
    const ownerPage = await owner.get('/settings/activity')
    expect(ownerPage.status()).toBe(200)
    expect(await ownerPage.text()).toContain('Who changed what in your restaurant')
    const staff = await as('selfStaff', testInfo.project.use.baseURL)
    const staffPage = await staff.get('/settings/activity')
    expect(staffPage.url()).not.toContain('/settings/activity')
    await Promise.all([owner.dispose(), staff.dispose()])
  })
})

test.describe('sales from "Complete your order"', () => {
  test('lines added from the suggestion are attributed in real revenue', async ({ request: guest }) => {
    const since = new Date(Date.now() - 60_000).toISOString()
    const burger = product('self', 'burger')
    const cola = product('self', 'cola')
    const response = await guest.post('/api/orders', {
      data: {
        tenant_id: TENANTS.self.id,
        customer_name: uniqueName('Upsell'),
        customer_phone: '+5511900000001',
        order_type: 'dine_in',
        items: [
          { product_id: burger.id, product_name: burger.name, quantity: 1, unit_price: burger.price, selected_options: {} },
          { product_id: cola.id, product_name: cola.name, quantity: 2, unit_price: cola.price, selected_options: {}, added_via: 'upsell' },
          { product_id: cola.id, product_name: cola.name, quantity: 1, unit_price: cola.price, selected_options: {}, added_via: 'forged' },
        ],
      },
    })
    expect(response.status(), await response.text()).toBe(200)
    const { id } = await response.json()
    const { data: lines } = await db().from('order_items').select('product_id, quantity, added_via').eq('order_id', id).order('quantity')
    expect(lines!.map(l => l.added_via).sort()).toEqual(['upsell', null, null].sort())

    const { data: attribution } = await db().rpc('get_order_attribution', { p_tenant_id: TENANTS.self.id, p_started_at: since, p_ended_at: new Date(Date.now() + 60_000).toISOString() })
    expect(Number(attribution.upsell.revenue)).toBeGreaterThanOrEqual(cola.price * 2)
    expect(Number(attribution.upsell.orders)).toBeGreaterThanOrEqual(1)
  })
})

test.describe('screen time', () => {
  test('engagement and the platform overview answer with their shape', async () => {
    const range = { p_started_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_ended_at: new Date().toISOString() }
    const { data: engagement, error } = await db().rpc('get_menu_engagement', { p_tenant_id: TENANTS.self.id, ...range, p_time_zone: 'America/Sao_Paulo' })
    expect(error).toBeNull()
    expect(engagement.by_hour).toHaveLength(24)
    expect(engagement.by_weekday).toHaveLength(7)
    expect(engagement.duration.map((d: { key: string }) => d.key)).toEqual(['<30s', '30s–2m', '2–5m', '5–15m', '15m+'])

    const { data: overview } = await db().rpc('get_platform_menu_overview', range)
    expect(overview.map((r: { slug: string }) => r.slug)).toEqual(expect.arrayContaining([TENANTS.self.slug, TENANTS.waiter.slug]))
  })
})

test.describe('dish videos', () => {
  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0
  test.skip(!ffmpeg, 'ffmpeg is not installed on this machine')

  test('an upload comes back as a small 720p MP4 with a poster', async ({}, testInfo) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-video-'))
    const source = join(dir, 'clip.mp4')
    const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=duration=3', '-shortest', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', source])
    expect(made.status, String(made.stderr)).toBe(0)

    const owner = await as('selfOwner', testInfo.project.use.baseURL)
    const response = await owner.post('/api/admin/products/upload-video', {
      multipart: { file: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(source) } },
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ transcoded: true })
    expect(body.url).toMatch(/\.mp4/)
    expect(body.poster_url).toMatch(/\.webp/)
    expect(body.bytes).toBeLessThan(body.original_bytes)

    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,height', '-of', 'csv=p=0', body.url])
    if (probe.status === 0) {
      const streams = String(probe.stdout).trim().split('\n')
      expect(streams).toEqual(['video,720'])
    }
    await owner.dispose()
  })
})
