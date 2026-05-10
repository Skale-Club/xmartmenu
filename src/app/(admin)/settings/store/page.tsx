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

  const { data: stripeConnection } = await supabase
    .from('stripe_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('custom_domain, custom_domain_verified')
    .eq('id', tenantId)
    .single()

  return <StoreClient settings={settings} tenantId={tenantId} stripeConnection={stripeConnection} tenant={tenant} />
}
