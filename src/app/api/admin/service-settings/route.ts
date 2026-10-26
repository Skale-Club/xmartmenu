/**
 * PATCH /api/admin/service-settings — the one place the restaurant's service
 * switches are saved (orders, guest/waiter ordering, WhatsApp, checkout
 * extras, KDS thresholds). Owner only.
 *
 * Body: any subset of SERVICE_SETTINGS_KEYS (src/lib/service-settings.ts).
 *   400 { error, errors }            invalid values
 *   403 { error, locked: [keys] }    switching on something the plan lacks
 *   200 { ok, settings, capabilities }
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'
import { resolveTenantCapabilities, type ServiceSettings } from '@/lib/service-modes'
import { SERVICE_SETTINGS_KEYS, validateServiceSettingsPatch } from '@/lib/service-settings'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

export const dynamic = 'force-dynamic'

const COLUMNS = ['tenant_id', ...SERVICE_SETTINGS_KEYS].join(', ')

async function handlePATCH(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role !== 'store-admin' && effective.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const service = createServiceClient()

  const [plan, currentResult] = await Promise.all([
    getTenantPlan(effective.tenantId, service).catch(() => null),
    service.from('tenant_settings').select(COLUMNS).eq('tenant_id', effective.tenantId).maybeSingle(),
  ])
  if (currentResult.error) {
    log.error('PATCH /api/admin/service-settings', { err: currentResult.error })
    return NextResponse.json({ error: 'Could not load settings' }, { status: 500 })
  }
  const features = plan?.features ?? null
  const current = (currentResult.data ?? null) as unknown as Record<string, unknown> | null
  const capabilities = resolveTenantCapabilities(features, current as ServiceSettings | null)

  const { patch, locked, errors } = validateServiceSettingsPatch(body, capabilities, current)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 })
  }
  if (locked.length > 0) {
    return NextResponse.json({ error: 'Not included in your plan', locked }, { status: 403 })
  }

  const { data, error } = await service
    .from('tenant_settings')
    .upsert({
      tenant_id: effective.tenantId,
      ...patch,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })
    .select(COLUMNS)
    .single()

  if (error || !data) {
    log.error('PATCH /api/admin/service-settings', { err: error })
    return NextResponse.json({ error: 'Could not save settings' }, { status: 500 })
  }

  const settings = data as unknown as ServiceSettings
  return NextResponse.json({
    ok: true,
    settings: data,
    capabilities: resolveTenantCapabilities(features, settings),
  })
}

export const PATCH = withApi('PATCH /api/admin/service-settings', handlePATCH)
