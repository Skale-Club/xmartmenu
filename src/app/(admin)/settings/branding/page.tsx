export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import BrandingClient from './BrandingClient'

export default async function BrandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants(slug)')
    .eq('id', user!.id)
    .single()

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', profile!.tenant_id)
    .single()

  return (
    <BrandingClient
      settings={settings}
      tenantId={profile!.tenant_id}
      tenantSlug={(profile!.tenants as any)?.slug ?? ''}
    />
  )
}
