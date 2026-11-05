import {NextResponse} from 'next/server'
import {nativeBlogSelected} from '@/lib/blog/native/selected'
import {nativeBlogAdminHttp} from '@/lib/blog/native/admin-http'
import {withApi} from '@/lib/observability/with-api'
/**
 * Native blog operations awaiting review (reconcile, or running past its
 * window after a deploy). GET lists them; POST { operationId } closes one as
 * failed so the tenant can retry. Audited, superadmin only, native blog only.
 */
async function handleGET() {
  if (!nativeBlogSelected()) return NextResponse.json({ error: 'Native blog is not enabled' }, { status: 404 })
  return nativeBlogAdminHttp('operations')
}
async function handlePOST(request: Request) {
  if (!nativeBlogSelected()) return NextResponse.json({ error: 'Native blog is not enabled' }, { status: 404 })
  return nativeBlogAdminHttp('operations', request)
}

export const GET = withApi('GET /api/superadmin/blog/operations', handleGET)
export const POST = withApi('POST /api/superadmin/blog/operations', handlePOST)
