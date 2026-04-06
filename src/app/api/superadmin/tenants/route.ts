import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function assertSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'superadmin' ? supabase : null
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

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
    return NextResponse.json({ error: 'Nome, slug e email são obrigatórios' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Slug já existe. Escolha outro.' }, { status: 400 })
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ name, slug, plan: plan ?? 'free' })
    .select()
    .single()

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Erro ao criar tenant' }, { status: 500 })
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
    return NextResponse.json({ error: `Erro ao criar usuário: ${userError.message}` }, { status: 500 })
  }

  if (userData.user) {
    await service.from('profiles')
      .upsert({ id: userData.user.id, tenant_id: tenant.id, role: 'admin' })
  }

  return NextResponse.json({
    tenant,
    credentials: { email, password: tempPassword },
  }, { status: 201 })
}
