import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { generatePassword } from '@/lib/auth/password-gen'
import { validateTenantSlug } from '@/lib/admin/tenant-management'
import { enqueueXphereSync } from '@/lib/xphere/queue'

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
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const requestedPlanId = typeof body?.plan_id === 'string' ? body.plan_id.trim() : ''
  const slugResult = validateTenantSlug(body?.slug)

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'A valid restaurant name and admin email are required.' }, { status: 400 })
  }
  if (!slugResult.ok) return NextResponse.json({ error: slugResult.error }, { status: 400 })

  const service = await createServiceClient()
  const { data: selectedPlan, error: planError } = requestedPlanId
    ? await service.from('plans').select('id, name, slug').eq('id', requestedPlanId).eq('is_active', true).maybeSingle()
    : await service.from('plans').select('id, name, slug').eq('slug', 'menu').eq('is_active', true).maybeSingle()

  if (planError || !selectedPlan) {
    return NextResponse.json({ error: 'Select an active subscription plan.' }, { status: 400 })
  }

  const { data: existing } = await service
    .from('tenants')
    .select('id')
    .eq('slug', slugResult.slug)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'This restaurant URL is already in use.' }, { status: 409 })
  }

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({ name, slug: slugResult.slug, plan: selectedPlan.slug })
    .select()
    .single()

  if (tenantError || !tenant) {
    console.error('POST /api/superadmin/tenants create tenant:', tenantError)
    return NextResponse.json({ error: 'Failed to create the restaurant.' }, { status: 500 })
  }

  let createdUserId: string | null = null
  const cleanup = async () => {
    if (createdUserId) await service.auth.admin.deleteUser(createdUserId)
    await service.from('tenants').delete().eq('id', tenant.id)
  }

  const { error: settingsError } = await service.from('tenant_settings').insert({ tenant_id: tenant.id })
  if (settingsError) {
    console.error('POST /api/superadmin/tenants create settings:', settingsError)
    await cleanup()
    return NextResponse.json({ error: 'Failed to create restaurant settings.' }, { status: 500 })
  }

  const { data: subscription, error: subscriptionError } = await service
    .from('tenant_subscriptions')
    .insert({
      tenant_id: tenant.id,
      plan_id: selectedPlan.id,
      billing_cycle: 'monthly',
      status: 'active',
    })
    .select('tenant_id, plan_id, status, plan:plans(id, name, slug)')
    .single()
  if (subscriptionError || !subscription) {
    console.error('POST /api/superadmin/tenants create subscription:', subscriptionError)
    await cleanup()
    return NextResponse.json({ error: 'Failed to assign the subscription plan.' }, { status: 500 })
  }

  const { error: menuError } = await service.from('menus').insert({
    tenant_id: tenant.id,
    name: 'Main Menu',
    slug: 'main',
    language: 'en',
    supported_languages: ['en'],
    purpose: 'restaurant',
    is_active: true,
    is_default: true,
    position: 0,
  })
  if (menuError) {
    console.error('POST /api/superadmin/tenants create menu:', menuError)
    await cleanup()
    return NextResponse.json({ error: 'Failed to create the default menu.' }, { status: 500 })
  }

  const tempPassword = generatePassword()
  const { data: userData, error: userError } = await service.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { tenant_id: tenant.id },
  })

  if (userError || !userData.user) {
    console.error('POST /api/superadmin/tenants create owner:', userError)
    await cleanup()
    const duplicate = userError?.message.toLowerCase().includes('already')
    return NextResponse.json(
      { error: duplicate ? 'This admin email is already registered.' : 'Failed to create the restaurant administrator.' },
      { status: duplicate ? 409 : 500 },
    )
  }
  createdUserId = userData.user.id

  const { error: profileError } = await service.from('profiles').upsert({
    id: userData.user.id,
    tenant_id: tenant.id,
    role: 'store-admin',
    must_change_password: true,
    password_changed_at: null,
  }, { onConflict: 'id' })
  if (profileError) {
    console.error('POST /api/superadmin/tenants create owner profile:', profileError)
    await cleanup()
    return NextResponse.json({ error: 'Failed to link the administrator to the restaurant.' }, { status: 500 })
  }

  await enqueueXphereSync(tenant.id, 'onboarded')

  return NextResponse.json({
    tenant,
    subscription,
    owner_id: userData.user.id,
    credentials: { email, password: tempPassword },
  }, { status: 201 })
}
