import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, description, position, menu_id } = body

  const service = await createServiceClient()

  const activeMenu = await getActiveMenuForTenant(effective.tenantId)
  const fallbackMenuId = activeMenu?.id ?? null

  let resolvedMenuId: string | null = menu_id ?? fallbackMenuId

  if (menu_id) {
    const { data: ownedMenu } = await service
      .from('menus')
      .select('id')
      .eq('id', menu_id)
      .eq('tenant_id', effective.tenantId)
      .single()

    if (!ownedMenu) {
      return NextResponse.json({ error: 'Invalid menu selected' }, { status: 400 })
    }

    resolvedMenuId = ownedMenu.id
  }

  if (!resolvedMenuId) {
    return NextResponse.json({ error: 'No menu selected' }, { status: 400 })
  }

  const { data, error } = await service
    .from('categories')
    .insert({ tenant_id: effective.tenantId, menu_id: resolvedMenuId, name, description, position })
    .select()
    .single()

  if (error) {
    console.error('POST /api/admin/categories:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
