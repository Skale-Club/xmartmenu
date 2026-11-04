import { resolveServiceCapabilities, parseTableParam } from '../service-modes'
import { canCallWaiter, CALL_STALE_MS, parseCallReason } from '../waiter-calls'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

function unique(rows: Record<string, unknown>[]) {
  if (rows.length > 1) throw new AdminMenuError(503, 'Service information is unavailable')
  return rows[0]
}

/** Public guest creation only: no staff identity/acknowledgment or Auth writes. */
export async function createPublicWaiterCall(query: AdminMenuQuery, slug: string, tableId: string, inputReason: unknown, now = new Date()) {
  const parsedTable = parseTableParam(tableId)
  if (!parsedTable) throw new AdminMenuError(400, 'Unknown table')
  if (!Number.isFinite(now.getTime())) throw new AdminMenuError(503, 'Service information is unavailable')
  const reason = parseCallReason(inputReason)
  const tenant = unique((await query(`SELECT id FROM public.tenants WHERE slug=$1 AND is_active=true LIMIT 2 FOR SHARE`, [slug])).rows)
  if (!tenant) throw new AdminMenuError(404, 'Restaurant not found')
  const tenantId = tenant.id
  const settings = unique((await query(`SELECT orders_enabled,direct_orders_enabled,table_management_enabled
    FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2 FOR SHARE`, [tenantId])).rows)
  const subscription = unique((await query(`SELECT s.status,p.features FROM public.tenant_subscriptions s
    JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2 FOR SHARE OF s,p`, [tenantId])).rows)
  let features: string[] = []
  if (subscription && ['active', 'trial'].includes(String(subscription.status))) {
    if (!Array.isArray(subscription.features) || subscription.features.some(value => typeof value !== 'string')) throw new AdminMenuError(503, 'Service information is unavailable')
    features = subscription.features
  }
  const switches = settings ? { orders_enabled: settings.orders_enabled === true, direct_orders_enabled: settings.direct_orders_enabled === true, table_management_enabled: settings.table_management_enabled === true } : null
  if (!canCallWaiter(resolveServiceCapabilities(features, switches))) throw new AdminMenuError(403, 'This restaurant does not take calls from the table')
  // The stable parent row serializes first-use/repeats without adding an index.
  const table = unique((await query(`SELECT id,name FROM public.restaurant_tables
    WHERE id=$1 AND tenant_id=$2 AND is_active=true LIMIT 2 FOR UPDATE`, [parsedTable, tenantId])).rows)
  if (!table) throw new AdminMenuError(400, 'Unknown table')
  const cutoff = new Date(now.getTime() - CALL_STALE_MS).toISOString()
  const open = unique((await query(`SELECT id FROM public.waiter_calls
    WHERE tenant_id=$1 AND table_id=$2 AND reason=$3 AND status<>'done' AND created_at>=$4
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tenantId, table.id, reason, cutoff])).rows)
  if (open) {
    const updated = await query(`UPDATE public.waiter_calls SET status='open',acknowledged_at=NULL,acknowledged_by=NULL,last_called_at=$4
      WHERE id=$1 AND tenant_id=$2 AND table_id=$3 RETURNING id`, [open.id, tenantId, table.id, now.toISOString()])
    if (updated.rows.length !== 1) throw new AdminMenuError(503, 'Could not call the waiter')
    return { status: 200, body: { id: updated.rows[0].id, repeated: true } }
  }
  const inserted = await query(`INSERT INTO public.waiter_calls(tenant_id,table_id,table_name,reason)
    VALUES($1,$2,$3,$4) RETURNING id`, [tenantId, table.id, table.name, reason])
  if (inserted.rows.length !== 1) throw new AdminMenuError(503, 'Could not call the waiter')
  return { status: 201, body: { id: inserted.rows[0].id, repeated: false } }
}
