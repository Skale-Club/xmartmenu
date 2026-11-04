export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import type { ServiceSettings } from '@/lib/service-modes'
import StoreClient from './StoreClient'
import { redirect } from 'next/navigation'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedStorePage } from '@/lib/data/admin-store-settings-runtime'
import type { Tenant, TenantSettings } from '@/types/database'
import type { StripeConnection } from '@/lib/stripe'

export default async function StorePage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  const { tenantId, slug } = effective

  let settings: TenantSettings | null
  let stripeConnection: StripeConnection | null
  let tenant: Pick<Tenant, 'custom_domain' | 'custom_domain_verified'> | null
  let capabilities
  if (adminMenusOwned()) {
    const owned = await readOwnedStorePage({ tenantId, role: effective.role })
    settings = owned.settings
    tenant = owned.tenant
    stripeConnection = owned.stripeConnection
    capabilities = owned.capabilities
  } else {
    const supabase = await createClient()
    const [settingsResult, stripeResult, tenantResult] = await Promise.all([
      supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
      supabase.from('stripe_connections').select('*').eq('tenant_id', tenantId).eq('is_active', true).single(),
      supabase.from('tenants').select('custom_domain, custom_domain_verified').eq('id', tenantId).single(),
    ])
    settings = settingsResult.data
    stripeConnection = stripeResult.data
    tenant = tenantResult.data
    capabilities = await getTenantCapabilities(tenantId, (settings ?? null) as ServiceSettings | null)
  }

  return (
    <StoreClient
      settings={settings}
      tenantId={tenantId}
      tenantSlug={slug}
      stripeConnection={stripeConnection}
      tenant={tenant}
      capabilities={capabilities}
      ownedSource={adminMenusOwned()}
    />
  )
}
