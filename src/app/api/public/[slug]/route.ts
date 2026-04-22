import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error || !tenant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: menu } = await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()

  const resolvedMenu = menu ?? (await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .maybeSingle()).data

  let categories: unknown[] = []
  let products: unknown[] = []

  if (resolvedMenu?.id) {
    const response = await Promise.all([
      supabase.from('categories').select('*').eq('menu_id', resolvedMenu.id).eq('is_active', true).order('position'),
      supabase.from('products').select('*').eq('menu_id', resolvedMenu.id).eq('is_available', true).order('position'),
    ])
    categories = response[0].data ?? []
    products = response[1].data ?? []
  }

  return NextResponse.json({ tenant, menu: resolvedMenu, categories, products })
}
