/**
 * Restaurant data written straight through PostgREST with end-user tokens
 * (EX-01). The back office keeps staff read-only on the catalog and settings
 * and sends every order write through the server; the database must agree,
 * or a staff token skips the app and edits prices, settings or orders.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { assertLocalSupabase, db } from '../fixtures/db'
import { PASSWORD, TENANTS, product } from '../fixtures/seed'

function anonClient(): SupabaseClient {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  return createClient(assertLocalSupabase(), key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return client
}

const tenant = TENANTS.self
const burger = product('self', 'burger')
// Price edits that succeed use the menu-only restaurant: it takes no orders,
// so a concurrent orders.spec never sees the temporary price.
const menuBurger = product('menu', 'burger')

async function priceOf(id: string) {
  const { data } = await db().from('products').select('price').eq('id', id).single()
  return Number(data?.price)
}

test.describe.serial('staff tokens are read-only on restaurant data', () => {
  test('staff cannot change a product price', async () => {
    const staff = await signedIn('staff@test-self.local')
    await staff.from('products').update({ price: 0.01 }).eq('id', burger.id)
    expect(await priceOf(burger.id)).toBe(burger.price)
  })

  test('staff cannot change restaurant settings', async () => {
    const staff = await signedIn('staff@test-self.local')
    const { data: before } = await db().from('tenant_settings').select('tagline').eq('tenant_id', tenant.id).single()
    await staff.from('tenant_settings').update({ tagline: 'staff was here' }).eq('tenant_id', tenant.id)
    const { data: after } = await db().from('tenant_settings').select('tagline').eq('tenant_id', tenant.id).single()
    expect(after?.tagline).toBe(before?.tagline)
  })

  test('staff cannot create or rewrite orders directly', async () => {
    const staff = await signedIn('staff@test-self.local')
    const { error: insertError } = await staff.from('orders').insert({
      tenant_id: tenant.id, customer_name: 'Direct', order_type: 'dine_in', total: 0, status: 'pending',
    })
    expect(insertError).not.toBeNull()

    const { data: order } = await db().from('orders').select('id, total').eq('tenant_id', tenant.id).limit(1).maybeSingle()
    if (order) {
      await staff.from('orders').update({ total: 0 }).eq('id', order.id)
      const { data: same } = await db().from('orders').select('total').eq('id', order.id).single()
      expect(Number(same?.total)).toBe(Number(order.total))
    }
  })

  test('staff still reads orders and tables (KDS, waiter app)', async () => {
    const staff = await signedIn('staff@test-self.local')
    const orders = await staff.from('orders').select('id').eq('tenant_id', tenant.id).limit(1)
    expect(orders.error).toBeNull()
    const tables = await staff.from('restaurant_tables').select('id').eq('tenant_id', tenant.id)
    expect(tables.error).toBeNull()
    expect((tables.data ?? []).length).toBeGreaterThan(0)
  })

  test('the store admin still edits the catalog', async () => {
    const owner = await signedIn('owner@test-menu.local')
    try {
      const { error } = await owner.from('products').update({ price: menuBurger.price + 1 }).eq('id', menuBurger.id)
      expect(error).toBeNull()
      expect(await priceOf(menuBurger.id)).toBe(menuBurger.price + 1)
    } finally {
      await db().from('products').update({ price: menuBurger.price }).eq('id', menuBurger.id)
    }
  })

  test('another restaurant admin cannot touch this catalog', async () => {
    const other = await signedIn('owner@test-waiter.local')
    await other.from('products').update({ price: 0.01 }).eq('id', menuBurger.id)
    expect(await priceOf(menuBurger.id)).toBe(menuBurger.price)
  })
})

test.describe('chat tables only take writes from the server', () => {
  test('anonymous insert into chat_conversations is refused', async () => {
    const { error } = await anonClient().from('chat_conversations').insert({ tenant_id: tenant.id })
    expect(error).not.toBeNull()
  })

  test('anonymous insert into chat_messages is refused', async () => {
    const { error } = await anonClient().from('chat_messages').insert({ role: 'user', content: 'spoofed' })
    expect(error).not.toBeNull()
  })
})
