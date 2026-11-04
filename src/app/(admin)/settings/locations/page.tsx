export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import LocationsClient from './LocationsClient'
import { redirect } from 'next/navigation'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedLocationsPage } from '@/lib/data/admin-locations-runtime'
import type { Location } from '@/types/database'

type MenuOption = { id: string; name: string; slug: string; is_default: boolean }

export default async function LocationsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  const { tenantId } = effective

  let locations: Location[], menus: MenuOption[], tenantSlug: string
  if (adminMenusOwned()) {
    const owned = await readOwnedLocationsPage({ tenantId, role: effective.role })
    locations = owned.locations
    menus = owned.menus
    tenantSlug = owned.tenantSlug
  } else {
    const supabase = await createClient()
    const [{ data: legacyLocations }, { data: legacyMenus }, { data: tenant }] = await Promise.all([
      supabase.from('locations').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true }),
      supabase.from('menus').select('id, name, slug, is_default').eq('tenant_id', tenantId).eq('is_active', true).order('position'),
      supabase.from('tenants').select('slug').eq('id', tenantId).single(),
    ])
    locations = legacyLocations ?? []
    menus = legacyMenus ?? []
    tenantSlug = tenant?.slug ?? ''
  }

  return (
    <LocationsClient
      initialLocations={locations}
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      menus={menus}
    />
  )
}
