import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

interface Props { params: Promise<{ id: string }> }

async function assertOwnership(zoneId: string) {
  const effective = await getEffectiveTenant()
  if (!effective) return null
  const supabase = await createClient()
  const { data } = await supabase.from('delivery_zones').select('id, tenant_id').eq('id', zoneId).single()
  if (!data || data.tenant_id !== effective.tenantId) return null
  return { supabase, role: effective.role }
}

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const allowed = ['name', 'fee_cents', 'zipcode_prefixes', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  if ('fee_cents' in update) update.fee_cents = Math.max(0, Number(update.fee_cents))

  const { data, error } = await ctx.supabase.from('delivery_zones').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await ctx.supabase.from('delivery_zones').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
