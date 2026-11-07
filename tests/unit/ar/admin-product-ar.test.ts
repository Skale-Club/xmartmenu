import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { arModelPatch, mutateArModel } from '@/lib/data/admin-product-ar'
import { detailOperation } from '@/lib/data/admin-product-detail'
import type { AdminMenuContext, AdminMenuQuery } from '@/lib/data/admin-menus'

const tenantId = randomUUID(), productId = randomUUID()
const context: AdminMenuContext = { tenantId, role: 'store-admin' }
const glb = { glb_url: 'https://cdn.example/a.glb', glb_storage_path: `${tenantId}/ar/1-a.glb`, glb_bytes: 1024 }

/** A fake owned database: one optional row, and whether the table exists. */
function database({ present = true, row = null as Record<string, unknown> | null } = {}) {
  const calls: Array<{ text: string; values: unknown[] }> = []
  let stored = row
  const query = (async (text: string, values: unknown[] = []) => {
    calls.push({ text, values })
    if (text.includes('to_regclass')) return { rows: [{ present }] }
    if (text.startsWith('SELECT to_jsonb')) return { rows: stored ? [{ row: stored }] : [] }
    if (text.startsWith('INSERT')) { stored = { id: randomUUID(), tenant_id: values[0], product_id: values[1], real_scale: true }; return { rows: [] } }
    if (text.startsWith('UPDATE')) { stored = { ...stored, patched: true }; return { rows: [] } }
    if (text.startsWith('DELETE')) { stored = null; return { rows: [] } }
    throw new Error(`Unexpected SQL: ${text}`)
  }) as unknown as AdminMenuQuery
  return { query, calls }
}

describe('arModelPatch', () => {
  it('accepts the uploaded GLB fields and real_scale', () => {
    expect(arModelPatch({ ...glb, real_scale: false }, context)).toEqual({ ...glb, real_scale: false })
  })

  it('clears the iOS file with nulls', () => {
    expect(arModelPatch({ usdz_url: null, usdz_storage_path: null, usdz_bytes: null }, context))
      .toEqual({ usdz_url: null, usdz_storage_path: null, usdz_bytes: null })
  })

  it('refuses unknown fields, bad URLs, foreign or traversing paths and bad sizes', () => {
    expect(() => arModelPatch({ tenant_id: randomUUID() }, context)).toThrow()
    expect(() => arModelPatch({}, context)).toThrow()
    expect(() => arModelPatch({ glb_url: 'javascript:alert(1)' }, context)).toThrow(/URL/)
    expect(() => arModelPatch({ glb_url: null }, context)).toThrow(/URL/)
    expect(() => arModelPatch({ glb_storage_path: `${randomUUID()}/ar/x.glb` }, context)).toThrow(/path/)
    expect(() => arModelPatch({ glb_storage_path: `${tenantId}/ar/../../x.glb` }, context)).toThrow(/path/)
    expect(() => arModelPatch({ glb_bytes: 0 }, context)).toThrow(/size/)
    expect(() => arModelPatch({ real_scale: 'yes' }, context)).toThrow()
  })
})

describe('mutateArModel', () => {
  it('lists null while the table does not exist, and refuses writes', async () => {
    const { query } = database({ present: false })
    expect(await mutateArModel(query, context, productId, 'list', undefined)).toBeNull()
    await expect(mutateArModel(query, context, productId, 'patch', glb)).rejects.toThrow(/not enabled/)
  })

  it('creates the row for this tenant and dish only with a GLB', async () => {
    const { query, calls } = database()
    await expect(mutateArModel(query, context, productId, 'patch', { real_scale: false })).rejects.toThrow(/.glb/)
    const created = await mutateArModel(query, context, productId, 'patch', glb)
    expect(created).toMatchObject({ tenant_id: tenantId, product_id: productId })
    const insert = calls.find(call => call.text.startsWith('INSERT'))
    expect(insert?.values.slice(0, 2)).toEqual([tenantId, productId])
  })

  it('updates and deletes scoped to tenant and dish', async () => {
    const { query, calls } = database({ row: { id: randomUUID(), tenant_id: tenantId, product_id: productId } })
    expect(await mutateArModel(query, context, productId, 'patch', { real_scale: false })).toMatchObject({ patched: true })
    expect(await mutateArModel(query, context, productId, 'delete', undefined)).toBeNull()
    for (const call of calls.filter(item => /^(UPDATE|DELETE)/.test(item.text))) {
      expect(call.text).toContain('tenant_id=$1 AND product_id=$2')
      expect(call.values.slice(0, 2)).toEqual([tenantId, productId])
    }
  })
})

describe('detailOperation for 3D models', () => {
  it('allows list, patch and delete only', () => {
    expect(detailOperation({ entity: 'ar', action: 'list' }).entity).toBe('ar')
    expect(detailOperation({ entity: 'ar', action: 'patch', values: glb }).action).toBe('patch')
    expect(detailOperation({ entity: 'ar', action: 'delete' }).action).toBe('delete')
    expect(() => detailOperation({ entity: 'ar', action: 'create' })).toThrow()
    expect(() => detailOperation({ entity: 'ar', action: 'reorder' })).toThrow()
  })
})
