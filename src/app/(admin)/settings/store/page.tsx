export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import StoreClient from './StoreClient'

export default async function StorePage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId } = effective!

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()

  // Fetch Stripe connection status
  const { data: stripeConnection } = await supabase
    .from('stripe_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()

  return <StoreClient settings={settings} tenantId={tenantId} stripeConnection={stripeConnection} />
}
