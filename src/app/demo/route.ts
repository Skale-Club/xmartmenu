import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// The demo signs a visitor straight into the sample restaurant's admin panel
// in the role of the owner. It is self-healing: on every hit it guarantees the
// demo owner account exists, resets its password to the known demo value (so a
// visitor changing it can never lock the demo), and re-binds the owner profile
// to the demo tenant. No real auth state is required to reach /demo.
export const dynamic = 'force-dynamic'

const DEMO_SLUG = 'bella-vista'
const DEMO_EMAIL = process.env.DEMO_OWNER_EMAIL || 'demo-owner@xmartmenu.local'
const DEMO_PASSWORD = process.env.DEMO_OWNER_PASSWORD || 'XmartDemo2026!'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const service = createServiceClient()

  // 1. Resolve the demo tenant. If it is not seeded, fall back to the home page.
  const { data: tenant } = await service
    .from('tenants')
    .select('id')
    .eq('slug', DEMO_SLUG)
    .single()
  if (!tenant) return NextResponse.redirect(`${origin}/`)

  // 2. Ensure the demo owner account exists with the known password.
  let userId: string | null = null
  const { data: created } = await service.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Owner' },
  })

  if (created?.user) {
    userId = created.user.id
  } else {
    // Already exists — look it up and reset the password so login always works.
    const { data: list } = await service.auth.admin.listUsers({ page: 1, perPage: 200 })
    const existing = list?.users.find(
      (u) => u.email?.toLowerCase() === DEMO_EMAIL.toLowerCase(),
    )
    if (existing) {
      userId = existing.id
      await service.auth.admin.updateUserById(existing.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
      })
    }
  }
  if (!userId) return NextResponse.redirect(`${origin}/`)

  // 3. Bind the owner profile to the demo tenant (idempotent).
  await service.from('profiles').upsert(
    { id: userId, role: 'store-admin', tenant_id: tenant.id, full_name: 'Demo Owner' },
    { onConflict: 'id' },
  )

  // 4. Sign in (writes the auth cookies) and flag demo mode for the banner.
  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  })
  if (signInError) return NextResponse.redirect(`${origin}/auth/login`)

  const cookieStore = await cookies()
  cookieStore.set('xm_demo', '1', { path: '/', sameSite: 'lax' })

  return NextResponse.redirect(`${origin}/dashboard`)
}
