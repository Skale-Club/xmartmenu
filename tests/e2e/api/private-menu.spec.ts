/**
 * A private menu shows nothing of its content to a visitor without a
 * phone-verified session, on every surface (EX-06): the tenant root, the menu
 * page, the JSON API (and so the JSON-LD built from the same data) and direct
 * reads with the public anon key.
 */
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { assertLocalSupabase } from '../fixtures/db'
import { PRIVATE_MENU } from '../fixtures/seed'

function expectNoSecrets(body: string) {
  for (const secret of PRIVATE_MENU.secrets) expect(body).not.toContain(secret)
}

test.describe('private menu without access', () => {
  test('the tenant root renders no private content', async ({ request }) => {
    const response = await request.get(`/${PRIVATE_MENU.slug}`)
    expect(response.status()).toBe(200)
    expectNoSecrets(await response.text())
  })

  test('the menu page renders no private content', async ({ request }) => {
    const response = await request.get(`/${PRIVATE_MENU.slug}/${PRIVATE_MENU.menuSlug}`)
    expect(response.status()).toBe(200)
    expectNoSecrets(await response.text())
  })

  test('the RSC payload of the root carries no private content', async ({ request }) => {
    const response = await request.get(`/${PRIVATE_MENU.slug}`, { headers: { RSC: '1' } })
    expectNoSecrets(await response.text())
  })

  test('the public JSON API returns no private content', async ({ request }) => {
    const response = await request.get(`/api/public/${PRIVATE_MENU.slug}`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.products).toEqual([])
    expect(body.categories).toEqual([])
    expectNoSecrets(JSON.stringify(body))
  })

  test('the anon key cannot read the private catalog directly', async () => {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
    const anon = createClient(assertLocalSupabase(), key, { auth: { persistSession: false, autoRefreshToken: false } })

    const products = await anon.from('products').select('id, name').eq('menu_id', PRIVATE_MENU.menuId)
    expect(products.data ?? []).toEqual([])
    const categories = await anon.from('categories').select('id, name').eq('menu_id', PRIVATE_MENU.menuId)
    expect(categories.data ?? []).toEqual([])
    const groups = await anon.from('product_option_groups').select('id, name').eq('product_id', PRIVATE_MENU.productId)
    expect(groups.data ?? []).toEqual([])
    const options = await anon.from('product_options').select('id, name').eq('tenant_id', PRIVATE_MENU.tenantId)
    expect(options.data ?? []).toEqual([])
  })

  test('a public menu is still readable with the anon key', async () => {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const anon = createClient(assertLocalSupabase(), key, { auth: { persistSession: false, autoRefreshToken: false } })
    const products = await anon.from('products').select('id').eq('tenant_id', 'b0000000-0000-4000-8000-000000000003').limit(1)
    expect((products.data ?? []).length).toBe(1)
  })
})
