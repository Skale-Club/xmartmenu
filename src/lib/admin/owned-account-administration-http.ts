import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '../get-effective-tenant'
import { hasSameOriginAdminMutation } from '../data/admin-display-settings'
import { AdminMenuError } from '../data/admin-menus'
import { accountAdministrationMutation, readOwnedAdminAccounts, readOwnedStaffAccounts,requireAccountAdministration } from '../data/account-administration-runtime'

const json = (body: unknown,status = 200) => NextResponse.json(body,{ status,headers:{ 'Cache-Control':'private, no-store' } })
const error = (failure: unknown) => failure instanceof AdminMenuError && failure.status < 500 ? json({ error:failure.message },failure.status)
  : failure instanceof SyntaxError ? json({ error:'Invalid request body' },400) : json({ error:'Account administration is unavailable' },503)
async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AdminMenuError(400,'JSON body required')
  if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new AdminMenuError(413,'Request is too large')
  const reader = request.body?.getReader(); if (!reader) throw new AdminMenuError(400,'Invalid body')
  let size = 0,text = ''; const decoder = new TextDecoder()
  let timer: ReturnType<typeof setTimeout>|undefined
  const deadline = new Promise<never>((_,reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new AdminMenuError(400,'Request timed out')) },5000) })
  try { for (;;) { const next = await Promise.race([reader.read(),deadline]); if (next.done) break
    size += next.value.byteLength; if (size > 4096) throw new AdminMenuError(413,'Request is too large'); text += decoder.decode(next.value,{ stream:true }) }
    const result: unknown = JSON.parse(text+decoder.decode()); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new AdminMenuError(400,'Invalid body')
    return result as Record<string,unknown>
  } finally { clearTimeout(timer); reader.releaseLock() }
}
export async function ownedAccountsHttp(request?: Request,id?: string) {
  try {
    if (!request || request.method === 'GET') return json(await readOwnedAdminAccounts())
    if (!hasSameOriginAdminMutation(request)) return json({ error:'Origin mismatch' },403)
    if (request.method === 'DELETE') return json(await accountAdministrationMutation('disable',id!))
    return json(await accountAdministrationMutation('update',id!,await body(request)))
  } catch (failure) { return error(failure) }
}
export async function ownedStaffAccountsHttp(request: Request,staffId?: string,explicitTenant?: string) {
  try {
    requireAccountAdministration()
    if (request.method !== 'GET' && !hasSameOriginAdminMutation(request)) return json({ error:'Origin mismatch' },403)
    let tenantId = explicitTenant
    if (!tenantId) {
      const effective = await getEffectiveTenant()
      if (!effective || !['superadmin','store-admin'].includes(effective.role)) return json({ error:'Forbidden' },403)
      tenantId = effective.tenantId
    } else {
      // Explicit cross-tenant routes are global-admin only, rechecked in SQL.
      const { accountAdministrationContext } = await import('../data/account-administration-runtime')
      const context = await accountAdministrationContext()
      const { getOwnedPrincipal } = await import('../auth/owned-principal-runtime')
      if (!(await getOwnedPrincipal()) || (await getOwnedPrincipal())?.role !== 'superadmin' || !context.actorId) return json({ error:'Forbidden' },403)
    }
    if (request.method === 'GET') return json(await readOwnedStaffAccounts(tenantId,!!explicitTenant))
    if (request.method === 'DELETE') return json(await accountAdministrationMutation('remove-staff',staffId!,undefined,tenantId,!!explicitTenant))
    const input = request.method === 'POST' ? await body(request) : null
    if (input && (Object.keys(input).length !== 1 || typeof input.recipient_user_id !== 'string')) return json({ error:'Choose the exact verified recipient account ID' },400)
    const result = await accountAdministrationMutation(request.method === 'POST' ? 'invite' : 'recovery',input ? String(input.recipient_user_id) : staffId!,undefined,tenantId,!!explicitTenant)
    const access = result as { id:string; code:string; expires_at:string; kind:string; recipient_user_id:string }
    const url = `/staff-access?${access.kind}=${encodeURIComponent(access.code)}`
    return json({ ok:true,[access.kind === 'invite' ? 'invitation' : 'recovery']:{ id:access.id,url,expires_at:access.expires_at,recipient_user_id:access.recipient_user_id },
      ...(access.kind === 'recovery' ? { sessionsRevoked:true } : {}) },request.method === 'POST' ? 201 : 200)
  } catch (failure) { return error(failure) }
}
