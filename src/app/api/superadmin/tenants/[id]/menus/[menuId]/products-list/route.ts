import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

interface Props { params: Promise<{ id: string; menuId: string }> }

export async function GET(req: Request, { params }: Props) {
  const { id: tenantId, menuId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const categoryId = searchParams.get('categoryId')

  const service = await createServiceClient()

  let query = service
    .from('products')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('menu_id', menuId)
    .order('position', { ascending: true })

  if (categoryId) {
    query = query.eq('category_id', categoryId)
  }

  const { data, error } = await query

  if (error) {
    console.error('GET /api/superadmin/tenants/[id]/menus/[menuId]/products-list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ products: data ?? [] })
}
