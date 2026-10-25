import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const allowed = ['is_active', 'name']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }
  if ('name' in update) {
    const name = typeof update.name === 'string' ? update.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Restaurant name is required' }, { status: 400 })
    update.name = name
  }
  if ('is_active' in update && typeof update.is_active !== 'boolean') {
    return NextResponse.json({ error: 'Invalid active status' }, { status: 400 })
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data, error } = await service.from('tenants').update(update).eq('id', id).select().single()
  if (error) {
    log.error('PATCH /api/superadmin/tenants/[id]', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  revalidatePath('/tenants')
  revalidatePath(`/${data.slug}`, 'layout')
  return NextResponse.json(data)
}

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: tenant } = await service.from('tenants').select('slug').eq('id', id).maybeSingle()

  // Fetch tenant users to delete them from Auth
  const { data: profiles } = await service.from('profiles').select('id').eq('tenant_id', id)
  if (profiles) {
    for (const p of profiles) {
      const { error: userDeleteError } = await service.auth.admin.deleteUser(p.id)
      if (userDeleteError) {
        log.error('DELETE /api/superadmin/tenants/[id] auth user', { err: userDeleteError })
        return NextResponse.json({ error: 'Failed to remove all restaurant users. Please retry.' }, { status: 500 })
      }
    }
  }

  // Deleta scan_events (sem ON DELETE CASCADE no banco)
  await service.from('scan_events').delete().eq('tenant_id', id)

  // Deleta tenant (cascade deleta categorias, produtos, etc.)
  const { error } = await service.from('tenants').delete().eq('id', id)
  if (error) {
    log.error('DELETE /api/superadmin/tenants/[id]', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  revalidatePath('/tenants')
  if (tenant?.slug) revalidatePath(`/${tenant.slug}`, 'layout')

  return NextResponse.json({ success: true })
}

export const PATCH = withApi('PATCH /api/superadmin/tenants/[id]', handlePATCH)
export const DELETE = withApi('DELETE /api/superadmin/tenants/[id]', handleDELETE)
