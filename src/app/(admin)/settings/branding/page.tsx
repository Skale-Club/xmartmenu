export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import BrandingClient from './BrandingClient'
import { getTenantPlan } from '@/lib/tenant-plan'
import { planServiceMode } from '@/lib/service-modes'

export default async function BrandingPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId, slug } = effective!

  const [{ data: settings }, plan] = await Promise.all([
    supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).single(),
    getTenantPlan(tenantId).catch(() => null),
  ])

  return (
    <BrandingClient
      settings={settings}
      tenantId={tenantId}
      tenantSlug={slug}
      tenantName={effective!.name}
      planName={plan?.name ?? null}
      planMode={planServiceMode(plan?.features)}
    />
  )
}
