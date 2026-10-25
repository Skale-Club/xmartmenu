import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

interface Props { params: Promise<{ id: string; menuId: string }> }

async function handleGET(req: Request, { params }: Props) {
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
    log.error('GET /api/superadmin/tenants/[id]/menus/[menuId]/products-list', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ products: data ?? [] })
}

export const GET = withApi('GET /api/superadmin/tenants/[id]/menus/[menuId]/products-list', handleGET)
