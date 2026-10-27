/**
 * Database privileges as seen by real end-user tokens (EX-01).
 *
 * The app's own routes use the service role, so they cannot prove what a
 * signed-in account or an anonymous visitor can do straight through
 * PostgREST with the public anon key. These tests sign in as seed users and
 * talk to Supabase directly, the way an attacker would.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { assertLocalSupabase, db } from '../fixtures/db'
import { PASSWORD, TENANTS, USER_IDS } from '../fixtures/seed'

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

const staff = { email: 'staff@test-self.local', id: USER_IDS.selfStaff, tenant: TENANTS.self.id }

async function staffProfile() {
  const { data, error } = await db().from('profiles').select('role, tenant_id, full_name').eq('id', staff.id).single()
  if (error) throw error
  return data as { role: string; tenant_id: string; full_name: string | null }
}

test.describe.serial('profiles: an account cannot change its own privileges', () => {
  let original: Awaited<ReturnType<typeof staffProfile>>

  test.beforeAll(async () => {
    original = await staffProfile()
  })

  test.afterAll(async () => {
    // Put the seed row back whatever happened above.
    await db().from('profiles').update(original).eq('id', staff.id)
  })

  test('self-promotion to superadmin is refused', async () => {
    const client = await signedIn(staff.email)
    const { error } = await client.from('profiles').update({ role: 'superadmin' }).eq('id', staff.id)
    expect(error).not.toBeNull()

    expect((await staffProfile()).role).toBe(original.role)
    const { data: isSuper } = await client.rpc('is_superadmin')
    expect(isSuper).toBe(false)
  })

  test('moving to another restaurant is refused', async () => {
    const client = await signedIn(staff.email)
    const { error } = await client.from('profiles').update({ tenant_id: TENANTS.waiter.id }).eq('id', staff.id)
    expect(error).not.toBeNull()
    expect((await staffProfile()).tenant_id).toBe(staff.tenant)
  })

  test('personal fields stay editable', async () => {
    const client = await signedIn(staff.email)
    const name = `Staff ${Date.now()}`
    const { error } = await client.from('profiles').update({ full_name: name }).eq('id', staff.id)
    expect(error).toBeNull()
    expect((await staffProfile()).full_name).toBe(name)
  })

  test('another account row cannot be edited', async () => {
    const client = await signedIn(staff.email)
    await client.from('profiles').update({ full_name: 'hijacked' }).eq('id', USER_IDS.selfOwner)
    const { data } = await db().from('profiles').select('full_name').eq('id', USER_IDS.selfOwner).single()
    expect(data?.full_name).not.toBe('hijacked')
  })

  test('the server (service role) still manages roles', async () => {
    const { error } = await db().from('profiles').update({ role: original.role, tenant_id: original.tenant_id }).eq('id', staff.id)
    expect(error).toBeNull()
  })
})

test.describe('analytics RPCs are server-only', () => {
  const args = {
    p_tenant_id: TENANTS.waiter.id,
    p_started_at: '2000-01-01T00:00:00Z',
    p_ended_at: '2100-01-01T00:00:00Z',
  }

  for (const fn of ['get_menu_analytics_overview', 'get_menu_product_analytics', 'get_menu_upsell_analytics']) {
    test(`${fn}: anonymous call is refused`, async () => {
      const { error } = await anonClient().rpc(fn, args)
      expect(error).not.toBeNull()
    })

    test(`${fn}: another restaurant's staff is refused`, async () => {
      const client = await signedIn(staff.email)
      const { error } = await client.rpc(fn, args)
      expect(error).not.toBeNull()
    })

    test(`${fn}: the service role still reads it`, async () => {
      const { error } = await db().rpc(fn, args)
      expect(error).toBeNull()
    })
  }
})
