export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import OrdersClient from './OrdersClient'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { tenantId } = (await getEffectiveTenant())!
  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  return <OrdersClient initialOrders={orders ?? []} />
}