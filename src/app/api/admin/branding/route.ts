import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import { normalizeWhatsapp } from '@/lib/service-settings'

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * PATCH /api/admin/branding
 * Server-side save for tenant branding/settings (S02/S04 hardening). Replaces the
 * previous direct client-side tenant_settings write: validates colors (hex),
 * caps text fields, and scopes to the caller's own tenant. The service switches
 * (orders_enabled, direct_orders_enabled, whatsapp_orders_enabled) are saved by
 * /api/admin/service-settings, which checks the plan; they are ignored here.
 */
async function handlePATCH(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : null)

  const update: Record<string, unknown> = {
    tenant_id: effective.tenantId,
    instagram: str(body.instagram, 64),
    tagline: str(body.tagline, 120),
  }

  // Only written when sent, so a form without it never clears the number the
  // service settings saved.
  if ('whatsapp' in body) {
    const whatsapp = normalizeWhatsapp(body.whatsapp)
    if (whatsapp === undefined) {
      return NextResponse.json({ error: 'Invalid whatsapp' }, { status: 400 })
    }
    update.whatsapp = whatsapp
  }

  // Colors are interpolated into <style> downstream — must be strict hex.
  for (const key of ['primary_color', 'accent_color'] as const) {
    const val = body[key]
    if (typeof val !== 'string' || !HEX.test(val.trim())) {
      return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
    }
    update[key] = val.trim()
  }

  // Asset URLs must be https (they come from our storage upload endpoint) or null.
  for (const key of ['logo_url', 'banner_url'] as const) {
    const val = body[key]
    if (val === null || val === undefined || val === '') {
      update[key] = null
      continue
    }
    if (typeof val !== 'string' || !/^https:\/\//.test(val)) {
      return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
    }
    update[key] = val
  }

  const service = await createServiceClient()
  const { error } = await service
    .from('tenant_settings')
    .upsert(update, { onConflict: 'tenant_id' })

  if (error) {
    log.error('PATCH /api/admin/branding', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export const PATCH = withApi('PATCH /api/admin/branding', handlePATCH)
