import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tenantId = searchParams.get('tenant')
  if (!tenantId) return NextResponse.redirect(`${origin}/tenants`)

  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.redirect(`${origin}/auth/login`)

  const response = NextResponse.redirect(`${origin}/dashboard`)
  response.cookies.set('preview_tenant_id', tenantId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
