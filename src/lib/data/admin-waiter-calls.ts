import type { UserRole } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { normalizeRole } from '../auth/role-utils'
import { resolveTenantCapabilities } from '../service-modes'
import { activeCalls, CALL_STALE_MS, parseCallStatus, type WaiterCall } from '../waiter-calls'

export const adminWaiterCallsOwned = (env: Record<string,string | undefined> = process.env) => env.OWNED_ADMIN_WAITER_CALLS_ENABLED === 'true'
export type AdminWaiterContext = { tenantId: string; actorId: string; role: UserRole }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COLUMNS = 'id,table_id,table_name,reason,status,created_at,last_called_at,acknowledged_at'

function one(rows: Record<string,unknown>[]) {
  if (rows.length > 1) throw new AdminMenuError(503,'Service information is unavailable')
  return rows[0]
}
async function authorize(query: AdminMenuQuery, context: AdminWaiterContext, write: boolean) {
  if (!UUID.test(context.tenantId) || !UUID.test(context.actorId) || !['superadmin','store-admin','store-staff'].includes(context.role)) throw new AdminMenuError(403,'Forbidden')
  const actor = one((await query(`SELECT p.role,p.tenant_id,p.must_change_password,a.disabled_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1${write ? ' FOR SHARE OF p,a' : ''}`,[context.actorId])).rows)
  if (!actor || actor.disabled_at || actor.must_change_password || normalizeRole(actor.role) !== context.role
    || (context.role !== 'superadmin' && actor.tenant_id !== context.tenantId)) throw new AdminMenuError(403,'Forbidden')
  const settings = one((await query(`SELECT orders_enabled,direct_orders_enabled,table_management_enabled
    FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2${write ? ' FOR SHARE' : ''}`,[context.tenantId])).rows)
  const subscription = one((await query(`SELECT s.status,p.features FROM public.tenant_subscriptions s
    JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2${write ? ' FOR SHARE OF s,p' : ''}`,[context.tenantId])).rows)
  let features: string[] = []
  if (subscription && ['active','trial'].includes(String(subscription.status)) && subscription.features != null) {
    if (!Array.isArray(subscription.features) || subscription.features.some(feature => typeof feature !== 'string')) throw new AdminMenuError(503,'Service information is unavailable')
    features = subscription.features
  }
  const switches = settings ? { orders_enabled: settings.orders_enabled === true,
    direct_orders_enabled: settings.direct_orders_enabled === true,table_management_enabled: settings.table_management_enabled === true } : null
  const capabilities = resolveTenantCapabilities(features,switches)
  // Preserve the existing staff gate: an Orders/Payments plan may finish calls
  // even after the restaurant switches guest/waiter ordering off.
  if (!capabilities.waiterCalls && !capabilities.kds) throw new AdminMenuError(403,'Waiter calls are part of the Menu + Orders plan')
}

function date(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null
  if (!(value instanceof Date) && typeof value !== 'string') throw new AdminMenuError(503,'Call information is unavailable')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new AdminMenuError(503,'Call information is unavailable')
  return parsed.toISOString()
}
function dto(row: Record<string,unknown>): WaiterCall {
  if (typeof row.id !== 'string' || !UUID.test(row.id) || (row.table_id !== null && (typeof row.table_id !== 'string' || !UUID.test(row.table_id)))
    || typeof row.table_name !== 'string' || !['waiter','bill'].includes(String(row.reason)) || !['open','acknowledged','done'].includes(String(row.status))) throw new AdminMenuError(503,'Call information is unavailable')
  return { id: row.id,table_id: row.table_id as string | null,table_name: row.table_name,
    reason: row.reason as WaiterCall['reason'],status: row.status as WaiterCall['status'],
    created_at: date(row.created_at)!,last_called_at: date(row.last_called_at,true),acknowledged_at: date(row.acknowledged_at,true) }
}

export async function readAdminWaiterCalls(query: AdminMenuQuery, context: AdminWaiterContext, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new AdminMenuError(503,'Call information is unavailable')
  await authorize(query,context,false)
  const result = await query(`SELECT ${COLUMNS} FROM public.waiter_calls
    WHERE tenant_id=$1 AND status<>'done' AND created_at >= $2 ORDER BY created_at,id LIMIT 100`,
    [context.tenantId,new Date(now.getTime()-CALL_STALE_MS)])
  if (result.rows.length > 100) throw new AdminMenuError(503,'Call information is unavailable')
  return { calls: activeCalls(result.rows.map(dto),now.getTime()) }
}

export async function updateAdminWaiterCall(query: AdminMenuQuery, context: AdminWaiterContext, id: string, input: unknown, now = new Date()) {
  if (!UUID.test(id)) throw new AdminMenuError(404,'Not found')
  const status = parseCallStatus(input)
  if (!status) throw new AdminMenuError(400,'Invalid status')
  if (!Number.isFinite(now.getTime())) throw new AdminMenuError(503,'Call information is unavailable')
  await authorize(query,context,true)
  // Existing transitions intentionally accept either target from any current
  // state, including done->acknowledged. Do not invent a stricter state graph.
  const result = await query(status === 'done'
    ? `UPDATE public.waiter_calls SET status='done',done_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING ${COLUMNS}`
    : `UPDATE public.waiter_calls SET status='acknowledged',acknowledged_at=$3,acknowledged_by=$4
       WHERE tenant_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
    status === 'done' ? [context.tenantId,id,now] : [context.tenantId,id,now,context.actorId])
  const row = one(result.rows)
  if (!row) throw new AdminMenuError(404,'Not found')
  return { call: dto(row) }
}
