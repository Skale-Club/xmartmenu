export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import LocationsClient from './LocationsClient'

export default async function LocationsPage() {
  const supabase = await createClient()
  const { tenantId } = (await getEffectiveTenant())!

  const [{ data: locations }, { data: menus }, { data: tenant }] = await Promise.all([
    supabase.from('locations').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true }),
    supabase.from('menus').select('id, name, slug, is_default').eq('tenant_id', tenantId).eq('is_active', true).order('position'),
    supabase.from('tenants').select('slug').eq('id', tenantId).single(),
  ])

  return (
    <LocationsClient
      initialLocations={locations ?? []}
      tenantId={tenantId}
      tenantSlug={tenant?.slug ?? ''}
      menus={menus ?? []}
    />
  )
}
