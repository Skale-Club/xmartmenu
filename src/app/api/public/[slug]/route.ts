import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error || !tenant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from('categories').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('position'),
    supabase.from('products').select('*').eq('tenant_id', tenant.id).eq('is_available', true).order('position'),
  ])

  return NextResponse.json({ tenant, categories, products })
}
