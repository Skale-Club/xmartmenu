import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const service = await createServiceClient()
        const { data: profile } = await service
          .from('profiles')
          .select('role, tenant_id')
          .eq('id', user.id)
          .single()

        if (profile?.role === 'superadmin') {
          return NextResponse.redirect(`${origin}/overview`)
        }

        // Garante que o profile existe e tem role válido
        if (!profile || !['superadmin', 'store-admin', 'store-staff', 'customer'].includes(profile.role)) {
          await service.from('profiles').upsert({
            id: user.id,
            role: 'store-admin',
            full_name: user.user_metadata?.full_name ?? null,
          }, { onConflict: 'id' })
          return NextResponse.redirect(`${origin}/onboarding`)
        }

        // Usuário com role correto mas sem tenant → onboarding
        if (!profile.tenant_id) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }

        return NextResponse.redirect(`${origin}/dashboard`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
