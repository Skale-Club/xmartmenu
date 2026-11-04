export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { redirect } from 'next/navigation'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedDisplaySettings } from '@/lib/data/admin-display-settings-runtime'
import BrandingClient from './BrandingClient'

export default async function BrandingPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  const { tenantId, slug } = effective

  const settings = adminMenusOwned()
    ? await readOwnedDisplaySettings({ tenantId, role: effective.role }, 'branding')
    : (await createClient()).from('tenant_settings').select('*').eq('tenant_id', tenantId).single().then(({ data }) => data)

  return (
    <BrandingClient
      settings={settings as unknown as import('@/types/database').TenantSettings | null}
      tenantId={tenantId}
      tenantSlug={slug}
      tenantName={effective!.name}
    />
  )
}
