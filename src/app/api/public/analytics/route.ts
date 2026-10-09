import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  MAX_ANALYTICS_BODY_BYTES,
  analyticsBatchSchema,
  validateEventTimes,
} from '@/lib/analytics/contracts'

export const runtime = 'nodejs'

type SessionIdentity = {
  id: string
  tenant_id: string
  menu_id: string
  location_id: string | null
  qr_code_id: string | null
  is_test: boolean
}

function sameSessionIdentity(existing: SessionIdentity, incoming: SessionIdentity): boolean {
  return existing.id === incoming.id
    && existing.tenant_id === incoming.tenant_id
    && existing.menu_id === incoming.menu_id
    && existing.location_id === incoming.location_id
    && existing.qr_code_id === incoming.qr_code_id
    && existing.is_test === incoming.is_test
}

/**
 * Anonymous first-party menu analytics ingestion.
 *
 * The endpoint accepts only a strict event allowlist, validates all referenced
 * entities against the tenant/menu, and uses client_event_id for idempotency.
 * Analytics is deliberately independent from menu rendering and ordering.
 */
export async function POST(request: Request) {
  try {
    const rate = await rateLimit('public-menu-analytics', getClientIp(request), 30, '1 m')
    if (!rate.ok) {
      return NextResponse.json({ ok: false }, { status: 429 })
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_ANALYTICS_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 })
    }

    const rawBody = await request.text()
    if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_ANALYTICS_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: rawBody ? 413 : 400 })
    }

    let unknownBody: unknown
    try {
      unknownBody = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const parsed = analyticsBatchSchema.safeParse(unknownBody)
    if (!parsed.success || !validateEventTimes(parsed.data.events)) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const { session, events } = parsed.data
    const service = await createServiceClient()

    const [{ data: tenant }, { data: menu }, { data: location }, { data: qrCode }, { data: tenantSettings }] = await Promise.all([
      service
        .from('tenants')
        .select('id')
        .eq('id', session.tenant_id)
        .eq('is_active', true)
        .maybeSingle(),
      service
        .from('menus')
        .select('id, tenant_id')
        .eq('id', session.menu_id)
        .eq('tenant_id', session.tenant_id)
        .eq('is_active', true)
        .maybeSingle(),
      session.location_id
        ? service
            .from('locations')
            .select('id, tenant_id, menu_id')
            .eq('id', session.location_id)
            .eq('tenant_id', session.tenant_id)
            .eq('is_active', true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      session.qr_code_id
        ? service
            .from('qr_codes')
            .select('id, tenant_id')
            .eq('id', session.qr_code_id)
            .eq('tenant_id', session.tenant_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      service
        .from('tenant_settings')
        .select('analytics_enabled')
        .eq('tenant_id', session.tenant_id)
        .maybeSingle(),
    ])

    if (!tenant || !menu) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }
    if (tenantSettings?.analytics_enabled === false) {
      return NextResponse.json({ ok: true, received: 0, disabled: true })
    }
    if (session.location_id && (!location || (location.menu_id && location.menu_id !== session.menu_id))) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    if (session.qr_code_id && !qrCode) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const productIds = Array.from(new Set(events.flatMap((event) => event.product_id ? [event.product_id] : [])))
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await service
        .from('products')
        .select('id, menu_id')
        .eq('tenant_id', session.tenant_id)
        .in('id', productIds)

      if (productsError) {
        console.error('analytics.products_validation_error', productsError)
        return NextResponse.json({ ok: false }, { status: 500 })
      }
      const validProductIds = new Set(
        (products ?? [])
          .filter((product) => product.menu_id === session.menu_id)
          .map((product) => product.id),
      )
      if (productIds.some((id) => !validProductIds.has(id))) {
        return NextResponse.json({ ok: false }, { status: 400 })
      }
    }

    const categoryIds = Array.from(new Set(events.flatMap((event) => event.category_id ? [event.category_id] : [])))
    if (categoryIds.length > 0) {
      const { data: categories, error: categoriesError } = await service
        .from('categories')
        .select('id, menu_id')
        .eq('tenant_id', session.tenant_id)
        .in('id', categoryIds)

      if (categoriesError) {
        console.error('analytics.categories_validation_error', categoriesError)
        return NextResponse.json({ ok: false }, { status: 500 })
      }
      const validCategoryIds = new Set(
        (categories ?? [])
          .filter((category) => category.menu_id === session.menu_id)
          .map((category) => category.id),
      )
      if (categoryIds.some((id) => !validCategoryIds.has(id))) {
        return NextResponse.json({ ok: false }, { status: 400 })
      }
    }

    const incomingIdentity: SessionIdentity = {
      id: session.id,
      tenant_id: session.tenant_id,
      menu_id: session.menu_id,
      location_id: session.location_id ?? null,
      qr_code_id: session.qr_code_id ?? null,
      is_test: session.is_test,
    }
    const { data: existingSession, error: existingSessionError } = await service
      .from('menu_sessions')
      .select('id, tenant_id, menu_id, location_id, qr_code_id, is_test')
      .eq('id', session.id)
      .maybeSingle()

    if (existingSessionError) {
      console.error('analytics.session_lookup_error', existingSessionError)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
    if (existingSession && !sameSessionIdentity(existingSession as SessionIdentity, incomingIdentity)) {
      return NextResponse.json({ ok: false }, { status: 409 })
    }

    const now = new Date().toISOString()
    if (existingSession) {
      const { error } = await service
        .from('menu_sessions')
        .update({ last_seen_at: now })
        .eq('id', session.id)
        .eq('tenant_id', session.tenant_id)
      if (error) {
        console.error('analytics.session_update_error', error)
        return NextResponse.json({ ok: false }, { status: 500 })
      }
    } else {
      const { error } = await service.from('menu_sessions').insert({
        ...incomingIdentity,
        entry_source: session.entry_source,
        device_class: session.device_class,
        language: session.language ?? null,
        started_at: now,
        last_seen_at: now,
      })
      if (error) {
        console.error('analytics.session_create_error', error)
        return NextResponse.json({ ok: false }, { status: 500 })
      }
    }

    const rows = events.map((event) => ({
      client_event_id: event.client_event_id,
      tenant_id: session.tenant_id,
      session_id: session.id,
      menu_id: session.menu_id,
      location_id: session.location_id ?? null,
      product_id: event.product_id ?? null,
      category_id: event.category_id ?? null,
      event_name: event.event_name,
      occurred_at: event.occurred_at,
      duration_ms: event.duration_ms ?? null,
      quantity: event.quantity ?? null,
      source: event.source ?? null,
      media_type: event.media_type ?? null,
      media_index: event.media_index ?? null,
      query_length: event.query_length ?? null,
    }))

    const { error: insertError } = await service
      .from('menu_events')
      .upsert(rows, { onConflict: 'client_event_id', ignoreDuplicates: true })

    if (insertError) {
      console.error('analytics.events_insert_error', insertError)
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    return NextResponse.json({ ok: true, received: events.length })
  } catch (error) {
    console.error('analytics.ingest_error', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
