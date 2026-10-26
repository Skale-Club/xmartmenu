import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

interface Props { params: Promise<{ id: string }> }

const DELIVERY_ZONES_LOCKED = 'Delivery zones are part of the Menu + Payments plan'

async function assertOwnership(zoneId: string) {
  const effective = await getEffectiveTenant()
  if (!effective) return null
  const supabase = await createClient()
  const { data } = await supabase.from('delivery_zones').select('id, tenant_id').eq('id', zoneId).single()
  if (!data || data.tenant_id !== effective.tenantId) return null
  return { supabase, role: effective.role, tenantId: effective.tenantId }
}

async function handlePATCH(request: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Only the plan matters here (settings don't change the ceiling).
  if (!(await getTenantCapabilities(ctx.tenantId, null)).plan.payments) {
    return NextResponse.json({ error: DELIVERY_ZONES_LOCKED }, { status: 403 })
  }

  const body = await request.json()
  const allowed = ['name', 'fee_cents', 'zipcode_prefixes', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  if ('fee_cents' in update) update.fee_cents = Math.max(0, Number(update.fee_cents))

  const { data, error } = await ctx.supabase.from('delivery_zones').update(update).eq('id', id).select().single()
  if (error) {
    log.error('PATCH /api/admin/delivery-zones/[id]', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data)
}

async function handleDELETE(_req: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Only the plan matters here (settings don't change the ceiling).
  if (!(await getTenantCapabilities(ctx.tenantId, null)).plan.payments) {
    return NextResponse.json({ error: DELIVERY_ZONES_LOCKED }, { status: 403 })
  }

  await ctx.supabase.from('delivery_zones').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}

export const PATCH = withApi('PATCH /api/admin/delivery-zones/[id]', handlePATCH)
export const DELETE = withApi('DELETE /api/admin/delivery-zones/[id]', handleDELETE)
