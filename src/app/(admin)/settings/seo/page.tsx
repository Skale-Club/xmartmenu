export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getCanonicalUrl } from '@/lib/seo'
import SeoClient from './SeoClient'
import { redirect } from 'next/navigation'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedSeoSettingsPage } from '@/lib/data/admin-display-settings-runtime'

export default async function SeoSettingsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  const { tenantId, slug, name } = effective
  let settings: unknown
  let tenant: { slug?: string | null; custom_domain?: string | null; custom_domain_verified?: boolean | null } | null
  if (adminMenusOwned()) {
    ({ settings, tenant } = await readOwnedSeoSettingsPage({ tenantId, role: effective.role }))
  } else {
    const supabase = await createClient()
    const [{ data: legacySettings }, { data: legacyTenant }] = await Promise.all([
      supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
      supabase.from('tenants').select('slug, custom_domain, custom_domain_verified').eq('id', tenantId).single(),
    ])
    settings = legacySettings
    tenant = legacyTenant
  }

  const canonicalUrl = getCanonicalUrl({
    slug: tenant?.slug ?? slug,
    custom_domain: tenant?.custom_domain,
    custom_domain_verified: tenant?.custom_domain_verified === true,
  }, '/')
  const isCustomDomain = !!(tenant?.custom_domain && tenant?.custom_domain_verified)

  return (
    <SeoClient
      settings={settings as import('@/types/database').TenantSettings | null}
      tenantId={tenantId}
      tenantName={name}
      canonicalUrl={canonicalUrl}
      isCustomDomain={isCustomDomain}
    />
  )
}
