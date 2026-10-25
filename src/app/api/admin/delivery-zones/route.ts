import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handleGET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('*')
    .eq('tenant_id', effective.tenantId)
    .order('created_at')

  if (error) {
    log.error('GET /api/admin/delivery-zones', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, fee_cents, zipcode_prefixes } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Zone name is required' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('delivery_zones')
    .insert({
      tenant_id: effective.tenantId,
      name: name.trim(),
      fee_cents: Math.max(0, Number(fee_cents ?? 0)),
      zipcode_prefixes: Array.isArray(zipcode_prefixes) ? zipcode_prefixes : [],
    })
    .select()
    .single()

  if (error) {
    log.error('POST /api/admin/delivery-zones', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

export const GET = withApi('GET /api/admin/delivery-zones', handleGET)
export const POST = withApi('POST /api/admin/delivery-zones', handlePOST)
