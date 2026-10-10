import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function PATCH(
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
    console.error('PATCH /api/superadmin/tenants/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  revalidatePath('/tenants')
  revalidatePath(`/${data.slug}`, 'layout')
  return NextResponse.json(data)
}

export async function DELETE(
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
        console.error('DELETE /api/superadmin/tenants/[id] auth user:', userDeleteError)
        return NextResponse.json({ error: 'Failed to remove all restaurant users. Please retry.' }, { status: 500 })
      }
    }
  }

  // Deleta scan_events (sem ON DELETE CASCADE no banco)
  await service.from('scan_events').delete().eq('tenant_id', id)

  // Deleta tenant (cascade deleta categorias, produtos, etc.)
  const { error } = await service.from('tenants').delete().eq('id', id)
  if (error) {
    console.error('DELETE /api/superadmin/tenants/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  revalidatePath('/tenants')
  if (tenant?.slug) revalidatePath(`/${tenant.slug}`, 'layout')

  return NextResponse.json({ success: true })
}
