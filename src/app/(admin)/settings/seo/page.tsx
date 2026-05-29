export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getCanonicalUrl } from '@/lib/seo'
import SeoClient from './SeoClient'

export default async function SeoSettingsPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId, slug, name } = effective!

  const [{ data: settings }, { data: tenant }] = await Promise.all([
    supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
    supabase.from('tenants').select('slug, custom_domain, custom_domain_verified').eq('id', tenantId).single(),
  ])

  const canonicalUrl = getCanonicalUrl(tenant ?? { slug }, '/')
  const isCustomDomain = !!(tenant?.custom_domain && tenant?.custom_domain_verified)

  return (
    <SeoClient
      settings={settings}
      tenantId={tenantId}
      tenantName={name}
      canonicalUrl={canonicalUrl}
      isCustomDomain={isCustomDomain}
    />
  )
}
