import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * PATCH /api/admin/seo
 * SEED-014: server-side save for per-tenant SEO overrides. Caps text fields,
 * validates the optional OG image URL (https), coerces the noindex flag, and
 * scopes the write to the caller's own tenant. Empty strings persist as NULL so
 * the public pages fall back to derived values.
 */
export async function PATCH(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim().slice(0, max)
    return t ? t : null
  }

  // Optional OG image override must be an https URL (from our upload endpoint) or null.
  let ogImage: string | null = null
  const rawOg = body.seo_og_image_url
  if (rawOg !== null && rawOg !== undefined && rawOg !== '') {
    if (typeof rawOg !== 'string' || !/^https:\/\//.test(rawOg.trim())) {
      return NextResponse.json({ error: 'Invalid seo_og_image_url' }, { status: 400 })
    }
    ogImage = rawOg.trim().slice(0, 2048)
  }

  const update: Record<string, unknown> = {
    tenant_id: effective.tenantId,
    seo_title: str(body.seo_title, 70),
    seo_description: str(body.seo_description, 200),
    seo_keywords: str(body.seo_keywords, 300),
    seo_og_image_url: ogImage,
    seo_noindex: body.seo_noindex === true,
  }

  const service = await createServiceClient()
  const { error } = await service
    .from('tenant_settings')
    .upsert(update, { onConflict: 'tenant_id' })

  if (error) {
    console.error('PATCH /api/admin/seo:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
