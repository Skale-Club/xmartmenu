export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import MenuDisplayClient from './MenuDisplayClient'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedMenuDisplayPage } from '@/lib/data/admin-display-settings-runtime'

type MenuDisplaySettingsRow = {
  analytics_enabled?: boolean | null
  visual_feed_enabled?: boolean | null
  menu_default_view?: string | null
  feed_autoplay_videos?: boolean | null
  upsell_enabled?: boolean | null
}

export default async function MenuDisplayPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  let data: MenuDisplaySettingsRow | null
  let upsellAvailable: boolean
  if (adminMenusOwned()) {
    const owned = await readOwnedMenuDisplayPage({ tenantId: effective.tenantId, role: effective.role })
    data = owned.settings as MenuDisplaySettingsRow | null
    upsellAvailable = owned.upsellAvailable
  } else {
    const service = createServiceClient()
    const [{ data: legacySettings }, capabilities] = await Promise.all([
      service.from('tenant_settings')
        .select('analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos, upsell_enabled')
        .eq('tenant_id', effective.tenantId)
        .maybeSingle(),
      getTenantCapabilities(effective.tenantId, null, service),
    ])
    data = legacySettings
    upsellAvailable = capabilities.plan.payments
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

  return (
    <MenuDisplayClient
      initialSettings={{
        analytics_enabled: data?.analytics_enabled ?? true,
        visual_feed_enabled: data?.visual_feed_enabled ?? true,
        menu_default_view: data?.menu_default_view === 'feed' ? 'feed' : 'list',
        feed_autoplay_videos: data?.feed_autoplay_videos ?? true,
        upsell_enabled: data?.upsell_enabled ?? true,
      }}
      upsellAvailable={upsellAvailable}
      menuUrl={`${baseUrl}/${effective.slug}`}
      feedUrl={`${baseUrl}/feed/${effective.slug}`}
    />
  )
}
