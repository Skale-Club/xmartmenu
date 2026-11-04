import type { QRCode, RestaurantTable } from '@/types/database'
import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

export type StoreOperationsContext = AdminMenuContext
export type RestaurantTableMutation =
  | { kind: 'create'; name: unknown }
  | { kind: 'delete'; id: string }
  | { kind: 'reorder'; firstId: string; secondId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TABLE_COLUMNS = 'id,tenant_id,name,position,is_active,created_at,updated_at'
const QR_COLUMNS = 'id,tenant_id,label,target_url,scans,created_at'

function context(context: StoreOperationsContext, write = false, managersOnly = false) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
  if (write && managersOnly && context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
}

function row<T>(rows: Record<string, unknown>[], label: string): T {
  const value = rows[0]
  if (!value) throw new AdminMenuError(503, `${label} could not be saved`)
  return value as T
}

export async function readAdminQrCodes(query: AdminMenuQuery, ctx: StoreOperationsContext) {
  context(ctx)
  const result = await query(`SELECT ${QR_COLUMNS} FROM public.qr_codes WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1001`, [ctx.tenantId])
  if (result.rows.length > 1000) throw new AdminMenuError(409, 'QR code list exceeds the supported limit')
  return result.rows as unknown as QRCode[]
}

export async function createAdminQrCode(query: AdminMenuQuery, ctx: StoreOperationsContext, label: unknown, targetUrl: string) {
  context(ctx, true, true)
  if (typeof label !== 'string' || !label.trim() || label.length > 500) throw new AdminMenuError(400, 'A label up to 500 characters is required')
  if (typeof targetUrl !== 'string' || targetUrl.length > 4096) throw new AdminMenuError(400, 'Invalid QR target')
  const result = await query(`INSERT INTO public.qr_codes (tenant_id,label,target_url) VALUES($1,$2,$3) RETURNING ${QR_COLUMNS}`,
    [ctx.tenantId, label, targetUrl])
  return row<QRCode>(result.rows, 'QR code')
}

export async function deleteAdminQrCode(query: AdminMenuQuery, ctx: StoreOperationsContext, id: string) {
  context(ctx, true, true)
  if (!UUID.test(id)) throw new AdminMenuError(404, 'Not found')
  const result = await query('DELETE FROM public.qr_codes WHERE tenant_id=$1 AND id=$2 RETURNING id', [ctx.tenantId, id])
  if (!result.rows.length) throw new AdminMenuError(404, 'Not found')
  return { ok: true as const }
}

export async function readAdminRestaurantTables(query: AdminMenuQuery, ctx: StoreOperationsContext) {
  context(ctx)
  const result = await query(`SELECT ${TABLE_COLUMNS} FROM public.restaurant_tables WHERE tenant_id=$1 ORDER BY position,id LIMIT 1001`, [ctx.tenantId])
  if (result.rows.length > 1000) throw new AdminMenuError(409, 'Table list exceeds the supported limit')
  return result.rows as unknown as RestaurantTable[]
}
export async function mutateAdminRestaurantTable(query: AdminMenuQuery, ctx: StoreOperationsContext, mutation: RestaurantTableMutation): Promise<RestaurantTable[] | RestaurantTable | { ok: true }> {
  context(ctx, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-restaurant-tables:${ctx.tenantId}`])
  if (mutation.kind === 'create') {
    if (typeof mutation.name !== 'string' || !mutation.name.trim() || mutation.name.trim().length > 200) throw new AdminMenuError(400, 'A table name up to 200 characters is required')
    const position = await query('SELECT coalesce(max(position),-1)+1 AS position FROM public.restaurant_tables WHERE tenant_id=$1', [ctx.tenantId])
    const result = await query(`INSERT INTO public.restaurant_tables (tenant_id,name,position) VALUES($1,$2,$3) RETURNING ${TABLE_COLUMNS}`,
      [ctx.tenantId, mutation.name.trim(), position.rows[0]?.position ?? 0])
    return row<RestaurantTable>(result.rows, 'Restaurant table')
  }
  if (mutation.kind === 'delete') {
    if (!UUID.test(mutation.id)) throw new AdminMenuError(404, 'Not found')
    const result = await query('DELETE FROM public.restaurant_tables WHERE tenant_id=$1 AND id=$2 RETURNING id', [ctx.tenantId, mutation.id])
    if (!result.rows.length) throw new AdminMenuError(404, 'Not found')
    return { ok: true }
  }

  if (!UUID.test(mutation.firstId) || !UUID.test(mutation.secondId) || mutation.firstId === mutation.secondId) throw new AdminMenuError(400, 'Invalid table order')
  const locked = await query(`SELECT id,position FROM public.restaurant_tables WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [ctx.tenantId, [mutation.firstId, mutation.secondId]])
  if (locked.rows.length !== 2) throw new AdminMenuError(404, 'Not found')
  const positions = new Map(locked.rows.map(item => [String(item.id), Number(item.position)]))
  const first = positions.get(mutation.firstId), second = positions.get(mutation.secondId)
  if (!Number.isInteger(first) || !Number.isInteger(second)) throw new AdminMenuError(503, 'Table order is unavailable')
  await query(`UPDATE public.restaurant_tables SET position=CASE id WHEN $2 THEN $4::integer WHEN $3 THEN $5::integer END,updated_at=now()
    WHERE tenant_id=$1 AND id IN ($2,$3)`, [ctx.tenantId, mutation.firstId, mutation.secondId, second, first])
  const result = await query(`SELECT ${TABLE_COLUMNS} FROM public.restaurant_tables WHERE tenant_id=$1 ORDER BY position,id LIMIT 1001`, [ctx.tenantId])
  if (result.rows.length > 1000) throw new AdminMenuError(409, 'Table list exceeds the supported limit')
  return result.rows as unknown as RestaurantTable[]
}

