export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantPlan } from '@/lib/tenant-plan'
import StoreClient from './StoreClient'

export default async function StorePage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId } = effective!

  const [
    { data: settings },
    { data: stripeConnection },
    { data: tenant },
    plan,
  ] = await Promise.all([
    supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
    supabase.from('stripe_connections').select('*').eq('tenant_id', tenantId).eq('is_active', true).single(),
    supabase.from('tenants').select('custom_domain, custom_domain_verified').eq('id', tenantId).single(),
    getTenantPlan(tenantId),
  ])

  const isPaymentsPlan = plan?.features.includes('payments') ?? false

  return <StoreClient settings={settings} tenantId={tenantId} stripeConnection={stripeConnection} tenant={tenant} isPaymentsPlan={isPaymentsPlan} />
}
