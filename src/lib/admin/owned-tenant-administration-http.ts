import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { hasSameOriginAdminMutation } from '../data/admin-display-settings'
import { AdminMenuError } from '../data/admin-menus'
import { ownedPlans,ownedTenants,ownedTenantSettings,ownedTenantMenuRows } from '../data/tenant-administration-runtime'

const json = (value: unknown,status = 200) => NextResponse.json(value,{ status,headers:{ 'Cache-Control':'private, no-store' } })
const failure = (error: unknown) => error instanceof AdminMenuError && error.status < 500 ? json({ error:error.message },error.status)
  : error instanceof SyntaxError ? json({ error:'Invalid request body' },400) : json({ error:'Tenant administration is unavailable' },503)
export async function tenantAdminBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AdminMenuError(400,'JSON body required')
  if (Number(request.headers.get('content-length') ?? 0) > 65536) throw new AdminMenuError(413,'Request is too large')
  const reader = request.body?.getReader(); if (!reader) throw new AdminMenuError(400,'Invalid body')
  let size = 0,text = '',timer: ReturnType<typeof setTimeout>|undefined; const decoder = new TextDecoder()
  const deadline = new Promise<never>((_,reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new AdminMenuError(400,'Request timed out')) },5000) })
  try { for (;;) { const next = await Promise.race([reader.read(),deadline]); if (next.done) break
    size += next.value.byteLength; if (size > 65536) throw new AdminMenuError(413,'Request is too large'); text += decoder.decode(next.value,{ stream:true }) }
    return JSON.parse(text+decoder.decode()) as unknown
  } finally { clearTimeout(timer); reader.releaseLock() }
}
export async function ownedTenantAdministrationHttp(kind: 'plans'|'tenants'|'settings'|'menus'|'categories'|'products',request?: Request,id?: string,menuId?: string) {
  try {
    const method = request?.method ?? 'GET'
    if (method !== 'GET' && (!request || !hasSameOriginAdminMutation(request))) return json({ error:'Origin mismatch' },403)
    const input = request && ['POST','PUT','PATCH'].includes(method) ? await tenantAdminBody(request) : undefined
    if (['menus','categories','products'].includes(kind)) return json(await ownedTenantMenuRows(id ?? '',menuId,kind as 'menus'|'categories'|'products',request ? new URL(request.url).searchParams.get('categoryId') : null))
    if (kind === 'settings') return json(await ownedTenantSettings(id ?? '',input))
    const action = method === 'GET' ? 'read' : method === 'DELETE' ? 'delete' : method === 'POST' ? 'create' : 'update'
    const result = kind === 'plans' ? await ownedPlans(action,id,input) : await ownedTenants(action,id,input)
    if (kind === 'tenants' && action !== 'read') { revalidatePath('/tenants'); if (result && typeof result === 'object' && 'slug' in result) revalidatePath(`/${result.slug}`,'layout') }
    return kind === 'plans' && action === 'delete' ? new NextResponse(null,{ status:204,headers:{ 'Cache-Control':'private, no-store' } }) : json(result,action === 'create' ? 201 : 200)
  } catch (error) { return failure(error) }
}
