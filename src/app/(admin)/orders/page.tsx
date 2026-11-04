export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import OrdersClient from './OrdersClient'
import { ordersDataOwned } from '@/lib/data/orders'
import { readOwnedOrdersKdsPage } from '@/lib/data/orders-runtime'

export default async function OrdersPage() {
  const effective = (await getEffectiveTenant())!
  const { tenantId } = effective

  if (ordersDataOwned()) {
    const data = await readOwnedOrdersKdsPage({ tenantId, role: effective.role })
    if (!data.capabilities.kds) redirect('/dashboard')
    return <OrdersClient initialOrders={data.orders} tenantId={tenantId} amberThreshold={data.amberThreshold}
      redThreshold={data.redThreshold} locations={data.locations} currency={data.currency} />
  }

  const supabase = await createClient()

  // The sidebar already hides Orders on a plan without them; this covers a typed URL.
  const capabilities = await getTenantCapabilities(tenantId)
  if (!capabilities.kds) redirect('/dashboard')

  // Bound the KDS initial load to a recent window + hard cap (matches
  // /api/orders): the full history is unbounded and PostgREST truncates at 1000.
  const ordersCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: orders }, { data: settings }, { data: locations }] = await Promise.all([
    supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .gte('created_at', ordersCutoff)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('tenant_settings')
      .select('amber_threshold_minutes, red_threshold_minutes, currency')
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('locations')
      .select('id, name, slug')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ])

  return (
    <OrdersClient
      initialOrders={orders ?? []}
      tenantId={tenantId}
      amberThreshold={settings?.amber_threshold_minutes ?? 10}
      redThreshold={settings?.red_threshold_minutes ?? 20}
      locations={locations ?? []}
      currency={settings?.currency ?? 'USD'}
    />
  )
}
