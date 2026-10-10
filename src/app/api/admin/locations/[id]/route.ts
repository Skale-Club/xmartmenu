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
  const allowed = ['name', 'slug', 'address', 'city', 'phone', 'business_hours', 'is_active', 'menu_id',
                   'region', 'postal_code', 'country', 'latitude', 'longitude']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]

  // Coordinates must be finite numbers or null.
  for (const key of ['latitude', 'longitude'] as const) {
    if (key in update) {
      const v = update[key]
      update[key] = typeof v === 'number' && Number.isFinite(v) ? v : null
    }
  }

  if (update.slug && !/^[a-z0-9-]+$/.test(update.slug as string)) {
    return NextResponse.json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 })
  }

  const service = await createServiceClient()

  // A location may only reference a menu owned by the same tenant. Without this
  // check a store-admin could point their location at another tenant's menu id,
  // and the public branch page would then render that tenant's products/pricing
  // (the public read resolves the menu by id only). null clears the reference.
  if ('menu_id' in update) {
    const menuId = update.menu_id
    if (menuId === null || menuId === '') {
      update.menu_id = null
    } else {
      const { data: ownedMenu } = await service
        .from('menus')
        .select('id')
        .eq('id', menuId as string)
        .eq('tenant_id', effective.tenantId)
        .maybeSingle()
      if (!ownedMenu) {
        return NextResponse.json({ error: 'Menu not found for this tenant' }, { status: 400 })
      }
    }
  }
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
    console.error('PATCH /api/admin/locations/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data)
}
