import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Each accepted visit remains a distinct scan; the database supplies time/ID. */
export async function recordPublicScan(query: AdminMenuQuery, tenantId: unknown) {
  if (typeof tenantId !== 'string' || !tenantId) throw new AdminMenuError(400, 'Invalid scan')
  // A malformed UUID cannot identify a real tenant, matching the source lookup.
  if (!UUID.test(tenantId)) throw new AdminMenuError(404, 'Tenant not found')
  const result = await query(`INSERT INTO public.scan_events(tenant_id)
    SELECT id FROM public.tenants WHERE id=$1 AND is_active=true RETURNING id`, [tenantId])
  if (result.rows.length !== 1) throw new AdminMenuError(404, 'Tenant not found')
  return { ok: true }
}
