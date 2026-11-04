import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { createAdminQrCode, deleteAdminQrCode, mutateAdminRestaurantTable, readAdminQrCodes, readAdminRestaurantTables } from '@/lib/data/admin-store-operations'

const tenantId = randomUUID()
const tableA = randomUUID(), tableB = randomUUID(), qrId = randomUUID()
const owner = { tenantId, role: 'store-admin' as const }
const staff = { tenantId, role: 'store-staff' as const }

describe('owned QR and restaurant table repositories', () => {
  it('reads explicit tenant-scoped QR and table projections', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => sql.includes('qr_codes')
      ? { rows: [{ id: qrId, tenant_id: tenantId, target_url: 'https://menu.test/shop', label: 'Front', scans: 0, created_at: '2026-01-01' }] }
      : { rows: [{ id: tableA, tenant_id: tenantId, name: 'Table 1', position: 0, is_active: true }] })
    await expect(readAdminQrCodes(query, owner)).resolves.toMatchObject([{ id: qrId, tenant_id: tenantId }])
    await expect(readAdminRestaurantTables(query, staff)).resolves.toMatchObject([{ id: tableA, tenant_id: tenantId }])
    expect(query.mock.calls.every(([, values]) => values?.[0] === tenantId)).toBe(true)
    expect(query.mock.calls.every(([sql]) => !sql.includes('SELECT *'))).toBe(true)
  })

  it('keeps QR writes manager-only, tenant-bound, and scan-event deletion semantics intact', async () => {
    const insert = vi.fn(async (sql: string, values?: unknown[]) => {
      void values
      return sql.includes('INSERT INTO public.qr_codes') ? { rows: [{ id: qrId, tenant_id: tenantId, label: 'Front', target_url: 'https://menu.test/shop', scans: 0 }] } : { rows: [{ id: qrId }] }
    })
    await expect(createAdminQrCode(insert, owner, 'Front', 'https://menu.test/shop')).resolves.toMatchObject({ tenant_id: tenantId })
    expect(insert.mock.calls[0]?.[0]).toContain('INSERT INTO public.qr_codes (tenant_id,label,target_url)')
    await expect(deleteAdminQrCode(insert, staff, qrId)).rejects.toMatchObject({ status: 403 })
    expect(insert.mock.calls).toHaveLength(1)
    await expect(deleteAdminQrCode(insert, owner, qrId)).resolves.toEqual({ ok: true })
    expect(insert.mock.calls[1]?.[0]).toContain('WHERE tenant_id=$1 AND id=$2 RETURNING id')
  })

  it('derives table positions server-side and atomically swaps only two tenant-owned rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('coalesce(max(position)')) return { rows: [{ position: 3 }] }
      if (sql.includes('INSERT INTO public.restaurant_tables')) return { rows: [{ id: randomUUID(), tenant_id: tenantId, name: 'Table 4', position: 3 }] }
      if (sql.includes('SELECT id,position')) return { rows: [{ id: tableA, position: 0 }, { id: tableB, position: 1 }] }
      if (sql.includes('ORDER BY position,id LIMIT')) return { rows: [{ id: tableB, position: 0 }, { id: tableA, position: 1 }] }
      return { rows: [] }
    })
    await expect(mutateAdminRestaurantTable(query, staff, { kind: 'create', name: ' Table 4 ' })).resolves.toMatchObject({ name: 'Table 4', position: 3 })
    expect(query.mock.calls[2]?.[0]).toContain('INSERT INTO public.restaurant_tables (tenant_id,name,position)')
    const ordered = await mutateAdminRestaurantTable(query, owner, { kind: 'reorder', firstId: tableA, secondId: tableB })
    expect(ordered).toMatchObject([{ id: tableB, position: 0 }, { id: tableA, position: 1 }])
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('CASE id WHEN $2 THEN $4::integer WHEN $3 THEN $5::integer'))).toBe(true)
  })

  it('refuses missing reorder pairs and scopes table deletion to the current tenant', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('SELECT id,position') ? { rows: [{ id: tableA, position: 0 }] } : { rows: [] })
    await expect(mutateAdminRestaurantTable(query, owner, { kind: 'reorder', firstId: tableA, secondId: tableB })).rejects.toMatchObject({ status: 404 })
    await expect(mutateAdminRestaurantTable(query, owner, { kind: 'delete', id: randomUUID() })).rejects.toMatchObject({ status: 404 })
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE public.restaurant_tables'))).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM public.restaurant_tables WHERE tenant_id=$1 AND id=$2'))).toBe(true)
    await expect(readAdminQrCodes(query, { tenantId: 'invalid', role: 'store-admin' })).rejects.toBeInstanceOf(AdminMenuError)
  })
})
