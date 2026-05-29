import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

// Lists products for a given menu | used by AI Tools per-product image seed UI (AI-09).
// Mirrors the existing /menus/[menuId]/categories-list pattern.
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard | assertSuperadmin returns client or null (SEC-03 pattern)
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const menuId = searchParams.get('menuId')
  if (!menuId) return NextResponse.json({ error: 'menuId required' }, { status: 400 })

  const service = await createServiceClient()
  const { data: products, error } = await service
    .from('products')
    .select('id, name, image_url, category_id')
    .eq('tenant_id', tenantId)
    .eq('menu_id', menuId)
    .order('position', { ascending: true })

  if (error) {
    console.error('GET /api/superadmin/tenants/[id]/products-list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ products: products ?? [] })
}
