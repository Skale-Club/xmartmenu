import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

export async function GET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('*')
    .eq('tenant_id', effective.tenantId)
    .order('created_at')

  if (error) {
    console.error('GET /api/admin/delivery-zones:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
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
    console.error('POST /api/admin/delivery-zones:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
