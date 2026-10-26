export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import WaiterPage from './WaiterPage'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { ProductIngredientWithIngredient } from '@/types/database'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function WaiterServerPage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  // Must be authenticated
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}`)

  // Must be admin or staff on this tenant
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, slug, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) redirect(`/${slug}`)

  const isSuperadmin = profile?.role === 'superadmin' || profile?.role === 'super-admin'
  const isStaff = profile?.role === 'store-admin' || profile?.role === 'store-staff'
  const belongsToTenant = profile?.tenant_id === tenant.id

  if (!isSuperadmin && !(isStaff && belongsToTenant)) {
    redirect(`/${slug}`)
  }

  const settings = tenant.tenant_settings as any
  // The plan must include waiter ordering and the restaurant must have it on
  // (service-modes.ts) — the same rule the orders API applies.
  const capabilities = await getTenantCapabilities(tenant.id, settings, service)
  if (!capabilities.waiterOrdering) {
    redirect(`/${slug}`)
  }

  // Fetch tables
  const { data: tables } = await service
    .from('restaurant_tables')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('position')

  // The menu staff order from: the default one, else the first active menu
  // (same fallback as the public menu page).
  const { data: defaultMenu } = await service
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()
  const menu = defaultMenu ?? (await service
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .maybeSingle()).data

  const menuId = menu?.id ?? null
  const [{ data: categories }, { data: products }] = await Promise.all([
    menuId
      ? service.from('categories').select('*').eq('menu_id', menuId).eq('is_active', true).order('position')
      : Promise.resolve({ data: [] }),
    menuId
      ? service.from('products').select('*').eq('menu_id', menuId).eq('is_available', true).order('position')
      : Promise.resolve({ data: [] }),
  ])

  // Fetch option groups for each product
  const productIds = (products ?? []).map((p: any) => p.id)
  // Sizes and add-ons are chosen in the same dish sheet guests use, and the
  // orders API prices them from these ids (option-pricing.ts).
  const optionGroupsByProductId: Record<string, GroupWithOptions[]> = {}
  if (productIds.length > 0) {
    const { data: rawGroups } = await service
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .in('product_id', productIds)
      .order('position')
      .order('position', { referencedTable: 'product_options' })
    for (const g of rawGroups ?? []) {
      if (!optionGroupsByProductId[g.product_id]) optionGroupsByProductId[g.product_id] = []
      optionGroupsByProductId[g.product_id].push({
        ...g,
        options: ((g.options ?? []) as GroupWithOptions['options']).filter(o => o.is_available),
      })
    }
  }

  const productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]> = {}
  if (capabilities.ingredientCustomization && productIds.length > 0) {
    const { data: rawPIs } = await service
      .from('product_ingredients')
      .select('*, ingredient:ingredients(*)')
      .in('product_id', productIds)
      .order('position')
    for (const pi of rawPIs ?? []) {
      if (!productIngredientsByProductId[pi.product_id]) productIngredientsByProductId[pi.product_id] = []
      productIngredientsByProductId[pi.product_id].push(pi as ProductIngredientWithIngredient)
    }
  }

  // Fetch pending/preparing/ready orders for status indicators
  const { data: activeOrders } = await service
    .from('orders')
    .select('id, table_name, status')
    .eq('tenant_id', tenant.id)
    .in('status', ['pending', 'paid', 'preparing', 'ready'])
    .not('table_name', 'is', null)

  const currency = settings?.currency ?? 'USD'
  const primaryColor = settings?.primary_color ?? '#F52323'

  return (
    <WaiterPage
      slug={slug}
      tenantId={tenant.id}
      tenantName={tenant.name}
      tables={(tables ?? []) as any[]}
      categories={(categories ?? []) as any[]}
      products={(products ?? []) as any[]}
      optionGroupsByProductId={optionGroupsByProductId}
      productIngredientsByProductId={productIngredientsByProductId}
      capabilities={capabilities}
      activeOrders={(activeOrders ?? []) as any[]}
      currency={currency}
      primaryColor={primaryColor}
    />
  )
}
