import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * PATCH /api/admin/branding
 * Server-side save for tenant branding/settings (S02/S04 hardening). Replaces the
 * previous direct client-side tenant_settings write: validates colors (hex),
 * caps text fields, coerces booleans, and scopes to the caller's own tenant.
 */
export async function PATCH(request: Request) {
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
    whatsapp: str(body.whatsapp, 32),
    tagline: str(body.tagline, 120),
    whatsapp_orders_enabled: body.whatsapp_orders_enabled === true,
    orders_enabled: body.orders_enabled === true,
    direct_orders_enabled: body.direct_orders_enabled === true,
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
    console.error('PATCH /api/admin/branding:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
