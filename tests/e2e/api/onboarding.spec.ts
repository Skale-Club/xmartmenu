/**
 * Onboarding converges (EX-08): concurrent or repeated submissions for one
 * account create one restaurant with its settings, plan, menu, category and
 * product, and a later call repairs anything missing instead of reporting a
 * half-built restaurant as configured.
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { db } from '../fixtures/db'

const input = (suffix: string) => ({
  company_name: `Onboarding ${suffix}`,
  tenant_slug: `onboarding-${suffix}`,
  full_name: 'Owner',
  phone: null,
  address: null,
  primary_color: '#F52323',
  accent_color: '#09090b',
  menu_name: 'Main',
  menu_slug: 'main',
  menu_purpose: 'restaurant',
  category_name: 'Starters',
  product_name: 'Bread',
  product_price: 5,
})

test('concurrent and repeated onboarding make one complete restaurant', async () => {
  const suffix = randomUUID().slice(0, 8)
  const { data: created, error } = await db().auth.admin.createUser({ email: `onboarding-${suffix}@test.local`, password: randomUUID(), email_confirm: true })
  expect(error).toBeNull()
  const userId = created.user!.id
  let tenantId: string | undefined
  try {
    const calls = await Promise.all([1, 2, 3].map(() => db().rpc('complete_onboarding', { p_user_id: userId, p_input: input(suffix) })))
    for (const c of calls) expect(c.error).toBeNull()
    const ids = new Set(calls.map((c) => (c.data as { tenant_id: string }).tenant_id))
    expect(ids.size).toBe(1)
    tenantId = [...ids][0]
    expect(calls.filter((c) => (c.data as { created_tenant: boolean }).created_tenant)).toHaveLength(1)

    const { count: tenants } = await db().from('tenants').select('id', { count: 'exact', head: true }).eq('name', `Onboarding ${suffix}`)
    expect(tenants).toBe(1)
    const { data: profile } = await db().from('profiles').select('tenant_id, role').eq('id', userId).single()
    expect(profile).toMatchObject({ tenant_id: tenantId, role: 'store-admin' })
    const { count: subs } = await db().from('tenant_subscriptions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    expect(subs).toBe(1)
    const { count: menus } = await db().from('menus').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    expect(menus).toBe(1)

    // A half-built restaurant (lost its first product) is repaired on resume.
    await db().from('products').delete().eq('tenant_id', tenantId)
    const again = await db().rpc('complete_onboarding', { p_user_id: userId, p_input: input(suffix) })
    expect(again.error).toBeNull()
    expect((again.data as { created_tenant: boolean }).created_tenant).toBe(false)
    const { count: products } = await db().from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    expect(products).toBe(1)
  } finally {
    if (tenantId) await db().from('tenants').delete().eq('id', tenantId)
    await db().auth.admin.deleteUser(userId)
  }
})

test('a taken restaurant slug gets a suffix instead of failing', async () => {
  const suffix = randomUUID().slice(0, 8)
  const users: string[] = []
  const tenants: string[] = []
  try {
    for (let i = 0; i < 2; i++) {
      const { data } = await db().auth.admin.createUser({ email: `slug-${suffix}-${i}@test.local`, password: randomUUID(), email_confirm: true })
      users.push(data.user!.id)
      const r = await db().rpc('complete_onboarding', { p_user_id: data.user!.id, p_input: input(suffix) })
      expect(r.error).toBeNull()
      tenants.push((r.data as { tenant_id: string }).tenant_id)
    }
    const { data: rows } = await db().from('tenants').select('slug').in('id', tenants)
    expect(new Set((rows ?? []).map((r) => r.slug)).size).toBe(2)
  } finally {
    if (tenants.length) await db().from('tenants').delete().in('id', tenants)
    for (const id of users) await db().auth.admin.deleteUser(id)
  }
})
