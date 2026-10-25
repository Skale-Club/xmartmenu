export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import MenuDisplayClient from './MenuDisplayClient'

export default async function MenuDisplayPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  const service = createServiceClient()
  const { data } = await service
    .from('tenant_settings')
    .select('analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

  return (
    <MenuDisplayClient
      initialSettings={{
        analytics_enabled: data?.analytics_enabled ?? true,
        visual_feed_enabled: data?.visual_feed_enabled ?? true,
        menu_default_view: data?.menu_default_view === 'feed' ? 'feed' : 'list',
        feed_autoplay_videos: data?.feed_autoplay_videos ?? true,
      }}
      menuUrl={`${baseUrl}/${effective.slug}`}
      feedUrl={`${baseUrl}/feed/${effective.slug}`}
    />
  )
}
