export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import BrandingClient from './BrandingClient'

export default async function BrandingPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId, slug } = effective!

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()

  return (
    <BrandingClient
      settings={settings}
      tenantId={tenantId}
      tenantSlug={slug}
      tenantName={effective!.name}
    />
  )
}
