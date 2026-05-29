import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { generatePassword } from '@/lib/auth/password-gen'

export async function GET() {
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('tenants')
    .select('*, tenant_settings(logo_url)')
    .order('created_at', { ascending: false })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, slug, email, plan } = body

  if (!name || !slug || !email) {
    return NextResponse.json({ error: 'Name, slug and email are required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Slug already exists. Choose another one.' }, { status: 400 })
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ name, slug, plan: plan ?? 'free' })
    .select()
    .single()

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Error creating tenant' }, { status: 500 })
  }

  await supabase.from('tenant_settings').insert({ tenant_id: tenant.id })

  const service = await createServiceClient()
  const tempPassword = generatePassword()

  const { data: userData, error: userError } = await service.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { tenant_id: tenant.id },
  })

  if (userError) {
    await service.from('tenants').delete().eq('id', tenant.id)
    console.error('POST /api/superadmin/tenants:', userError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (userData.user) {
    await service.from('profiles')
      .upsert({
        id: userData.user.id,
        tenant_id: tenant.id,
        role: 'store-admin',
        must_change_password: true,
        password_changed_at: null,
      })
  }

  return NextResponse.json({
    tenant,
    credentials: { email, password: tempPassword },
  }, { status: 201 })
}
