import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { checkPasswordChangeRequired } from '@/lib/auth/password-guard'
import { generatePassword } from '@/lib/auth/password-gen'

interface Props { params: Promise<{ id: string }> }

async function assertStaffOwnership(staffId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const effective = await getEffectiveTenant()
  if (!effective) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (effective.role !== 'store-admin' && effective.role !== 'superadmin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const service = await createServiceClient()

  const { data: profile } = await service
    .from('profiles')
    .select('id, role, tenant_id, full_name')
    .eq('id', staffId)
    .single()

  if (!profile || profile.tenant_id !== effective.tenantId || profile.role !== 'store-staff') {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  return { service, staffProfile: profile }
}

export async function PATCH(_req: Request, { params }: Props) {
  const guard = await checkPasswordChangeRequired()
  if (guard) return guard
  const { id } = await params
  const ctx = await assertStaffOwnership(id)
  if ('error' in ctx) return ctx.error

  const password = generatePassword()

  const { data: authUser, error: authError } = await ctx.service.auth.admin.getUserById(id)
  if (authError) {
    console.error('PATCH /api/admin/staff/[id]:', authError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const email = authUser.user?.email ?? null
  if (!email) return NextResponse.json({ error: 'Staff email not found' }, { status: 400 })

  const { error: updateAuthError } = await ctx.service.auth.admin.updateUserById(id, {
    password,
    user_metadata: { full_name: ctx.staffProfile.full_name ?? undefined },
  })
  if (updateAuthError) {
    console.error('PATCH /api/admin/staff/[id]:', updateAuthError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const { error: updateProfileError } = await ctx.service
    .from('profiles')
    .update({
      must_change_password: true,
      password_changed_at: null,
    })
    .eq('id', id)
  if (updateProfileError) {
    console.error('PATCH /api/admin/staff/[id]:', updateProfileError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    credentials: { email, password },
    staff: {
      id,
      email,
      full_name: ctx.staffProfile.full_name,
    },
  })
}

export async function DELETE(_req: Request, { params }: Props) {
  const guard = await checkPasswordChangeRequired()
  if (guard) return guard
  const { id } = await params
  const ctx = await assertStaffOwnership(id)
  if ('error' in ctx) return ctx.error

  const { error: demoteError } = await ctx.service
    .from('profiles')
    .update({ role: 'customer', tenant_id: null })
    .eq('id', id)
  if (demoteError) {
    console.error('DELETE /api/admin/staff/[id]:', demoteError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
