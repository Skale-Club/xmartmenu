import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const response = NextResponse.redirect(`${origin}/tenants`)
  response.cookies.delete('preview_tenant_id')
  return response
}
