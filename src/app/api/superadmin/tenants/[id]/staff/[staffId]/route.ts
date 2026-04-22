import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Props { params: Promise<{ id: string; staffId: string }> }

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword() {
  return Array.from({ length: 12 }, () => PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]).join('')
}

async function assertSuperadminAndStaff(tenantId: string, staffId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'superadmin') return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const service = await createServiceClient()
  const { data: staffProfile } = await service
    .from('profiles')
    .select('id, role, tenant_id, full_name')
    .eq('id', staffId)
    .single()

  if (!staffProfile || staffProfile.tenant_id !== tenantId || staffProfile.role !== 'store-staff') {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  return { service, staffProfile }
}

export async function PATCH(_req: Request, { params }: Props) {
  const { id: tenantId, staffId } = await params
  const ctx = await assertSuperadminAndStaff(tenantId, staffId)
  if ('error' in ctx) return ctx.error

  const password = generatePassword()
  const { data: authUser, error: authError } = await ctx.service.auth.admin.getUserById(staffId)
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const email = authUser.user?.email ?? null
  if (!email) return NextResponse.json({ error: 'Staff email not found' }, { status: 400 })

  const { error: updateAuthError } = await ctx.service.auth.admin.updateUserById(staffId, {
    password,
    user_metadata: { full_name: ctx.staffProfile.full_name ?? undefined },
  })
  if (updateAuthError) return NextResponse.json({ error: updateAuthError.message }, { status: 500 })

  await ctx.service.from('profiles').update({ must_change_password: true, password_changed_at: null }).eq('id', staffId)

  return NextResponse.json({
    ok: true,
    credentials: { email, password },
    staff: { id: staffId, email, full_name: ctx.staffProfile.full_name },
  })
}

export async function DELETE(_req: Request, { params }: Props) {
  const { id: tenantId, staffId } = await params
  const ctx = await assertSuperadminAndStaff(tenantId, staffId)
  if ('error' in ctx) return ctx.error

  await ctx.service.from('profiles').update({ role: 'customer', tenant_id: null }).eq('id', staffId)
  return NextResponse.json({ ok: true })
}
