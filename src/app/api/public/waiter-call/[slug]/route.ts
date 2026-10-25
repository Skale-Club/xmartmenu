/**
 * POST { table_id, reason: 'waiter' | 'bill' } — a guest on a table link asks
 * for a waiter or the bill. The table must belong to the restaurant and be
 * active, and the restaurant must serve at the table (waiter-calls.ts). A
 * repeated tap while the same request is open reuses it (and bumps it back to
 * "open" so the staff notice it again).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantServiceCapabilities } from '@/lib/tenant-plan'
import { canCallWaiter, parseCallReason } from '@/lib/waiter-calls'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseTableParam } from '@/lib/service-modes'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

export const dynamic = 'force-dynamic'

async function handlePOST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ip = getClientIp(request)
  const limited = await rateLimit('waiter-call', ip, 10, '10 m')
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests. The staff has been notified already.' }, { status: 429 })

  const body = (await request.json().catch(() => null)) as { table_id?: unknown; reason?: unknown } | null
  const tableId = parseTableParam(typeof body?.table_id === 'string' ? body.table_id : undefined)
  if (!tableId) return NextResponse.json({ error: 'Unknown table' }, { status: 400 })
  const reason = parseCallReason(body?.reason)

  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, tenant_settings(orders_enabled, direct_orders_enabled, table_management_enabled)')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })

  const settings = (Array.isArray(tenant.tenant_settings) ? tenant.tenant_settings[0] : tenant.tenant_settings) ?? null
  const capabilities = await getTenantServiceCapabilities(tenant.id, settings, service)
  if (!canCallWaiter(capabilities)) return NextResponse.json({ error: 'This restaurant does not take calls from the table' }, { status: 403 })

  const { data: table } = await service
    .from('restaurant_tables')
    .select('id, name')
    .eq('id', tableId)
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .maybeSingle()
  if (!table) return NextResponse.json({ error: 'Unknown table' }, { status: 400 })

  const { data: open } = await service
    .from('waiter_calls')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('table_id', table.id)
    .eq('reason', reason)
    .neq('status', 'done')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (open) {
    const { error } = await service
      .from('waiter_calls')
      .update({ status: 'open', acknowledged_at: null, acknowledged_by: null, last_called_at: new Date().toISOString() })
      .eq('id', open.id)
    if (error) log.error('waiter_call.reopen_failed', { err: error })
    return NextResponse.json({ id: open.id, repeated: true })
  }

  const { data: call, error } = await service
    .from('waiter_calls')
    .insert({ tenant_id: tenant.id, table_id: table.id, table_name: table.name, reason })
    .select('id')
    .single()
  if (error || !call) {
    log.error('waiter_call.insert_failed', { err: error })
    return NextResponse.json({ error: 'Could not call the waiter' }, { status: 500 })
  }
  log.info('waiter_call.created', { tenant_id: tenant.id, table: table.name, reason })
  return NextResponse.json({ id: call.id, repeated: false }, { status: 201 })
}

export const POST = withApi('POST /api/public/waiter-call/[slug]', handlePOST)
