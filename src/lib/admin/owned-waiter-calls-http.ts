import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getRequestContext } from '@/lib/observability/context'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { hasSameOriginAdminMutation } from '@/lib/data/admin-display-settings'
import { readOwnedAdminWaiterCalls, updateOwnedAdminWaiterCall } from '@/lib/data/admin-waiter-calls-runtime'

const json = (body: object, status = 200) => NextResponse.json(body,{ status,headers: { 'Cache-Control': 'private, no-store' } })
async function readStatus(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AdminMenuError(400,'Invalid status')
  const reader = request.body?.getReader()
  if (!reader) throw new AdminMenuError(400,'Invalid status')
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_,reject) => { timeout = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new AdminMenuError(400,'Invalid status')) },5000) })
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const part = await Promise.race([reader.read(),deadline])
      if (part.done) break
      size += part.value.byteLength
      if (size > 2048) { void reader.cancel().catch(() => {}); throw new AdminMenuError(400,'Invalid status') }
      chunks.push(part.value)
    }
  } finally { clearTimeout(timeout); reader.releaseLock() }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'status')) throw new AdminMenuError(400,'Invalid status')
  return (body as { status?: unknown }).status
}

export async function ownedWaiterCallsHttp(request: Request, id?: string) {
  try {
    if (id !== undefined && !hasSameOriginAdminMutation(request)) return json({ error: 'Origin mismatch' },403)
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' },401)
    let actorId: string | undefined
    if (ownedAuthSelected()) {
      const principal = await getOwnedPrincipal()
      if (!principal || principal.mustChangePassword || principal.role !== effective.role
        || (principal.role !== 'superadmin' && principal.tenantId !== effective.tenantId)) return json({ error: 'Unauthorized' },401)
      actorId = principal.userId
    } else {
      // withApi opens this request context; getEffectiveTenant has populated it
      // from an independently verified source user. Never use a supplied ID.
      actorId = getRequestContext()?.actorId
    }
    if (!actorId) return json({ error: 'Unauthorized' },401)
    const context = { tenantId: effective.tenantId,role: effective.role,actorId }
    return json(id === undefined ? await readOwnedAdminWaiterCalls(context)
      : await updateOwnedAdminWaiterCall(context,id,await readStatus(request)))
  } catch (error) {
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message },error.status)
    if (error instanceof SyntaxError) return json({ error: 'Invalid status' },400)
    return json({ error: 'Waiter call service is unavailable' },503)
  }
}
