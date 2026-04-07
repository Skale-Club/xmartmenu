import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tenantId = searchParams.get('tenant')
  if (!tenantId) return NextResponse.redirect(`${origin}/tenants`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/auth/login`)

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'superadmin') return NextResponse.redirect(`${origin}/tenants`)

  const response = NextResponse.redirect(`${origin}/dashboard`)
  response.cookies.set('preview_tenant_id', tenantId, { path: '/', httpOnly: true, sameSite: 'lax' })
  return response
}
