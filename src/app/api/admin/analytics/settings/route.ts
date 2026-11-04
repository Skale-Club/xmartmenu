import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import { adminMenusOwned, AdminMenuError } from '@/lib/data/admin-menus'
import { mutateOwnedDisplaySettings } from '@/lib/data/admin-display-settings-runtime'
import { hasSameOriginAdminMutation } from '@/lib/data/admin-display-settings'

const settingsSchema = z.strictObject({
  analytics_enabled: z.boolean(),
  visual_feed_enabled: z.boolean(),
  menu_default_view: z.enum(['list', 'feed']),
  feed_autoplay_videos: z.boolean(),
  upsell_enabled: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.visual_feed_enabled && value.menu_default_view === 'feed') {
    ctx.addIssue({
      code: 'custom',
      path: ['menu_default_view'],
      message: 'Feed must be enabled before it can be the default view',
    })
  }
})

async function handlePATCH(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (adminMenusOwned() && !hasSameOriginAdminMutation(request)) return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid settings' },
      { status: 400 },
    )
  }

  const ownedSettings = adminMenusOwned()
  let service: ReturnType<typeof createServiceClient> | undefined
  if (!ownedSettings && parsed.data.upsell_enabled === true) {
    // Only the plan matters here (settings don't change the ceiling).
    service = createServiceClient()
    const capabilities = await getTenantCapabilities(effective.tenantId, null, service)
    if (!capabilities.plan.payments) {
      return NextResponse.json(
        { error: 'Order suggestions are part of the Menu + Payments plan', locked: ['upsell_enabled'] },
        { status: 403 },
      )
    }
  }

  if (ownedSettings) {
    try {
      const data = await mutateOwnedDisplaySettings({ tenantId: effective.tenantId, role: effective.role }, 'menu-display', parsed.data)
      return NextResponse.json({ settings: data })
    } catch (error) {
      if (error instanceof AdminMenuError) return NextResponse.json({ error: error.message }, { status: error.status })
      log.error('PATCH /api/admin/analytics/settings', { err: error })
      return NextResponse.json({ error: 'Could not save settings' }, { status: 500 })
    }
  }

  service ??= createServiceClient()

  const { data, error } = await service
    .from('tenant_settings')
    .upsert({
      tenant_id: effective.tenantId,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })
    .select('analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos, upsell_enabled')
    .single()

  if (error) {
    log.error('PATCH /api/admin/analytics/settings', { err: error })
    return NextResponse.json({ error: 'Could not save settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}

export const dynamic = 'force-dynamic'

export const PATCH = withApi('PATCH /api/admin/analytics/settings', handlePATCH)
