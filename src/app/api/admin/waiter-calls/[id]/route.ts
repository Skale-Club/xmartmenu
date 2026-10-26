/**
 * PATCH { status: 'acknowledged' | 'done' } — a staff member is on the way, or
 * the call is handled. Owners and staff of the call's restaurant.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { parseCallStatus } from '@/lib/waiter-calls'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { withApi } from '@/lib/observability/with-api'

export const dynamic = 'force-dynamic'

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceClient()
  const capabilities = await getTenantCapabilities(effective.tenantId, undefined, service)
  if (!capabilities.waiterCalls && !capabilities.kds) {
    return NextResponse.json({ error: 'Waiter calls are part of the Menu + Orders plan' }, { status: 403 })
  }
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = parseCallStatus(body?.status)
  if (!status) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const { data: { user } } = await (await createClient()).auth.getUser()
  const now = new Date().toISOString()
  const patch = status === 'done'
    ? { status, done_at: now }
    : { status, acknowledged_at: now, acknowledged_by: user?.id ?? null }
  const { data, error } = await service
    .from('waiter_calls')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .select('id, table_id, table_name, reason, status, created_at, last_called_at, acknowledged_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not update the call' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ call: data })
}

export const PATCH = withApi('PATCH /api/admin/waiter-calls/[id]', handlePATCH)
