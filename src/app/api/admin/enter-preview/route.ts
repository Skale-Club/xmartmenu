import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getSafePreviewDestination } from '@/lib/admin/tenant-management'
import { NextResponse } from 'next/server'
import { getRequestOrigin } from '@/lib/site-url'
import { withApi } from '@/lib/observability/with-api'
import { ownedPrincipalRepository } from '@/lib/auth/owned-principal-runtime'

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = getRequestOrigin(request)
  const tenantId = searchParams.get('tenant')
  if (!tenantId) return NextResponse.redirect(`${origin}/tenants`)

  const authorization = await assertSuperadmin()
  if (!authorization) return NextResponse.redirect(`${origin}/auth/login`)
  if (authorization.mode === 'owned' && !await ownedPrincipalRepository().previewTenant(authorization.principal, tenantId)) return NextResponse.redirect(`${origin}/tenants`)

  const destination = getSafePreviewDestination(searchParams.get('next'))
  const response = NextResponse.redirect(`${origin}${destination}`)
  response.cookies.set('preview_tenant_id', tenantId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}

export const GET = withApi('GET /api/admin/enter-preview', handleGET)
