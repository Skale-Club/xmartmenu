import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const allowed = ['name', 'slug', 'address', 'city', 'phone', 'business_hours', 'is_active', 'menu_id']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]

  if (update.slug && !/^[a-z0-9-]+$/.test(update.slug as string)) {
    return NextResponse.json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data, error } = await service
    .from('locations')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A location with this slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
