import { NextResponse } from 'next/server'
import { getSafeExitPreviewDestination } from '@/lib/admin/tenant-management'
import { withApi } from '@/lib/observability/with-api'

async function handleGET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const destination = getSafeExitPreviewDestination(searchParams.get('next'))
  const response = NextResponse.redirect(`${origin}${destination}`)
  response.cookies.delete('preview_tenant_id')
  return response
}

export const GET = withApi('GET /api/admin/exit-preview', handleGET)
