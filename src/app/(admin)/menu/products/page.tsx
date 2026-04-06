export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import ProductsClient from './ProductsClient'

export default async function ProductsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user!.id)
    .single()

  const tenantId = profile!.tenant_id

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('tenant_id', tenantId)
      .order('position'),
    supabase
      .from('categories')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('position'),
  ])

  return (
    <ProductsClient
      products={products ?? []}
      categories={categories ?? []}
      tenantId={tenantId}
    />
  )
}
