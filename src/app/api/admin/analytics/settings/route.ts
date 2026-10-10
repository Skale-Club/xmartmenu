import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'

const settingsSchema = z.strictObject({
  analytics_enabled: z.boolean(),
  visual_feed_enabled: z.boolean(),
  menu_default_view: z.enum(['list', 'feed']),
  feed_autoplay_videos: z.boolean(),
}).superRefine((value, ctx) => {
  if (!value.visual_feed_enabled && value.menu_default_view === 'feed') {
    ctx.addIssue({
      code: 'custom',
      path: ['menu_default_view'],
      message: 'Feed must be enabled before it can be the default view',
    })
  }
})

export async function PATCH(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid settings' },
      { status: 400 },
    )
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('tenant_settings')
    .upsert({
      tenant_id: effective.tenantId,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })
    .select('analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos')
    .single()

  if (error) {
    console.error('PATCH /api/admin/analytics/settings:', error)
    return NextResponse.json({ error: 'Could not save settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}

export const dynamic = 'force-dynamic'
