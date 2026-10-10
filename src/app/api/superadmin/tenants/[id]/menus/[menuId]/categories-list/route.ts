import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

interface Props { params: Promise<{ id: string; menuId: string }> }

export async function GET(_req: Request, { params }: Props) {
  const { id: tenantId, menuId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from('categories')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('menu_id', menuId)
    .order('position')

  if (error) {
    console.error('GET /api/superadmin/tenants/[id]/menus/[menuId]/categories-list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ categories: data ?? [] })
}
