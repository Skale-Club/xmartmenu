/**
 * GET — the restaurant's open waiter calls (waiter app and orders screen).
 * Owners and staff alike.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { activeCalls, CALL_STALE_MS, type WaiterCall } from '@/lib/waiter-calls'
import { withApi } from '@/lib/observability/with-api'

export const dynamic = 'force-dynamic'

async function handleGET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceClient()
  const capabilities = await getTenantCapabilities(effective.tenantId, undefined, service)
  if (!capabilities.waiterCalls && !capabilities.kds) {
    return NextResponse.json({ error: 'Waiter calls are part of the Menu + Orders plan' }, { status: 403 })
  }
  const { data, error } = await service
    .from('waiter_calls')
    .select('id, table_id, table_name, reason, status, created_at, last_called_at, acknowledged_at')
    .eq('tenant_id', effective.tenantId)
    .neq('status', 'done')
    .gte('created_at', new Date(Date.now() - CALL_STALE_MS).toISOString())
    .order('created_at')
    .limit(100)
  if (error) return NextResponse.json({ error: 'Could not load calls' }, { status: 500 })
  return NextResponse.json({ calls: activeCalls((data ?? []) as WaiterCall[]) })
}

export const GET = withApi('GET /api/admin/waiter-calls', handleGET)
