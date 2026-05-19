export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import OrdersClient from './OrdersClient'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { tenantId } = (await getEffectiveTenant())!

  const [{ data: orders }, { data: settings }, { data: locations }] = await Promise.all([
    supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('tenant_settings')
      .select('amber_threshold_minutes, red_threshold_minutes')
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
    />
  )
}
