export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import OrdersClient from './OrdersClient'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { tenantId } = (await getEffectiveTenant())!

  const [{ data: orders }, { data: settings }] = await Promise.all([
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
  ])

  return (
    <OrdersClient
      initialOrders={orders ?? []}
      tenantId={tenantId}
      amberThreshold={settings?.amber_threshold_minutes ?? 10}
      redThreshold={settings?.red_threshold_minutes ?? 20}
    />
  )
}
