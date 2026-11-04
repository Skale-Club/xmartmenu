export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import MenuDisplayClient from './MenuDisplayClient'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedDisplaySettings } from '@/lib/data/admin-display-settings-runtime'

export default async function MenuDisplayPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  const data = adminMenusOwned()
    ? await readOwnedDisplaySettings({ tenantId: effective.tenantId, role: effective.role }, 'menu-display')
    : (await createServiceClient()
      .from('tenant_settings')
      .select('analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos, upsell_enabled')
      .eq('tenant_id', effective.tenantId)
      .maybeSingle()).data

  const capabilities = await getTenantCapabilities(effective.tenantId, null)

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
      upsellAvailable={capabilities.plan.payments}
      menuUrl={`${baseUrl}/${effective.slug}`}
      feedUrl={`${baseUrl}/feed/${effective.slug}`}
    />
  )
}
