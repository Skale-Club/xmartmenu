import { NextResponse } from 'next/server'
import { getSafeExitPreviewDestination } from '@/lib/admin/tenant-management'

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const destination = getSafeExitPreviewDestination(searchParams.get('next'))
  const response = NextResponse.redirect(`${origin}${destination}`)
  response.cookies.delete('preview_tenant_id')
  return response
}
