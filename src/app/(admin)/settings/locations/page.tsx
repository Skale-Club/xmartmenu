export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import LocationsClient from './LocationsClient'

export default async function LocationsPage() {
  const supabase = await createClient()
  const { tenantId } = (await getEffectiveTenant())!

  const { data: locations } = await supabase
    .from('locations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  return <LocationsClient initialLocations={locations ?? []} tenantId={tenantId} />
}
