export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import TenantsClient from './TenantsClient'

export default async function TenantsPage() {
  const supabase = await createClient()

  const { data: tenants } = await supabase
    .from('tenants')
    .select('*, tenant_settings(logo_url), profiles(id, full_name)')
    .order('created_at', { ascending: false })

  return <TenantsClient tenants={tenants ?? []} />
}
