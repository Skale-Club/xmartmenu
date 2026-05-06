import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { checkPasswordChangeRequired } from '@/lib/auth/password-guard'

async function assertStoreAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const effective = await getEffectiveTenant()
  if (!effective) return null
  if (effective.role !== 'store-admin' && effective.role !== 'superadmin') return null
  return { supabase, tenantId: effective.tenantId }
}

const DEFAULT_STAFF_PASSWORD = process.env.DEFAULT_STAFF_PASSWORD?.trim() || 'Staff@12345'

export async function GET() {
  const ctx = await assertStoreAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('id, full_name, phone, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('role', 'store-staff')
    .order('created_at', { ascending: false })

  // Fetch emails from auth.users
  const ids = (data ?? []).map(p => p.id)
  const staffWithEmail = await Promise.all(
    ids.map(async (id) => {
      const { data: u } = await service.auth.admin.getUserById(id)
      const profile = data!.find(p => p.id === id)!
      return { ...profile, email: u.user?.email ?? null }
    })
  )

  return NextResponse.json(staffWithEmail)
}

export async function POST(request: Request) {
  const guard = await checkPasswordChangeRequired()
  if (guard) return guard
  const ctx = await assertStoreAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, email } = body
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: userData, error: userError } = await service.auth.admin.createUser({
    email,
    password: DEFAULT_STAFF_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name.trim() },
  })

  if (userError) {
    if (userError.message.includes('already been registered')) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 409 })
    }
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  if (userData.user) {
    await service.from('profiles').upsert({
      id: userData.user.id,
      tenant_id: ctx.tenantId,
      role: 'store-staff',
      full_name: name.trim(),
      must_change_password: true,
      password_changed_at: null,
    }, { onConflict: 'id' })

    // Ensure auth metadata keeps the staff name (and never tenant/store name).
    await service.auth.admin.updateUserById(userData.user.id, {
      user_metadata: { full_name: name.trim() },
    })
  }

  return NextResponse.json({
    ok: true,
    staff: {
      id: userData.user?.id ?? null,
      email,
      full_name: name.trim(),
    },
    credentials: { email, password: DEFAULT_STAFF_PASSWORD },
  }, { status: 201 })
}
