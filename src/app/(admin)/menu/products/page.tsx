export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import ProductsClient from './ProductsClient'

export default async function ProductsPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective!.tenantId
  const activeMenu = await getActiveMenuForTenant(tenantId)

  if (!activeMenu) {
    return (
      <ProductsClient
        products={[]}
        categories={[]}
        tenantId={tenantId}
        menuId={null}
        activeMenuName={null}
      />
    )
  }

  const [{ data: products }, { data: categories }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('tenant_id', tenantId)
      .eq('menu_id', activeMenu.id)
      .order('position'),
    supabase
      .from('categories')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('menu_id', activeMenu.id)
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('tenant_settings')
      .select('custom_tags, currency')
      .eq('tenant_id', tenantId)
      .single(),
  ])

  return (
    <ProductsClient
      products={products ?? []}
      categories={categories ?? []}
      tenantId={tenantId}
      menuId={activeMenu.id}
      activeMenuName={activeMenu.name}
      availableTags={settings?.custom_tags ?? undefined}
      currency={settings?.currency ?? 'BRL'}
    />
  )
}
