import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { normalizeRole } from '@/lib/auth/role-utils'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Allow app boot without Supabase configured (useful for local setup or static pages).
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // If Supabase is unreachable, allow the request to continue
    return supabaseResponse
  }

  const pathname = request.nextUrl.pathname

  const isAdminRoute = pathname.startsWith('/dashboard') ||
    pathname.startsWith('/menu') ||
    pathname.startsWith('/settings')

  const isSuperadminRoute = pathname.startsWith('/tenants') ||
    pathname.startsWith('/overview') ||
    pathname.startsWith('/users')

  const isOnboarding = pathname === '/onboarding'

  if ((isAdminRoute || isSuperadminRoute) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  if (user && (isAdminRoute || pathname.startsWith('/menus') || isOnboarding)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, must_change_password')
      .eq('id', user.id)
      .single()

    const role = normalizeRole(profile?.role)

    // Superadmin nunca precisa de onboarding nem deve acessar rotas admin sem preview
    if (role === 'superadmin') {
      if (isOnboarding) {
        const url = request.nextUrl.clone()
        url.pathname = '/overview'
        return NextResponse.redirect(url)
      }
      if (isAdminRoute && !request.cookies.get('preview_tenant_id')?.value) {
        const url = request.nextUrl.clone()
        url.pathname = '/overview'
        return NextResponse.redirect(url)
      }
      return supabaseResponse
    }

    const mustChangePassword = profile?.must_change_password === true

    if (mustChangePassword && !pathname.startsWith('/settings/password')) {
      const url = request.nextUrl.clone()
      url.pathname = '/settings/password'
      url.searchParams.set('forced', '1')
      return NextResponse.redirect(url)
    }

    const staffBlockedRoutes = [
      '/menus',
      '/settings/store',
      '/settings/branding',
      '/settings/staff',
    ]

    if (role === 'store-staff' && staffBlockedRoutes.some((route) => pathname.startsWith(route))) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
