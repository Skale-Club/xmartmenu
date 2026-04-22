import { createServiceClient } from '@/lib/supabase/server'
import { isSuperadminRequest } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

async function assertSuperadmin() {
  return await isSuperadminRequest() ? true : null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const service = await createServiceClient()

  const rawRole = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : null
  const rawTenantId = typeof body.tenant_id === 'string' && body.tenant_id.trim() ? body.tenant_id.trim() : null

  const allowedRoles = new Set(['superadmin', 'store-admin', 'store-staff', 'customer'])
  if (rawRole && !allowedRoles.has(rawRole)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if ((rawRole === 'store-admin' || rawRole === 'store-staff') && !rawTenantId) {
    return NextResponse.json({ error: 'Store Admin/Staff must be linked to a tenant' }, { status: 400 })
  }

  if (rawTenantId) {
    const { data: tenant } = await service
      .from('tenants')
      .select('id')
      .eq('id', rawTenantId)
      .maybeSingle()

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }
  }

  let normalizedTenantId = rawTenantId
  if (rawRole === 'superadmin' || rawRole === 'customer' || !rawRole) {
    normalizedTenantId = null
  }

  const update: Record<string, unknown> = {}
  if ('role' in body) update.role = rawRole
  if ('tenant_id' in body || (rawRole === 'superadmin' || rawRole === 'customer' || !rawRole)) {
    update.tenant_id = normalizedTenantId
  }

  const { data, error } = await service
    .from('profiles')
    .upsert({ id, ...update })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { error } = await service.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
