import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { hasSameOriginAdminMutation } from '@/lib/data/admin-display-settings'
import { LockedServiceSettingsError } from '@/lib/data/admin-store-settings'
import { markOwnedCustomDomainVerified, mutateOwnedCustomDomain, mutateOwnedServiceSettings, mutateOwnedStoreSettings } from '@/lib/data/admin-store-settings-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

function errorResponse(error: unknown, label: string) {
  if (error instanceof LockedServiceSettingsError) return json({ error: error.message, locked: error.locked }, 403)
  if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
  if (error instanceof SyntaxError) return json({ error: 'Invalid request body' }, 400)
  return json({ error: `${label} service is unavailable` }, 503)
}

async function contextForMutation(request: Request, tenantId?: string) {
  if (!hasSameOriginAdminMutation(request)) return { response: json({ error: 'Origin mismatch' }, 403) }
  const effective = await getEffectiveTenant()
  if (!effective) return { response: json({ error: 'Unauthorized' }, 401) }
  if (effective.role === 'store-staff') return { response: json({ error: 'Forbidden' }, 403) }
  if (tenantId !== undefined && tenantId !== effective.tenantId) return { response: json({ error: 'Forbidden' }, 403) }
  return { context: { tenantId: effective.tenantId, role: effective.role } }
}

export async function ownedStoreSettingsHttp(request: Request) {
  try {
    const { response, context } = await contextForMutation(request)
    if (response) return response
    const result = await mutateOwnedStoreSettings(context!, await request.json())
    return json({ ok: true, ...result })
  } catch (error) { return errorResponse(error, 'Store settings') }
}

export async function ownedServiceSettingsHttp(request: Request) {
  try {
    const { response, context } = await contextForMutation(request)
    if (response) return response
    const result = await mutateOwnedServiceSettings(context!, await request.json())
    return json({ ok: true, ...result })
  } catch (error) { return errorResponse(error, 'Service settings') }
}

export async function ownedCustomDomainHttp(request: Request, tenantId: string) {
  try {
    const { response, context } = await contextForMutation(request, tenantId)
    if (response) return response
    const body = await request.json() as { custom_domain?: unknown }
    const tenant = await mutateOwnedCustomDomain(context!, tenantId, body?.custom_domain)
    return json({ tenant })
  } catch (error) { return errorResponse(error, 'Tenant settings') }
}

export async function ownedCustomDomainVerificationHttp(request: Request, tenantId: string, domain: string, reason: string) {
  try {
    const { response, context } = await contextForMutation(request, tenantId)
    if (response) return response
    await markOwnedCustomDomainVerified(context!, tenantId, domain, true)
    return json({ verified: true, domain, reason })
  } catch (error) { return errorResponse(error, 'Tenant settings') }
}
