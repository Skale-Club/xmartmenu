import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Props { params: Promise<{ id: string }> }

const DEFAULT_STAFF_PASSWORD = process.env.DEFAULT_STAFF_PASSWORD?.trim() || 'Staff@12345'

async function assertSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'superadmin' ? true : null
}

export async function GET(_req: Request, { params }: Props) {
  const { id: tenantId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('id, full_name, phone, created_at')
    .eq('tenant_id', tenantId)
    .eq('role', 'store-staff')
    .order('created_at', { ascending: false })

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

export async function POST(request: Request, { params }: Props) {
  const { id: tenantId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      tenant_id: tenantId,
      role: 'store-staff',
      full_name: name.trim(),
      must_change_password: true,
      password_changed_at: null,
    }, { onConflict: 'id' })

    await service.auth.admin.updateUserById(userData.user.id, {
      user_metadata: { full_name: name.trim() },
    })
  }

  return NextResponse.json({
    ok: true,
    staff: { id: userData.user?.id ?? null, email, full_name: name.trim() },
    credentials: { email, password: DEFAULT_STAFF_PASSWORD },
  }, { status: 201 })
}
