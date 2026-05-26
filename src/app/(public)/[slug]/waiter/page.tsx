export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import WaiterPage from './WaiterPage'

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
  if (!settings?.table_management_enabled) {
    redirect(`/${slug}`)
  }

  // Fetch tables
  const { data: tables } = await service
    .from('restaurant_tables')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('position')

  // Fetch active menu and products for ordering
  const { data: menu } = await service
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()

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
  const optionGroupsByProductId: Record<string, any[]> = {}
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
        options: (g.options ?? []).filter((o: any) => o.is_available),
      })
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
      activeOrders={(activeOrders ?? []) as any[]}
      currency={currency}
      primaryColor={primaryColor}
    />
  )
}
