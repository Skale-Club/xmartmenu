/**
 * The public menu is served from a short cache (src/lib/menu/public-menu-cache.ts):
 * a change written straight to the database is not seen until the cache is
 * dropped, and dropping it (the admin API does it on its own; scripts use the
 * internal route) shows the change at once.
 */
import { expect, test } from '@playwright/test'
import { db, revalidateMenu, uniqueName } from '../fixtures/db'
import { TENANTS } from '../fixtures/seed'

const tenant = TENANTS.switch

async function menuHtml(request: Parameters<Parameters<typeof test>[2]>[0]['request']) {
  const response = await request.get(`/${tenant.slug}?view=list`)
  expect(response.status()).toBe(200)
  return response.text()
}

test.describe('public menu cache', () => {
  test('a direct database write shows up only after the cache is dropped', async ({ request }) => {
    const { data: category } = await db().from('categories').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('position').limit(1).single()
    expect(category).toBeTruthy()
    const original = category!.name as string
    const renamed = uniqueName('Cached section')

    // Warm the cache with the current name.
    expect(await menuHtml(request)).toContain(original)

    try {
      const { error } = await db().from('categories').update({ name: renamed }).eq('id', category!.id)
      expect(error).toBeNull()

      // Still the cached page: the write went around the app.
      expect(await menuHtml(request)).not.toContain(renamed)

      await revalidateMenu(tenant.slug)
      expect(await menuHtml(request)).toContain(renamed)
    } finally {
      await db().from('categories').update({ name: original }).eq('id', category!.id)
      await revalidateMenu(tenant.slug)
    }
  })

  test('the internal route refuses a wrong secret', async ({ request }) => {
    const response = await request.post('/api/internal/revalidate-menu', {
      headers: { 'x-revalidate-secret': 'wrong' },
      data: { slug: tenant.slug },
    })
    expect(response.status()).toBe(401)
  })
})
