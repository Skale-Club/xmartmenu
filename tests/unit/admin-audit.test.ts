import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { OWNER_AUDIT_TABLES, readOwnerAuditPage, readPlatformAuditPage } from '@/lib/data/admin-audit'

const tenantId = 'e7c86fe0-6491-4fa7-a6d8-55de55bb1427'
const actorId = '1d8f5270-73e3-42ee-95f0-b849c26dbb4d'

describe('owned audit reads', () => {
  it('requires an owner role and never issues SQL for staff', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as Record<string, unknown>[] }))
    await expect(readOwnerAuditPage(query, { tenantId, role: 'store-staff' }, {})).rejects.toBeInstanceOf(AdminMenuError)
    expect(query).not.toHaveBeenCalled()
  })

  it('limits owner rows to their tenant and shows platform names without reading them', async () => {
    const row = { id: '81', actor_id: actorId, actor_name: null, actor_role: null, actor_external: true }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] as Record<string, unknown>[] }))
    const result = await readOwnerAuditPage(query, { tenantId, role: 'store-admin' }, {
      table: 'products', actor: actorId, days: 7, before: '90',
    })

    expect(result).toEqual([row])
    expect(query).toHaveBeenCalledOnce()
    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain('e.tenant_id=$1')
    expect(sql).toContain('e.table_name=ANY($2::text[])')
    expect(sql).toContain('e.table_name=$4')
    expect(sql).toContain('e.actor_id=$5::uuid')
    expect(sql).toContain('e.id < $6::bigint')
    expect(sql).toContain('LEFT JOIN public.profiles p ON p.id=e.actor_id AND p.tenant_id=e.tenant_id')
    expect(sql).toContain('EXISTS(SELECT 1 FROM public.profiles external_profile')
    expect(sql).not.toMatch(/SELECT\s+[^]*p\.full_name,/)
    expect(values?.[0]).toBe(tenantId)
    expect(values?.[1]).toEqual(OWNER_AUDIT_TABLES)
    expect(values?.[3]).toBe('products')
    expect(values?.[4]).toBe(actorId)
    expect(values?.[5]).toBe('90')
    expect(values?.[6]).toBe(50)
  })

  it('ignores malformed owner filters and caps pagination to the default window', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as Record<string, unknown>[] }))
    await readOwnerAuditPage(query, { tenantId, role: 'superadmin' }, { table: 'platform_settings', actor: 'bad', days: 365, before: '9223372036854775808' })
    const [sql, values] = query.mock.calls[0]!
    expect(sql).not.toContain('e.actor_id=')
    expect(sql).not.toContain('e.id <')
    expect(sql).not.toContain('e.table_name=$')
    expect(values?.[1]).toEqual(OWNER_AUDIT_TABLES)
    expect(values?.[values.length - 1]).toBe(50)
    expect(new Date(values?.[2] as Date).getTime()).toBeGreaterThan(Date.now() - 30 * 86_400_000 - 1000)
  })

  it('requires the platform role and applies bounded platform filters', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('FROM public.audit_events')) return { rows: [{ id: '10', tenant_id: tenantId, actor_id: actorId }] as Record<string, unknown>[] }
      if (sql.includes('FROM public.tenants')) return { rows: [{ id: tenantId, name: 'Restaurant', slug: 'restaurant' }] as Record<string, unknown>[] }
      return { rows: [{ id: actorId, full_name: 'Admin', role: 'superadmin' }] as Record<string, unknown>[] }
    })
    await expect(readPlatformAuditPage(query, { role: 'store-admin' }, {})).rejects.toBeInstanceOf(AdminMenuError)
    expect(query).not.toHaveBeenCalled()

    const result = await readPlatformAuditPage(query, { role: 'superadmin' }, {
      tenant: tenantId, table: 'products', actor: actorId, request: 'r'.repeat(140), days: 90, before: '12',
    })
    expect(result.rows[0]?.id).toBe('10')
    expect(result.tenants).toHaveLength(1)
    expect(result.people).toHaveLength(1)
    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain('e.tenant_id=$2::uuid')
    expect(sql).toContain('e.table_name=$3')
    expect(sql).toContain('e.actor_id=$4::uuid')
    expect(sql).toContain('e.request_id=$5')
    expect(sql).toContain('e.id < $6::bigint')
    expect(values?.[4]).toBe('r'.repeat(128))
    expect(values?.[values.length - 1]).toBe(100)
  })
})
