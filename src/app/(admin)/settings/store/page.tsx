export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import type { ServiceSettings } from '@/lib/service-modes'
import StoreClient from './StoreClient'

export default async function StorePage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId, slug } = effective!

  const [
    { data: settings },
    { data: stripeConnection },
    { data: tenant },
  ] = await Promise.all([
    supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
    supabase.from('stripe_connections').select('*').eq('tenant_id', tenantId).eq('is_active', true).single(),
    supabase.from('tenants').select('custom_domain, custom_domain_verified').eq('id', tenantId).single(),
  ])

  const capabilities = await getTenantCapabilities(tenantId, (settings ?? null) as ServiceSettings | null)

  return (
    <StoreClient
      settings={settings}
      tenantId={tenantId}
      tenantSlug={slug}
      stripeConnection={stripeConnection}
      tenant={tenant}
      capabilities={capabilities}
    />
  )
}
