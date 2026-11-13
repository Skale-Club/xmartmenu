import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mutateAdminProduct } from '@/lib/data/admin-products'
import type { AdminMenuQuery } from '@/lib/data/admin-menus'

describe('owned feed photo persistence', () => {
  it('parameterizes the dedicated field, returns it, and preserves it when ordinary fields are edited', async () => {
    const tenantId = randomUUID(), id = randomUUID()
    const row = { id, tenant_id: tenantId, menu_id: randomUUID(), image_url: 'https://cdn.example/main.webp', image_urls: ['https://cdn.example/main.webp'], feed_image_url: null as string | null, name: 'Dish' }
    const updates: Array<{ sql: string; values: unknown[] }> = []
    const query: AdminMenuQuery = async (sql, values = []) => {
      if (sql.startsWith('SELECT pg_advisory')) return { rows: [] }
      if (sql.startsWith('UPDATE public.products SET ')) {
        updates.push({ sql, values })
        if (sql.includes('feed_image_url=$3')) row.feed_image_url = values[2] as string | null
        if (sql.includes('name=$3')) row.name = values[2] as string
        return { rows: [] }
      }
      expect(sql).toContain('p.feed_image_url')
      expect(values).toEqual([tenantId, id])
      return { rows: [{ row: { ...row } }] }
    }
    const context = { tenantId, role: 'store-admin' as const }
    const url = 'https://cdn.example/portrait.webp'
    const saved = await mutateAdminProduct(query, context, { kind: 'patch', id, body: { feed_image_url: url } })
    expect(saved).toMatchObject({ feed_image_url: url, image_url: row.image_url, image_urls: row.image_urls })
    expect(updates[0].sql).toContain('WHERE tenant_id=$1 AND id=$2')
    expect(updates[0].sql).not.toContain(url)
    expect(updates[0].values).toEqual([tenantId, id, url])
    expect(await mutateAdminProduct(query, context, { kind: 'patch', id, body: { name: 'Renamed' } })).toMatchObject({ name: 'Renamed', feed_image_url: url })
    expect(updates[1].sql).not.toContain('feed_image_url=')
    expect(await mutateAdminProduct(query, context, { kind: 'patch', id, body: { feed_image_url: null } })).toMatchObject({ feed_image_url: null, image_url: row.image_url })
  })
})
