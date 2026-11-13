import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ownedAuthSelected } from '../auth/owned-principal'
import { hasSameOriginAdminMutation } from '../data/admin-display-settings'
import { AdminMenuError } from '../data/admin-menus'
import { tenantAdminBody } from '../admin/owned-tenant-administration-http'
import { publishPendingNativeTenantEffects } from '../tenant-effects/publish-pending'
import { ownedAccessRequests, ownedApproveAccessRequest, ownedDeclineAccessRequest, ownedReopenAccessRequest } from './admin-runtime'
import { AccessRequestError, isMissingAccessRequestsTable } from './store'

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })

function failure(error: unknown) {
  if (error instanceof AccessRequestError) return json({ error: error.message }, error.status)
  if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
  if (error instanceof SyntaxError) return json({ error: 'Invalid request body' }, 400)
  if (isMissingAccessRequestsTable(error)) return json({ error: 'Access requests are unavailable.' }, 503)
  return json({ error: 'Access requests are unavailable.' }, 503)
}

export type AccessRequestAction = 'list' | 'approve' | 'decline' | 'reopen'

export async function accessRequestAdminHttp(action: AccessRequestAction, request: Request, id?: string) {
  if (!ownedAuthSelected()) return json({ error: 'Not found' }, 404)
  try {
    if (action !== 'list' && !hasSameOriginAdminMutation(request)) return json({ error: 'Origin mismatch' }, 403)
    if (action === 'list') return json(await ownedAccessRequests())
    const target = id ?? ''
    if (action === 'reopen') return json(await ownedReopenAccessRequest(target))
    const body = await tenantAdminBody(request)
    if (action === 'decline') return json(await ownedDeclineAccessRequest(target, body))
    const result = await ownedApproveAccessRequest(target, body)
    if (result.createdTenant) {
      // The transaction already committed; queue failure leaves the effects
      // pending and never retries restaurant or account creation.
      await publishPendingNativeTenantEffects(result.tenantId).catch(() => {})
    }
    revalidatePath('/tenants')
    return json(result)
  } catch (error) { return failure(error) }
}
