export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import { readOwnedProductsPage } from '@/lib/data/admin-products-runtime'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { notFound } from 'next/navigation'
import ProductsClient from './ProductsClient'

export default async function ProductsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) notFound()
  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  if (ownedCatalogEnabled()) {
    const cookieStore = await cookies()
    const selectedMenuId = cookieStore.get('selected_menu_id')?.value
    const { products, categories, menu, settings } = await readOwnedProductsPage(
      { tenantId, role: effective.role },
      selectedMenuId,
    )
    return (
      <ProductsClient
        products={products}
        categories={categories}
        tenantId={tenantId}
        menuId={menu?.id ?? null}
        activeMenuName={menu?.name ?? null}
        availableTags={settings.custom_tags}
        currency={settings.currency ?? 'USD'}
        canManage={canManage}
        ownedSource
      />
    )
  }

  const supabase = await createClient()
  const activeMenu = await getActiveMenuForTenant(tenantId)

  if (!activeMenu) {
    return (
      <ProductsClient
        products={[]}
        categories={[]}
        tenantId={tenantId}
        menuId={null}
        activeMenuName={null}
        canManage={canManage}
        ownedSource={false}
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
      currency={settings?.currency ?? 'USD'}
      canManage={canManage}
      ownedSource={false}
    />
  )
}
