import { NextResponse } from 'next/server'
import { getRequestOrigin } from '@/lib/site-url'
import { getSafeExitPreviewDestination } from '@/lib/admin/tenant-management'
import { withApi } from '@/lib/observability/with-api'

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = getRequestOrigin(request)
  const destination = getSafeExitPreviewDestination(searchParams.get('next'))
  const response = NextResponse.redirect(`${origin}${destination}`)
  response.cookies.delete('preview_tenant_id')
  return response
}

export const GET = withApi('GET /api/admin/exit-preview', handleGET)
